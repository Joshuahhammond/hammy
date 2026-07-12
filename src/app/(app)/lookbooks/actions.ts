"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient as createSupabaseJs, type SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { hexToHsl } from "@/lib/color";
import { planDiscovery, designLookbook, matchPiecesToProducts, pickBestImage, locateGarment, verifyPaletteMatches } from "@/lib/ai";
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

    // 2. Source candidates per designed piece. The planner picks core
    // clothing stores; specialty categories (shoes, bags, jewelry, belts,
    // sunglasses) get their stores injected automatically so accessory
    // pieces always have candidates.
    const storeCatalog = SOURCES.map((s) => `${s.id}: ${s.name} — ${s.vibe}`).join("\n");
    const plan = await planDiscovery(`${brief}. Pieces to source:\n${pieceSummary}`, storeCatalog);

    const ROLE_STORES: Array<[RegExp, string[]]> = [
      [/shoe|loafer|heel|sneaker|boot|flat|sandal|pump|ballerina|mule/i, ["fredasalvador", "dolcevita", "stevemadden", "alohas", "larroude"]],
      [/bag|tote|clutch|crossbody|shoulder bag|crescent/i, ["cuyana", "songmont", "jwpei", "stagni"]],
      [/jewel|earring|necklace|ring|bracelet|hoop|pendant|choker/i, ["missoma", "gorjana", "heavenmayhem"]],
      [/belt/i, ["fredasalvador", "stagni", "cuyana"]],
      [/sunglass/i, ["stagni", "kith", "fredasalvador"]],
    ];
    const specialtyIds = new Set<string>();
    for (const piece of flatPieces) {
      const text = `${piece.role} ${piece.description}`;
      for (const [re, ids] of ROLE_STORES) {
        if (re.test(text)) ids.slice(0, 3).forEach((id) => specialtyIds.add(id));
      }
    }
    const storeIds = [...new Set([...plan.store_ids.slice(0, 6), ...specialtyIds])].slice(0, 13);
    const stores = storeIds
      .map(sourceById)
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const catalogs = await Promise.all(stores.map((s) => fetchStoreProducts(s)));
    const all = catalogs.flat();

    // Accessory/shoe pools must be role-plausible: keyword noise ("gold",
    // "thin") otherwise floods them with garments, and the auto-fill below
    // would ship a blue tee as "earrings".
    // Product-side patterns need word boundaries: "Cuffed" jeans matched a
    // bare /cuff/ and got swapped in as a bracelet; "belted" dresses are
    // not belts.
    const ROLE_GUARDS: Array<[RegExp, RegExp]> = [
      [/earring|hoop|stud/i, /\bearrings?\b|\bhoops?\b|\bstuds?\b/i],
      [/necklace|pendant|choker|lariat/i, /\bnecklaces?\b|\bpendants?\b|\bchokers?\b|\blariats?\b|\bchains?\b/i],
      [/bracelet|bangle|cuff/i, /\bbracelets?\b|\bbangles?\b|\bcuffs?\b/i],
      [/\brings?\b|signet/i, /\brings?\b|\bsignets?\b/i],
      [/watch/i, /\bwatch(es)?\b/i],
      [/jewel/i, /\bearrings?\b|\bhoops?\b|\bstuds?\b|\bnecklaces?\b|\bpendants?\b|\bbracelets?\b|\bbangles?\b|\bcuffs?\b|\brings?\b|jewel/i],
      [/sunglass/i, /sunglass|eyewear|\bframes\b/i],
      [/belt/i, /\bbelts?\b/i],
      [/scarf|stole/i, /\bscar(f|ves)\b|\bstoles?\b|bandana/i],
      [/\bhair\b|headband|ribbon|claw/i, /headband|scrunchie|\bclaw\b|\bclips?\b|barrette|\bribbons?\b/i],
      [/hosiery|tights|stocking|\bsocks?\b/i, /\btights\b|stockings?|\bsocks?\b|hosiery/i],
      [/\bhats?\b|\bcaps?\b|beanie/i, /\bhats?\b|\bcaps?\b|beanie|bucket/i],
      [/bag|tote|clutch|crossbody|satchel/i, /\bbags?\b|\btotes?\b|clutch|crossbody|satchel|hobo|pouch/i],
      [/shoe|heel|mule|loafer|\bflats?\b|sandal|boot|slingback|ballerina|pump|sneaker/i,
        /\bshoes?\b|\bheels?\b|\bmules?\b|loafer|\bflats?\b|sandal|\bboots?\b|slingback|ballerina|\bpumps?\b|sneaker|\bslides?\b|trainer/i],
    ];
    const productText = (p: (typeof all)[number]) =>
      `${p.title} ${p.productType} ${p.tags.join(" ")}`;
    // Products that read as garments — an unguarded accessory piece (hair
    // ribbon, hosiery) must at minimum never be filled by one of these
    const GARMENT_TEXT =
      /\bshirts?\b|\btops?\b|\btees?\b|polo|dress|trouser|\bpants?\b|skirt|\bshorts?\b|sweater|\bknits?\b|cardigan|jacket|\bcoats?\b|blazer|jeans?|\btanks?\b|blouse|tunic|hoodie|romper|jumpsuit/i;
    // Garment silhouette families: a skirt piece must be filled by a skirt,
    // never a "silk pj top" that shares its keywords
    const GARMENT_TYPES: Array<[RegExp, RegExp]> = [
      [/skirt/i, /skirt/i],
      [/trouser|\bpants?\b|jeans?|denim|chino/i, /trouser|\bpants?\b|jeans?|chino/i],
      [/\bshorts?\b/i, /\bshorts?\b/i],
      [/dress|gown/i, /dress|gown/i],
      [/blazer|jacket|\bcoats?\b|trench|cardigan|overshirt/i, /blazer|jacket|\bcoats?\b|trench|cardigan|overshirt/i],
      [/\btops?\b|\btees?\b|shirt|blouse|knit|sweater|polo|tank|tunic|halter|cami|bodysuit/i,
        /\btops?\b|\btees?\b|shirt|blouse|knit|sweater|polo|tank|tunic|cami|halter|bodysuit|henley/i],
    ];
    const garmentTypeOk = (piece: { role: string; description: string }, text: string) => {
      const fams = GARMENT_TYPES.filter(([role]) => role.test(`${piece.role} ${piece.description}`));
      return fams.length === 0 || fams.some(([, ok]) => ok.test(text));
    };

    const pool: typeof all = [];
    const lines: string[] = [];
    const poolByPiece = new Map<number, typeof all>();
    const guardsByPiece = new Map<number, RegExp[]>();
    const garmentPieceIdx = new Set<number>();
    flatPieces.forEach((piece, pi) => {
      let candidates = filterByKeywords(all, piece.keywords);
      // Zero candidates → retry with just the strongest (first two) stems
      if (candidates.length === 0 && piece.keywords.length > 2) {
        candidates = filterByKeywords(all, piece.keywords.slice(0, 2));
      }
      // Guard every non-garment piece (designers file sunglasses/jewelry
      // under "other" as often as "accessories"); garments are exempt so a
      // "belted waist" description can't turn a coat into a belt search
      const isGarmentPiece = ["tops", "bottoms", "dresses", "outerwear"].includes(piece.category);
      const guards = isGarmentPiece
        ? []
        : ROLE_GUARDS.filter(([role]) => role.test(`${piece.role} ${piece.description}`)).map(([, ok]) => ok);
      guardsByPiece.set(pi, guards);
      if (isGarmentPiece) garmentPieceIdx.add(pi);
      if (isGarmentPiece) {
        // Reverse guard: a garment piece must never be filled by an
        // accessory product (a woven tote once matched "wide-leg trousers")
        const ACC_TEXT =
          /\bbags?\b|\btotes?\b|clutch|crossbody|satchel|hobo|\bmules?\b|loafer|sandal|sneaker|trainer|slingback|\bheels?\b|\bearrings?\b|necklace|bracelet|bangle|\brings?\b|\bwatch(es)?\b|sunglass|\bbelts?\b|\bscar(f|ves)\b/i;
        candidates = candidates.filter((p) => !ACC_TEXT.test(productText(p)));
      }
      if (guards.length > 0) {
        candidates = candidates.filter((p) => guards.some((ok) => ok.test(productText(p))));
        // Keywords missed but the catalogs still hold real items of this
        // kind — better an off-keyword earring than none at all
        if (candidates.length === 0) {
          candidates = all.filter((p) => guards.some((ok) => ok.test(productText(p))));
        }
      }
      const matchesForPiece = candidates.slice(0, 12);
      poolByPiece.set(pi, matchesForPiece);
      console.log(
        `[lookbook ${lookbookId}] piece ${pi} (${piece.role}) kw=[${piece.keywords.join(",")}] → ${matchesForPiece.length} candidates`
      );
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
      pieceIdx: number;
    }> = [];
    for (const m of matches) {
      const product = pool[m.index];
      const piece = flatPieces[m.piece];
      if (!product || !piece) continue;
      // The AI matcher picks from the GLOBAL candidate list and can
      // cross-assign (a black top once shipped as "necklace"). Enforce the
      // piece's type guard deterministically — no exceptions.
      const text = productText(product);
      if (!garmentPieceIdx.has(m.piece)) {
        const guards = guardsByPiece.get(m.piece) ?? [];
        const typeOk = guards.length > 0
          ? guards.some((ok) => ok.test(text))
          : !GARMENT_TEXT.test(text); // unguarded roles at least reject garments
        if (!typeOk) {
          console.log(`[lookbook ${lookbookId}] type reject: ${product.title} as ${piece.role}`);
          continue;
        }
      } else if (!GARMENT_TEXT.test(text) || !garmentTypeOk(piece, text)) {
        // A garment piece must be filled by a garment OF ITS SILHOUETTE
        console.log(`[lookbook ${lookbookId}] type reject: ${product.title} as ${piece.role}`);
        continue;
      }
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
        pieceIdx: m.piece,
      });
    }
    // Guaranteed fill: a designed piece the matcher dropped still gets its
    // best keyword candidate — a finished board beats a perfect match.
    const matchedPieceIdx = new Set(matches.map((m) => m.piece));
    flatPieces.forEach((piece, pi) => {
      if (matchedPieceIdx.has(pi)) return;
      // Garments keep the strict omit rule — only accessories/shoes auto-fill
      if (["tops", "bottoms", "dresses", "outerwear"].includes(piece.category)) return;
      const candidates = poolByPiece.get(pi) ?? [];
      const seen = seenPerOutfit.get(piece.outfit) ?? new Set<string>();
      const fallback = candidates.find((c) => !seen.has(c.url));
      if (!fallback) return;
      seen.add(fallback.url);
      seenPerOutfit.set(piece.outfit, seen);
      chosen.push({
        product: fallback,
        category: piece.category,
        color_hex: piece.color_hex,
        note: "",
        outfit: piece.outfit,
        pieceIdx: pi,
      });
      console.log(`[lookbook ${lookbookId}] piece ${pi} (${piece.role}) auto-filled: ${fallback.title}`);
    });

    if (chosen.length === 0) throw new Error("Couldn't match the design to store inventory");

    // 3.5 Vision palette check — titles lie about color ("chocolate" that
    // photographs olive). Failed picks try one replacement candidate from
    // their pool; if that fails too, the piece drops — a gap beats a clash.
    const wantFor = (ci: number) => {
      const piece = flatPieces[chosen[ci].pieceIdx];
      return `${piece.description} (intended color ${piece.color_hex})`;
    };
    const verdicts = await verifyPaletteMatches(
      chosen.map((c, ci) => ({ item: ci, imageUrl: c.product.image, want: wantFor(ci) }))
    );
    const replacements = new Map<number, (typeof all)[number]>();
    const claimedAlts = new Set<string>(); // two failed pieces must not swap to the same product
    chosen.forEach((c, ci) => {
      if (verdicts.get(ci) !== false) return;
      const seen = seenPerOutfit.get(c.outfit) ?? new Set<string>();
      const piece = flatPieces[c.pieceIdx];
      const alt = (poolByPiece.get(c.pieceIdx) ?? []).find(
        (p) =>
          p.url !== c.product.url &&
          !seen.has(p.url) &&
          !claimedAlts.has(p.url) &&
          (!garmentPieceIdx.has(c.pieceIdx) || garmentTypeOk(piece, productText(p)))
      );
      if (alt) {
        claimedAlts.add(alt.url);
        replacements.set(ci, alt);
      }
    });
    const altVerdicts = replacements.size
      ? await verifyPaletteMatches(
          [...replacements.entries()].map(([ci, p]) => ({
            item: ci,
            imageUrl: p.image,
            want: wantFor(ci),
          }))
        )
      : new Map<number, boolean>();
    const kept = chosen.filter((c, ci) => {
      if (verdicts.get(ci) !== false) return true;
      const alt = replacements.get(ci);
      if (alt && altVerdicts.get(ci) === true) {
        console.log(`[lookbook ${lookbookId}] palette swap: ${c.product.title} → ${alt.title}`);
        seenPerOutfit.get(c.outfit)?.add(alt.url);
        c.product = alt;
        return true;
      }
      // Structural guard: never drop an outfit's only bottoms/tops — a
      // palette wobble beats a legless board
      const structural = ["bottoms", "tops", "dresses"].includes(c.category) &&
        !chosen.some(
          (o, oi) => oi !== ci && o.outfit === c.outfit && o.category === c.category &&
            verdicts.get(oi) !== false
        );
      if (structural) {
        console.log(`[lookbook ${lookbookId}] palette kept (structural): ${c.product.title}`);
        return true;
      }
      console.log(`[lookbook ${lookbookId}] palette drop: ${c.product.title}`);
      return false;
    });

    if (kept.length === 0) throw new Error("Couldn't match the design to store inventory");
    kept.sort((a, b) => a.outfit - b.outfit);
    console.log(
      `[lookbook ${lookbookId}] matched ${kept.length}/${flatPieces.length} designed pieces (${matches.length} raw matches, ${chosen.length - kept.length} palette drops)`
    );

    // 4. Photos in small batches (bg removal is CPU-heavy)
    const prepared: Array<{ pick: (typeof kept)[number]; imageUrl: string }> = [];
    for (let i = 0; i < kept.length; i += 4) {
      const batch = await Promise.all(
        kept.slice(i, i + 4).map(async (pick) => {
          const { product } = pick;
          const imgs = product.images.length > 0 ? product.images : [product.image];
          const best = await pickBestImage(imgs);
          const chosenUrl = imgs[best.index] ?? product.image;
          const crop = best.flat ? null : await locateGarment(chosenUrl, product.title);
          if (!best.flat && !crop) {
            // Model shot with no clean garment box → bench to the strip.
            // A person silhouette on the canvas is worse than a gap.
            console.log(`[lookbook ${lookbookId}] benched (no clean crop): ${product.title}`);
            return { pick, imageUrl: product.image };
          }
          const imageUrl = await processProductImage(chosenUrl, userId, db, crop, best.flat);
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
            kind: flatPieces[pick.pieceIdx]?.role ?? "",
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

    // 5. AI art director: render each board, critique against reference
    // rules, persist the nudged positions. Never blocks shipping the book.
    try {
      const { refineBoards } = await import("@/lib/critique");
      await refineBoards(db, lookbookId);
    } catch (err) {
      console.error(`[lookbook ${lookbookId}] critique pass skipped:`, err);
    }

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
