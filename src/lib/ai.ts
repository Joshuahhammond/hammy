import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES } from "@/lib/types";

const MODEL = "claude-opus-4-8";

// Resolves ANTHROPIC_API_KEY from the environment
const client = new Anthropic();

const CELEB_STYLIST_SYSTEM =
  "You are a world-class celebrity stylist and clothing designer — the person Kim Kardashian's team " +
  "calls before a press week. You design complete, intentional looks: every outfit is head-to-toe " +
  "(outerwear when it belongs, top, bottom, shoes) and finished with deliberate accessories — belt, " +
  "sunglasses, bag, jewelry. You think in silhouettes, proportions, and a tight color story. " +
  "You know current runway and street-style trends and reference them. " +
  "Your signature discipline is COLOR: every lookbook lives inside ONE tight palette — at most " +
  "three tonal families plus a single metal accent (gold OR silver, never both) — and every piece " +
  "names its exact color from that palette. A saturated hue appears only when the brief demands it, " +
  "and then as one deliberate accent, never a stray. " +
  "Your taste is ELEVATED BOUTIQUE, never plain: default to pieces with a point of view — texture, " +
  "print, drape, puff sleeves, statement buttons, interesting necklines, hardware — the modern cute " +
  "energy of a Bohme or Nordstrom contemporary floor. A plain tank or basic trouser earns its place " +
  "only as a deliberate foil to a statement piece, or when the brief asks for minimalist. " +
  "Craft rules for a GREAT outfit: exactly one hero piece per look (everything else supports it); " +
  "balance silhouettes (an oversized top over a slim bottom, a fluid skirt under a fitted knit — " +
  "never baggy-on-baggy or tight-on-tight); vary texture within the palette (knit against silk, " +
  "suede against crisp cotton); and make every look occasion-coherent — a wearable, photograph-ready " +
  "outfit, not a collection of nice items.";

const PieceSchema = z.object({
  role: z
    .string()
    .describe("The piece's role in its outfit: 'top', 'trouser', 'shoes', 'belt', 'sunglasses', 'bag', 'outerwear', ..."),
  category: z.enum(CATEGORIES),
  description: z
    .string()
    .describe("Precise designer spec: silhouette, fabric, color, details — e.g. 'oversized chocolate suede belted blazer, strong shoulder'"),
  color_hex: z.string().describe("The piece's intended color as 6-digit hex"),
  keywords: z
    .array(z.string())
    .describe("3-5 lowercase single-word search stems for finding this piece in store catalogs (e.g. 'blazer', 'suede', 'chocolate')"),
});

const LookbookDesignSchema = z.object({
  title: z.string().describe("Evocative lookbook title, 2-6 words"),
  description: z
    .string()
    .describe("One or two sentences introducing the collection to the client, in the stylist's voice"),
  outfits: z
    .array(
      z.object({
        name: z.string().describe("Short outfit name, e.g. 'Gallery Morning'"),
        pieces: z
          .array(PieceSchema)
          .describe(
            "8-14 pieces forming this COMPLETE, abundant outfit. MANDATORY per outfit: top(s) or a dress, a bottom (unless dress-led), shoes, a bag, AND at least two finishing accessories from belt / sunglasses / earrings / necklace / bracelet. Outerwear when it belongs. If the brief enumerates specific pieces, include EVERY listed piece — it's an exact recreation. Editorial collages feel generous — never sparse."
          ),
      })
    )
    .describe("Distinct complete outfits, each wearable as-is, all within one cohesive style story"),
});

export type LookbookDesign = z.infer<typeof LookbookDesignSchema>;

/**
 * Design phase: a trend-informed COLLECTION of complete outfits — like a
 * stylist's client deck, each look head-to-toe with accessories. Searches
 * the web for current editorial inspiration first.
 */
export async function designLookbook(
  brief: string,
  clientName: string | null,
  outfitCount: number
): Promise<LookbookDesign> {
  const forClient = clientName ? ` The client's name is ${clientName}.` : "";
  let prose = "";
  try {
    const design = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: CELEB_STYLIST_SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
      messages: [
        {
          role: "user",
          content: `Design a client lookbook of ${outfitCount} distinct, complete outfits for this brief: "${brief}".${forClient}\n\nFirst, search the web briefly for what's trending right now in this aesthetic (street style, Pinterest-type editorial, runway) and let it inform the design. Then write the design: a short collection vision that OPENS BY NAMING THE PALETTE (e.g. "chocolate / cream / tan + gold"), then each outfit as a named look with a numbered piece list of 8-14 pieces. If the brief enumerates specific pieces, include EVERY listed piece — the client wants an exact recreation. Every piece's color must come from the named palette. Every outfit MUST be head-to-toe AND fully finished: top(s) or a dress, a bottom (unless dress-led), shoes, a bag, and at least two more finishing accessories (belt, sunglasses, earrings, necklace, bracelet); outerwear if it belongs. Editorial boards feel abundant — never sparse. The outfits must be distinct from each other but cohesive as one collection. For each piece give silhouette, fabric, exact color, and the search words a buyer would use.`,
        },
      ],
    });
    prose = design.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  } catch {
    prose = ""; // search unavailable — design from knowledge below
  }

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: CELEB_STYLIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: prose
          ? `Structure this lookbook design into the schema, keeping every outfit and every piece:\n\n${prose}`
          : `Design a client lookbook of ${outfitCount} distinct, complete outfits for this brief: "${brief}".${forClient} Each outfit 8-11 pieces, head-to-toe and fully finished: top(s) or dress, bottom, shoes, a bag, and at least two more accessories (belt, sunglasses, jewelry); outerwear if it belongs.`,
      },
    ],
    output_config: { format: zodOutputFormat(LookbookDesignSchema) },
  });
  if (!response.parsed_output || response.parsed_output.outfits.length === 0)
    throw new Error("Could not design the collection");
  return response.parsed_output;
}

const PieceMatchSchema = z.object({
  matches: z
    .array(
      z.object({
        piece: z.number().describe("The piece number from the design spec"),
        index: z.number().describe("The chosen candidate's global number"),
        note: z
          .string()
          .describe("A warm styling note to the client: how this piece works in the look"),
      })
    )
    .describe("Exactly one match per design piece that has any suitable candidate. Skip pieces with no good candidate."),
});

export type PieceMatches = z.infer<typeof PieceMatchSchema>;

/** Match each designed piece to the best real product from its candidates. */
export async function matchPiecesToProducts(
  specSummary: string,
  candidateLines: string
): Promise<PieceMatches> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: CELEB_STYLIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `You designed this look:\n${specSummary}\n\nReal, in-stock candidates (each tagged with the piece it could fill):\n${candidateLines}\n\nFor each design piece, choose the single candidate that best honors the design. Never choose two candidates that are near-duplicates. HARD RULE: the candidate must actually BE that kind of piece — a polo shirt can never fill a shoes slot — and the garment TYPE must match exactly: trousers never fill a shorts piece, shorts never fill trousers, a skirt never fills pants, a crewneck never fills a button-up. Omit rather than bend silhouette.\n\nTwo tiers of strictness:\n- GARMENTS (tops, bottoms, dresses, outerwear): silhouette and color fidelity matter — omit the piece if nothing genuinely matches the design.\n- ACCESSORIES & SHOES (shoes, bag, belt, sunglasses, jewelry): a finished board beats a perfect match — choose the CLOSEST available candidate of the right type even if the details differ from the design, and say in the note how to make it work. Only omit when no candidate of that type exists at all.

PALETTE DISCIPLINE (overrides everything except the type rule): the collection's palette is sacred. Judge each candidate's color from its title/type/tags. A GARMENT whose evident color sits outside the designed piece's color family breaks the board — omit instead. An ACCESSORY should sit inside the palette or stay neutral (black, cream, tan, leather, tortoise, the palette's metal); NEVER introduce a saturated color the palette doesn't contain.`,
      },
    ],
    output_config: { format: zodOutputFormat(PieceMatchSchema) },
  });
  if (!response.parsed_output) throw new Error("Could not match pieces to products");
  return response.parsed_output;
}

const CuratedLookbookSchema = z.object({
  title: z.string().describe("Evocative lookbook title, 2-6 words"),
  description: z
    .string()
    .describe("One or two sentences a stylist would write introducing this collection to the client"),
  picks: z
    .array(
      z.object({
        index: z.number().describe("The candidate's number from the list"),
        color_hex: z.string().describe("Dominant color as 6-digit hex, inferred from title/tags"),
        category: z.enum(CATEGORIES),
        note: z
          .string()
          .describe("A warm, specific styling note to the client — how to wear it, what it pairs with in this collection"),
      })
    )
    .describe("The chosen pieces, in outfit order (outerwear/tops first). Cohesive as a wardrobe, varied categories, no near-duplicates."),
});

export type CuratedLookbook = z.infer<typeof CuratedLookbookSchema>;

/** Curate a client lookbook from REAL candidate products (Discover pipeline). */
export async function curateLookbook(
  brief: string,
  clientName: string | null,
  candidateLines: string,
  count: number
): Promise<CuratedLookbook> {
  const forClient = clientName ? ` The client's name is ${clientName}.` : "";
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: STYLIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Curate a lookbook of exactly ${count} pieces from these real, in-stock products.${forClient}\n\nBrief: "${brief}"\n\nCandidates:\n${candidateLines}\n\nChoose pieces that work together as outfits (tops + bottoms + shoes + finishing pieces), spread across at least three stores when quality allows, and write the title, intro, and a styling note per piece addressed to the client.`,
      },
    ],
    output_config: { format: zodOutputFormat(CuratedLookbookSchema) },
  });
  if (!response.parsed_output) throw new Error("Could not curate the lookbook");
  return response.parsed_output;
}

const GeneratedItemSchema = z.object({
  name: z.string().describe("Short product name, e.g. 'Cropped wool blazer'"),
  brand: z
    .string()
    .describe("A plausible real-world brand that sells this kind of piece"),
  category: z.enum(CATEGORIES),
  color_hex: z
    .string()
    .describe(
      "Dominant color as a 6-digit lowercase hex like #1e3a8a. Pick realistic garment colors, varied across the set."
    ),
  price_dollars: z
    .number()
    .describe("Realistic retail price in US dollars"),
});

const GeneratedItemsSchema = z.object({
  items: z.array(GeneratedItemSchema),
});

const GeneratedWardrobeSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      brand: z.string(),
      category: z.enum(CATEGORIES),
      color_hex: z
        .string()
        .describe("Dominant color as a 6-digit lowercase hex like #1e3a8a"),
      notes: z
        .string()
        .describe("One short note on fit, condition, or how it's worn"),
    })
  ),
});

const GeneratedLookbookSchema = z.object({
  title: z.string().describe("Evocative lookbook title, 2-6 words"),
  description: z
    .string()
    .describe("One or two sentences a stylist would write introducing this collection to a client"),
  items: z.array(
    GeneratedItemSchema.extend({
      note: z
        .string()
        .describe(
          "A warm, specific styling note written to the client about this piece — how to wear it, what it pairs with"
        ),
    })
  ),
});

const ExtractedProductSchema = z.object({
  name: z.string().describe("Clean product name without brand or marketing suffixes"),
  brand: z.string().describe("The brand or retailer name; empty string if truly unknown"),
  category: z.enum(CATEGORIES),
  price_dollars: z
    .number()
    .describe("Price in US dollars; 0 if not determinable from the page"),
  color_hex: z
    .string()
    .describe(
      "Best guess at the product's dominant color as 6-digit hex, from color names in the text (e.g. 'sawdust' ≈ #c9b899). Use #808080 only if there is no color signal at all."
    ),
});

export type ExtractedProduct = z.infer<typeof ExtractedProductSchema>;

export async function extractProductFromPage(
  url: string,
  pageHead: string
): Promise<ExtractedProduct> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system:
      "You extract structured product data from e-commerce page metadata for a stylist's app. Be precise; infer sensibly from titles, meta tags, and JSON-LD.",
    messages: [
      {
        role: "user",
        content: `Extract the product from this page.\n\nURL: ${url}\n\nPage <head> content:\n${pageHead}`,
      },
    ],
    output_config: { format: zodOutputFormat(ExtractedProductSchema) },
  });

  if (!response.parsed_output) throw new Error("Could not extract product data");
  return response.parsed_output;
}

/**
 * Vision tasks (pick / locate) don't need full-res photos — Shopify CDNs
 * serve resized variants via ?width=, cutting image tokens ~5-8x. Bounding
 * boxes are percentages, so downstream crops still use the original.
 */
const visionThumb = (url: string): string => {
  if (!url.includes("cdn.shopify.com")) return url;
  return url.includes("?") ? `${url}&width=640` : `${url}?width=640`;
};

const BestImageSchema = z.object({
  index: z
    .number()
    .describe("Zero-based index of the best image for a flat-lay collage"),
  flat: z
    .boolean()
    .describe(
      "true only if the chosen image shows the product ALONE — flat-lay, ghost mannequin, or plain product shot with no person wearing it"
    ),
});

export type BestImage = { index: number; flat: boolean };

/**
 * Given product photo URLs, pick the one that will look best cut out on a
 * white collage, and report whether it's a true product-only shot. Items
 * without a flat shot stay off the collage canvas.
 */
const PICK_PROMPT =
  "These are photos of ONE clothing product, labeled Image 0..N. Pick the best photo to cut out for a stylist's collage. Preference order: (1) ghost/invisible-mannequin shot, (2) flat-lay, (3) plain product still, (4) on-model ONLY if no product-only shot exists. Requirements: full garment visible, front-facing, uncropped. REJECT fabric/detail close-ups, back views, packaging, and any image whose color/pattern differs from Image 0 (variant colorways). NEVER pick a folded or stacked garment when any unfolded view exists — folded shots read as squares on a collage. Ties go to the lower index. Set flat=true only if the chosen image shows the product with no person wearing it; treat a visible mannequin with limbs, head, or torso the same as a model (flat=false). If every image has a model, pick the plainest, most frontal full-body one and set flat=false.";

async function pickFrom(imageUrls: string[]): Promise<BestImage | null> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          // Label each image so the model's indices stay anchored
          ...imageUrls.slice(0, 8).flatMap((url, i) => [
            { type: "text" as const, text: `Image ${i}:` },
            {
              type: "image" as const,
              source: { type: "url" as const, url: visionThumb(url) },
            },
          ]),
          { type: "text" as const, text: PICK_PROMPT },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(BestImageSchema) },
  });
  const out = response.parsed_output;
  if (!out) return null;
  return {
    index: out.index >= 0 && out.index < imageUrls.length ? out.index : 0,
    flat: out.flat,
  };
}

export async function pickBestImage(imageUrls: string[]): Promise<BestImage> {
  if (imageUrls.length === 0) return { index: 0, flat: false };
  try {
    return (await pickFrom(imageUrls)) ?? { index: 0, flat: false };
  } catch {
    // One dead deep URL shouldn't dump the item into the worst on-model
    // path — retry judging just the primary image before giving up.
    try {
      return (await pickFrom([imageUrls[0]])) ?? { index: 0, flat: false };
    } catch {
      return { index: 0, flat: false };
    }
  }
}

const PaletteCheckSchema = z.object({
  verdicts: z.array(
    z.object({
      item: z.number().describe("Item number exactly as labeled"),
      ok: z
        .boolean()
        .describe("true if the product photo's dominant color belongs to the designed color family"),
    })
  ),
});

/**
 * Vision pass over final picks: product titles lie about color ("chocolate"
 * that photographs olive), and text matching can't see that. Batched
 * thumbnails keep this to 1-2 calls per lookbook. Items missing from the
 * result (or a failed batch) default to keep — density beats paranoia.
 */
export async function verifyPaletteMatches(
  checks: Array<{ item: number; imageUrl: string; want: string }>
): Promise<Map<number, boolean>> {
  const out = new Map<number, boolean>();
  for (let i = 0; i < checks.length; i += 10) {
    const batch = checks.slice(i, i + 10);
    try {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              ...batch.flatMap((c) => [
                { type: "text" as const, text: `Item ${c.item} — designed as: ${c.want}` },
                {
                  type: "image" as const,
                  source: { type: "url" as const, url: visionThumb(c.imageUrl) },
                },
              ]),
              {
                type: "text" as const,
                text: "For each numbered item judge ONLY color: does the product photo's dominant color belong to the designed color family? Neutrals (black, white, cream, tan, brown, grey, denim, natural leather, tortoise, gold, silver) are compatible with any palette unless the design names a different specific color. BE CONSERVATIVE: if the color is plausibly compatible, adjacent in tone (coffee vs dark brown, ivory vs white), or you are unsure, mark ok=true. Mark ok=false ONLY for an obvious clash — a saturated or clearly different hue family the design does not name.",
              },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(PaletteCheckSchema) },
      });
      for (const v of response.parsed_output?.verdicts ?? []) out.set(v.item, v.ok);
    } catch {
      // batch failed — those items default to keep
    }
  }
  return out;
}

const GarmentBoxSchema = z.object({
  found: z
    .boolean()
    .describe(
      "true only if a clean product-only crop exists. false when the crop would inevitably contain the model's face or mostly bare skin (jewelry/watches worn on hands, products smaller than ~10% of frame)"
    ),
  left: z.number().describe("Left edge of the box, percent of image width (0-100)"),
  top: z.number().describe("Top edge, percent of image height (0-100)"),
  width: z.number().describe("Box width, percent of image width"),
  height: z.number().describe("Box height, percent of image height"),
});

export type GarmentBox = z.infer<typeof GarmentBoxSchema>;

/**
 * For on-model photos: locate just the garment so we can crop a clean
 * headless torso shot (the Hue & Stripe treatment for worn pieces).
 */
export async function locateGarment(
  imageUrl: string,
  productName: string
): Promise<GarmentBox | null> {
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            { type: "image" as const, source: { type: "url" as const, url: visionThumb(imageUrl) } },
            {
              type: "text" as const,
              text: `Find the "${productName}" in this photo. Return a tight bounding box around ONLY that product as percentages of the image (0-100). The box must NEVER include the model's face or head — start it at the shoulders/neckline (unless the product is headwear). Exclude body parts that aren't covered by the product. A little margin (2-3%) around the product is good. STRONGLY PREFER returning a box with found=true — nearly every product has one: a shirt is the neck-to-hem torso, pants are waist-to-ankle, shoes are the feet, a bag is the bag itself. Set found=false ONLY in two cases: (1) the product sits on or beside the face (worn sunglasses, earrings, hats) so the face cannot be excluded, or (2) the product is jewelry or a watch worn on a bare hand/wrist/neck where the crop would be mostly skin. If the photo is actually a product-only shot with no person, box the whole product with found=true.`,
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(GarmentBoxSchema) },
    });
    const box = response.parsed_output;
    if (!box || !box.found || box.width < 10 || box.height < 10) return null;
    // Near-full-frame boxes on editorial shots tend to sneak the face in —
    // nudge the top down to roughly chin height
    if (box.top < 8 && box.height > 72) {
      const trim = 10 - box.top;
      box.top += trim;
      box.height = Math.max(10, box.height - trim);
    }
    return box;
  } catch {
    return null;
  }
}

const DiscoveryPlanSchema = z.object({
  store_ids: z
    .array(z.string())
    .describe("IDs of the 4-6 stores whose vibe and price tier best match the brief"),
  keywords: z
    .array(z.string())
    .describe(
      "8-12 lowercase search terms likely to appear in product titles, types, or tags. Prefer single-word stems ('linen', 'trouser', 'blazer', 'stripe', 'vest', 'scarf', 'cream', 'loafer'); use two words only when both must co-occur ('wide leg')"
    ),
});

export type DiscoveryPlan = z.infer<typeof DiscoveryPlanSchema>;

export async function planDiscovery(
  brief: string,
  storeCatalog: string
): Promise<DiscoveryPlan> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: STYLIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `A stylist wants to source real products for this brief: "${brief}"\n\nAvailable stores:\n${storeCatalog}\n\nPick the stores to search and the keywords to search with.`,
      },
    ],
    output_config: { format: zodOutputFormat(DiscoveryPlanSchema) },
  });
  if (!response.parsed_output) throw new Error("Could not plan the search");
  return response.parsed_output;
}

const DiscoveryPicksSchema = z.object({
  picks: z
    .array(
      z.object({
        index: z.number().describe("The candidate's number from the list"),
        color_hex: z
          .string()
          .describe("Dominant color as 6-digit hex, inferred from the title/tags"),
        category: z.enum(CATEGORIES),
        why: z.string().describe("Five words or fewer on why it fits the brief"),
      })
    )
    .describe("The best matches for the brief, strongest first. Up to 20."),
});

export type DiscoveryPicks = z.infer<typeof DiscoveryPicksSchema>;

export async function rankDiscovered(
  brief: string,
  candidateLines: string
): Promise<DiscoveryPicks> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: STYLIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Brief: "${brief}"\n\nCandidate products (real, in stock):\n${candidateLines}\n\nPick up to 20 that genuinely fit the brief — cohesive as a set, varied across categories, no near-duplicates. Spread picks across at least three stores when quality allows, so the client sees range.`,
      },
    ],
    output_config: { format: zodOutputFormat(DiscoveryPicksSchema) },
  });
  if (!response.parsed_output) throw new Error("Could not rank products");
  return response.parsed_output;
}

export type GeneratedItem = z.infer<typeof GeneratedItemSchema>;
export type GeneratedWardrobe = z.infer<typeof GeneratedWardrobeSchema>;
export type GeneratedLookbook = z.infer<typeof GeneratedLookbookSchema>;

const STYLIST_SYSTEM =
  "You are an expert personal stylist and fashion buyer with encyclopedic knowledge of " +
  "real brands, silhouettes, fabrics, and color theory. You generate realistic, varied, " +
  "tasteful clothing data for a stylist's toolbox app. Colors should be true to how the " +
  "garment would actually look; prices should match the named brand's real market position.";

export async function generateItems(
  brief: string,
  count: number
): Promise<GeneratedItem[]> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: STYLIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Generate exactly ${count} clothing items for a stylist's recommendation library. Brief from the stylist: "${brief}". Vary categories and colors sensibly across the set.`,
      },
    ],
    output_config: { format: zodOutputFormat(GeneratedItemsSchema) },
  });

  if (!response.parsed_output) throw new Error("AI returned no items");
  return response.parsed_output.items;
}

export async function generateWardrobe(
  persona: string,
  count: number
): Promise<GeneratedWardrobe["items"]> {
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: STYLIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Generate exactly ${count} wardrobe items this client would already own, based on the stylist's description of them: "${persona}". These are existing closet pieces (mix of ages and price points), not new recommendations.`,
      },
    ],
    output_config: { format: zodOutputFormat(GeneratedWardrobeSchema) },
  });

  if (!response.parsed_output) throw new Error("AI returned no wardrobe items");
  return response.parsed_output.items;
}

export async function generateLookbook(
  brief: string,
  clientName: string | null,
  itemCount: number
): Promise<GeneratedLookbook> {
  const forClient = clientName ? ` The client's name is ${clientName}.` : "";
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: STYLIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Create a complete lookbook with exactly ${itemCount} pieces. Stylist's brief: "${brief}".${forClient} The pieces should work together as a cohesive collection, and each styling note should reference how it fits into the overall look.`,
      },
    ],
    output_config: { format: zodOutputFormat(GeneratedLookbookSchema) },
  });

  if (!response.parsed_output) throw new Error("AI returned no lookbook");
  return response.parsed_output;
}
