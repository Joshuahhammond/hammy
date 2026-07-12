"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient as createSupabaseJs, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hexToHsl } from "@/lib/color";
import { planDiscovery, designLookbook, matchPiecesToProducts, pickBestImage, locateGarment } from "@/lib/ai";
import { processProductImage } from "@/lib/images";
import { SOURCES, sourceById } from "@/lib/sources";
import { fetchStoreProducts, filterByKeywords } from "@/lib/shopify";

/**
 * Kicks off generation as a background job and returns immediately —
 * phones kill requests after ~60s, and the pipeline runs 2-3 minutes.
 * The detail page polls until the lookbook flips to 'ready'.
 */
export async function generateLookbookWithAi(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const brief = String(formData.get("brief") ?? "").trim();
  if (!brief) return;
  const clientId = String(formData.get("client_id") ?? "");
  const outfits = Math.min(Math.max(parseInt(String(formData.get("outfits") ?? "2"), 10) || 2, 1), 4);

  let clientName: string | null = null;
  if (clientId) {
    const { data } = await supabase
      .from("clients")
      .select("name")
      .eq("id", clientId)
      .maybeSingle();
    clientName = data?.name ?? null;
  }

  // The background task outlives this request's cookies — carry the user's
  // session token so RLS still applies.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: lookbook, error } = await supabase
    .from("lookbooks")
    .insert({
      stylist_id: user.id,
      title: "Styling in progress…",
      description: brief,
      client_id: clientId || null,
      status: "generating",
    })
    .select("id")
    .single();
  if (error || !lookbook) {
    redirect(`/lookbooks?error=${encodeURIComponent("Could not start the lookbook")}`);
  }

  const args = {
    lookbookId: lookbook.id,
    brief,
    clientName,
    outfitCount: outfits,
    userId: user.id,
    accessToken: session.access_token,
  };
  after(async () => {
    await runLookbookGeneration(args);
  });

  revalidatePath("/lookbooks");
  redirect(`/lookbooks/${lookbook.id}`);
}

async function runLookbookGeneration({
  lookbookId,
  brief,
  clientName,
  outfitCount,
  userId,
  accessToken,
}: {
  lookbookId: string;
  brief: string;
  clientName: string | null;
  outfitCount: number;
  userId: string;
  accessToken: string;
}) {
  const db: SupabaseClient = createSupabaseJs(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );

  try {
    // 1. Design a collection of complete outfits (trend-informed)
    const spec = await designLookbook(brief, clientName, outfitCount);
    const flatPieces = spec.outfits.flatMap((outfit, oi) =>
      outfit.pieces.map((p) => ({ ...p, outfit: oi, outfitName: outfit.name }))
    );
    const pieceSummary = flatPieces
      .map((p, i) => `${i}. [outfit ${p.outfit + 1} "${p.outfitName}" | ${p.role}] ${p.description}`)
      .join("\n");

    // 2. Source candidates per designed piece
    const storeCatalog = SOURCES.map((s) => `${s.id}: ${s.name} — ${s.vibe}`).join("\n");
    const plan = await planDiscovery(`${brief}. Pieces to source:\n${pieceSummary}`, storeCatalog);
    const stores = plan.store_ids
      .map(sourceById)
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .slice(0, 6);
    const catalogs = await Promise.all(stores.map((s) => fetchStoreProducts(s)));
    const all = catalogs.flat();

    const pool: typeof all = [];
    const lines: string[] = [];
    flatPieces.forEach((piece, pi) => {
      const matchesForPiece = filterByKeywords(all, piece.keywords).slice(0, 10);
      for (const prod of matchesForPiece) {
        lines.push(
          `${pool.length}. [piece ${pi}: outfit ${piece.outfit + 1} ${piece.role}] ${prod.title} | ${prod.productType} | ${prod.storeName} | $${prod.price ?? "?"} | tags: ${prod.tags.slice(0, 4).join(", ")}`
        );
        pool.push(prod);
      }
    });
    if (pool.length === 0) throw new Error("No store matches for this design — try broader wording");

    // 3. Match one real product per designed piece. A piece may reuse a
    // product already placed in another outfit's slot — dedupe per outfit.
    const { matches } = await matchPiecesToProducts(pieceSummary, lines.join("\n"));
    const seenPerOutfit = new Map<number, Set<string>>();
    const chosen: Array<{
      product: (typeof all)[number];
      category: string;
      color_hex: string;
      note: string;
      outfit: number;
    }> = [];
    for (const m of matches) {
      const product = pool[m.index];
      const piece = flatPieces[m.piece];
      if (!product || !piece) continue;
      const seen = seenPerOutfit.get(piece.outfit) ?? new Set<string>();
      if (seen.has(product.url)) continue;
      seen.add(product.url);
      seenPerOutfit.set(piece.outfit, seen);
      chosen.push({
        product,
        category: piece.category,
        color_hex: piece.color_hex,
        note: m.note,
        outfit: piece.outfit,
      });
    }
    if (chosen.length === 0) throw new Error("Couldn't match the design to store inventory");
    chosen.sort((a, b) => a.outfit - b.outfit);

    // 4. Photos in small batches (bg removal is CPU-heavy)
    const prepared: Array<{ pick: (typeof chosen)[number]; imageUrl: string }> = [];
    for (let i = 0; i < chosen.length; i += 4) {
      const batch = await Promise.all(
        chosen.slice(i, i + 4).map(async (pick) => {
          const { product } = pick;
          const imgs = product.images.length > 0 ? product.images : [product.image];
          const best = await pickBestImage(imgs);
          const chosenUrl = imgs[best.index] ?? product.image;
          const crop = best.flat ? null : await locateGarment(chosenUrl, product.title);
          const imageUrl = await processProductImage(chosenUrl, userId, db, crop);
          return { pick, imageUrl };
        })
      );
      prepared.push(...batch);
    }

    const { data: items, error: itemsError } = await db
      .from("items")
      .insert(
        prepared.map(({ pick, imageUrl }) => {
          const { h, s, l } = hexToHsl(pick.color_hex);
          return {
            stylist_id: userId,
            name: pick.product.title.slice(0, 200),
            brand: pick.product.vendor || pick.product.storeName,
            category: pick.category,
            price_cents: pick.product.price !== null ? Math.round(pick.product.price * 100) : null,
            product_url: pick.product.url,
            image_url: imageUrl,
            color_hex: pick.color_hex,
            hue: h,
            saturation: s,
            lightness: l,
          };
        })
      )
      .select("id");
    if (itemsError || !items) throw new Error("Failed to save sourced items");

    await db.from("lookbook_items").insert(
      items.map((item, idx) => ({
        lookbook_id: lookbookId,
        item_id: item.id,
        note: prepared[idx]?.pick.note ?? "",
        position: idx + 1,
        look_no: (prepared[idx]?.pick.outfit ?? 0) + 1,
      }))
    );

    await db
      .from("lookbooks")
      .update({ title: spec.title, description: spec.description, status: "ready" })
      .eq("id", lookbookId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI styling failed";
    console.error("lookbook generation failed:", err);
    await db
      .from("lookbooks")
      .update({ status: "error", description: `Generation failed: ${message}` })
      .eq("id", lookbookId);
  }
}

export async function createLookbook(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const clientId = String(formData.get("client_id") ?? "");

  const { data, error } = await supabase
    .from("lookbooks")
    .insert({
      stylist_id: user.id,
      title,
      description: String(formData.get("description") ?? "").trim(),
      client_id: clientId || null,
    })
    .select("id")
    .single();

  if (error || !data) return;

  redirect(`/lookbooks/${data.id}`);
}

export async function deleteLookbook(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");

  await supabase.from("lookbooks").delete().eq("id", id);

  revalidatePath("/lookbooks");
  redirect("/lookbooks");
}

export async function addItemToLookbook(formData: FormData) {
  const supabase = await createClient();
  const lookbookId = String(formData.get("lookbook_id") ?? "");
  const itemId = String(formData.get("item_id") ?? "");
  if (!lookbookId || !itemId) return;

  const { data: maxRow } = await supabase
    .from("lookbook_items")
    .select("position")
    .eq("lookbook_id", lookbookId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase.from("lookbook_items").insert({
    lookbook_id: lookbookId,
    item_id: itemId,
    position: (maxRow?.position ?? 0) + 1,
  });

  revalidatePath(`/lookbooks/${lookbookId}`);
}

export async function removeItemFromLookbook(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const lookbookId = String(formData.get("lookbook_id") ?? "");

  await supabase.from("lookbook_items").delete().eq("id", id);

  revalidatePath(`/lookbooks/${lookbookId}`);
}

export async function updateLookbookItemNote(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const lookbookId = String(formData.get("lookbook_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  await supabase.from("lookbook_items").update({ note }).eq("id", id);

  revalidatePath(`/lookbooks/${lookbookId}`);
}
