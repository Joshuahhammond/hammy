import "server-only";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { autoscale, composeLook, isCutout, type LookItem, type Slot } from "@/lib/looks";
import { probeAspect } from "@/lib/dims";

const client = new Anthropic();
const MODEL = "claude-opus-4-8";

const CANVAS_W = 800;
const CANVAS_H = 1000;

/** Composite the board exactly as the share page renders it. */
async function composeBoardPng(
  placed: Array<{ item: LookItem; slot: Slot }>
): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const layers = (
    await Promise.all(
      placed.map(async ({ item, slot }) => {
        try {
          const res = await fetch(item.image_url, {
            signal: AbortSignal.timeout(10000),
            next: { revalidate: 86400 },
          });
          const buf = Buffer.from(await res.arrayBuffer());
          const w = Math.max(8, Math.round((slot.width / 100) * CANVAS_W));
          const h = Math.max(8, Math.round((slot.height / 100) * CANVAS_H));
          const png = await sharp(buf)
            .resize(w, h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
          return {
            input: png,
            left: Math.round((slot.left / 100) * CANVAS_W),
            top: Math.round((slot.top / 100) * CANVAS_H),
            z: slot.z,
          };
        } catch {
          return null;
        }
      })
    )
  )
    .filter((l): l is NonNullable<typeof l> => Boolean(l))
    .sort((a, b) => a.z - b.z)
    .map(({ input, left, top }) => ({ input, left, top }));

  return sharp({
    create: {
      width: CANVAS_W,
      height: CANVAS_H,
      channels: 4,
      background: { r: 244, g: 239, b: 230, alpha: 1 },
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
}

const CritiqueSchema = z.object({
  looks_professional: z
    .boolean()
    .describe("true if the board already matches the reference rules and needs no changes"),
  adjustments: z
    .array(
      z.object({
        item: z.number().describe("The item's number from the legend"),
        dx: z.number().describe("Horizontal shift in percent of canvas width (-20..20, negative = left)"),
        dy: z.number().describe("Vertical shift in percent of canvas height (-20..20, negative = up)"),
        scale: z.number().describe("Size multiplier (0.7..1.4, 1 = keep)"),
      })
    )
    .describe("Nudges for ONLY the items that need moving; empty if none"),
});

/**
 * Post-generation art director: Claude reviews the rendered collage against
 * the reference rules and nudges items. Up to two rounds per look.
 */
export async function refineBoards(db: SupabaseClient, lookbookId: string): Promise<void> {
  const { data: rows } = await db
    .from("lookbook_items")
    .select("id, look_no, note, items(name, brand, category, kind, image_url, color_hex, product_url, price_cents)")
    .eq("lookbook_id", lookbookId)
    .order("look_no")
    .order("position");
  if (!rows || rows.length === 0) return;

  const byLook = new Map<number, typeof rows>();
  for (const r of rows) {
    const no = r.look_no ?? 0;
    byLook.set(no, [...(byLook.get(no) ?? []), r]);
  }

  for (const [no, group] of byLook) {
    try {
      const items: LookItem[] = await Promise.all(
        group.map(async (r) => {
          const it = r.items as unknown as {
            name: string; brand: string; category: string; kind: string;
            image_url: string; color_hex: string; product_url: string; price_cents: number | null;
          };
          return {
            id: r.id, // lookbook_item id — the row we write the slot back to
            name: it.name,
            brand: it.brand,
            category: it.category,
            kind: it.kind,
            price_cents: it.price_cents,
            product_url: it.product_url,
            image_url: it.image_url,
            color_hex: it.color_hex,
            note: r.note ?? "",
            look_no: no,
            aspect: isCutout(it.image_url) ? await probeAspect(it.image_url) : null,
          };
        })
      );

      const placed = composeLook(items);
      if (placed.length < 3) continue;

      for (let round = 0; round < 3; round++) {
        const png = await composeBoardPng(placed);
        const legend = placed
          .map(({ item }, i) => `${i}. ${item.kind || item.category}: ${item.name}`)
          .join("\n");
        const response = await client.messages.parse({
          model: MODEL,
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: png.toString("base64"),
                  },
                },
                {
                  type: "text" as const,
                  text: `This is a stylist's outfit collage. Items by number:\n${legend}\n\nJudge it against professional reference rules: (1) nothing clipped by or touching the canvas edge — keep a clean ~4% margin frame; (2) garments read at uniform scale, in dressed columns with each bottom's waistband a small even gap under its top's hem; (3) accessories follow dressing order — sunglasses near the top, necklace at a neckline, belt at a waist junction in open space, shoes clustered at the foot; (4) even gutters, no accidental collisions (a deliberate tuck like a shoe overlapping a trouser hem or shirts layered in a cascade is good; an accessory or shoe sitting ON TOP of a garment's body is not); (5) the composition must FILL the canvas — spread items so no region larger than ~20% of the board is empty; never crowd everything into one corner. Return nudges only for items that need them (dx/dy percent, scale). If it already reads professional, set looks_professional=true with no adjustments.`,
                },
              ],
            },
          ],
          output_config: { format: zodOutputFormat(CritiqueSchema) },
        });
        const out = response.parsed_output;
        if (!out || out.looks_professional || out.adjustments.length === 0) break;
        for (const adj of out.adjustments) {
          const p = placed[adj.item];
          if (!p) continue;
          const s = p.slot;
          const scale = Math.min(1.4, Math.max(0.7, adj.scale || 1));
          const cx = s.left + s.width / 2 + Math.max(-30, Math.min(30, adj.dx || 0));
          const cy = s.top + s.height / 2 + Math.max(-30, Math.min(30, adj.dy || 0));
          s.width *= scale;
          s.height *= scale;
          s.left = Math.min(97 - s.width, Math.max(3, cx - s.width / 2));
          s.top = Math.min(98 - s.height, Math.max(1.5, cy - s.height / 2));
        }
        // Re-normalize after nudges: fill the canvas and re-clamp margins,
        // so a round of moves can never persist a crowded corner + void
        autoscale(placed);
        console.log(
          `[lookbook ${lookbookId}] critique look ${no} round ${round + 1}: ${out.adjustments.length} nudges`
        );
      }

      await Promise.all(
        placed.map(({ item, slot }) =>
          db.from("lookbook_items").update({ slot }).eq("id", item.id)
        )
      );
    } catch (err) {
      console.error(`[lookbook ${lookbookId}] critique skipped for look ${no}:`, err);
    }
  }
}
