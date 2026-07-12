"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hexToHsl } from "@/lib/color";
import { planDiscovery, designOutfit, matchPiecesToProducts, pickBestImage, locateGarment } from "@/lib/ai";
import { processProductImage } from "@/lib/images";
import { SOURCES, sourceById } from "@/lib/sources";
import { fetchStoreProducts, filterByKeywords } from "@/lib/shopify";

export async function generateLookbookWithAi(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const brief = String(formData.get("brief") ?? "").trim();
  if (!brief) return;
  const clientId = String(formData.get("client_id") ?? "");
  const count = Math.min(Math.max(parseInt(String(formData.get("count") ?? "8"), 10) || 8, 2), 12);

  let clientName: string | null = null;
  if (clientId) {
    const { data } = await supabase
      .from("clients")
      .select("name")
      .eq("id", clientId)
      .maybeSingle();
    clientName = data?.name ?? null;
  }

  // Celebrity-stylist pipeline: DESIGN the complete look first (trend-informed,
  // head-to-toe incl. accessories), then source each designed piece.
  let spec;
  let chosen: Array<{
    product: NonNullable<Awaited<ReturnType<typeof fetchStoreProducts>>>[number];
    category: string;
    color_hex: string;
    note: string;
  }> = [];
  try {
    spec = await designOutfit(brief, clientName);

    const storeCatalog = SOURCES.map((s) => `${s.id}: ${s.name} — ${s.vibe}`).join("\n");
    const pieceSummary = spec.pieces
      .map((p, i) => `${i}. [${p.role}] ${p.description}`)
      .join("\n");
    const plan = await planDiscovery(`${brief}. Pieces to source:\n${pieceSummary}`, storeCatalog);
    const stores = plan.store_ids
      .map(sourceById)
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .slice(0, 6);
    const catalogs = await Promise.all(stores.map((s) => fetchStoreProducts(s)));
    const all = catalogs.flat();

    // Per-piece candidate pools, flattened with global indexes
    const pool: typeof all = [];
    const lines: string[] = [];
    spec.pieces.forEach((piece, pi) => {
      const matchesForPiece = filterByKeywords(all, piece.keywords).slice(0, 12);
      for (const prod of matchesForPiece) {
        lines.push(
          `${pool.length}. [piece ${pi}: ${piece.role}] ${prod.title} | ${prod.productType} | ${prod.storeName} | $${prod.price ?? "?"} | tags: ${prod.tags.slice(0, 4).join(", ")}`
        );
        pool.push(prod);
      }
    });
    if (pool.length === 0) {
      redirect(
        `/lookbooks?error=${encodeURIComponent("No store matches for this design — try broader wording")}`
      );
    }

    const { matches } = await matchPiecesToProducts(pieceSummary, lines.join("\n"));
    const seenUrls = new Set<string>();
    for (const m of matches) {
      const product = pool[m.index];
      const piece = spec.pieces[m.piece];
      if (!product || !piece || seenUrls.has(product.url)) continue;
      seenUrls.add(product.url);
      chosen.push({ product, category: piece.category, color_hex: piece.color_hex, note: m.note });
    }
    chosen = chosen.slice(0, Math.max(count, spec.pieces.length));
    if (chosen.length === 0) {
      redirect(`/lookbooks?error=${encodeURIComponent("Couldn't match the design to store inventory")}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI styling failed";
    redirect(`/lookbooks?error=${encodeURIComponent(message)}`);
  }

  // Photos: flats cut out directly; on-model shots get a headless garment
  // crop first so every piece lands on the collage
  const prepared = await Promise.all(
    chosen.map(async (pick) => {
      const { product } = pick;
      const pool = product.images.length > 0 ? product.images : [product.image];
      const best = await pickBestImage(pool);
      const chosenUrl = pool[best.index] ?? product.image;
      const crop = best.flat ? null : await locateGarment(chosenUrl, product.title);
      const imageUrl = await processProductImage(chosenUrl, user.id, supabase, crop);
      return { pick, product, imageUrl };
    })
  );

  const { data: items, error: itemsError } = await supabase
    .from("items")
    .insert(
      prepared.map(({ pick, product, imageUrl }) => {
        const { h, s, l } = hexToHsl(pick.color_hex);
        return {
          stylist_id: user.id,
          name: product.title.slice(0, 200),
          brand: product.vendor || product.storeName,
          category: pick.category,
          price_cents: product.price !== null ? Math.round(product.price * 100) : null,
          product_url: product.url,
          image_url: imageUrl,
          color_hex: pick.color_hex,
          hue: h,
          saturation: s,
          lightness: l,
        };
      })
    )
    .select("id");

  if (itemsError || !items) {
    redirect(`/lookbooks?error=${encodeURIComponent("Failed to save sourced items")}`);
  }

  const { data: lookbook, error: lookbookError } = await supabase
    .from("lookbooks")
    .insert({
      stylist_id: user.id,
      title: spec.title,
      description: spec.description,
      client_id: clientId || null,
    })
    .select("id")
    .single();

  if (lookbookError || !lookbook) {
    redirect(`/lookbooks?error=${encodeURIComponent("Failed to create lookbook")}`);
  }

  await supabase.from("lookbook_items").insert(
    items.map((item, idx) => ({
      lookbook_id: lookbook.id,
      item_id: item.id,
      note: prepared[idx]?.pick.note ?? "",
      position: idx + 1,
    }))
  );

  revalidatePath("/lookbooks");
  revalidatePath("/items");
  redirect(`/lookbooks/${lookbook.id}`);
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
