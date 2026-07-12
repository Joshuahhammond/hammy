import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { CATEGORIES } from "@/lib/types";

const MODEL = "claude-opus-4-8";

// Resolves ANTHROPIC_API_KEY from the environment
const client = new Anthropic();

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
