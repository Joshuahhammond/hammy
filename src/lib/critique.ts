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
      background: { r: 255, g: 255, b: 255, alpha: 1 },
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
  bench: z
    .array(z.number())
    .describe(
      "Item numbers to REMOVE from the canvas entirely (they stay in the product strip below). Use for clutter: duplicate accessory kinds, items sitting on top of a garment's body, photo-cards that break the collage"
    ),
  nudges: z
    .array(
      z.object({
        item: z.number().describe("The item's number from the legend"),
        dx: z.number().describe("Small horizontal shift, percent (-8..8, negative = left)"),
        dy: z.number().describe("Small vertical shift, percent (-8..8, negative = up)"),
      })
    )
    .describe("Small position corrections only — you cannot resize items"),
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

      let activeItems = items;
      const benchedIds = new Set<string>();
      let placed = composeLook(activeItems);
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
                  text: `This is a stylist's outfit collage. Items by number:\n${legend}\n\nYou are the final quality gate, not the designer — the layout engine already placed everything by its rules. Your ONLY tools: BENCH an item (removes it from the canvas; it stays in the product strip) and small nudges (±8%). Bench anything that ruins the board: an item sitting ON TOP of a garment's body, a duplicate accessory kind, a garment so mis-scaled it reads as clutter. Framed product cards and clean on-model torso fragments are part of this editorial collage language — do NOT bench those for being what they are. Nudge only to fix a small collision or close a small gap. Most boards need NOTHING — if it reads professional, set looks_professional=true with empty lists. Never try to redesign the composition.`,
                },
              ],
            },
          ],
          output_config: { format: zodOutputFormat(CritiqueSchema) },
        });
        const out = response.parsed_output;
        if (!out || out.looks_professional || (out.bench.length === 0 && out.nudges.length === 0))
          break;
        if (out.bench.length > 0) {
          // Recompose the whole board without the benched items — holes
          // where they stood would read worse than the clutter did
          for (const bi of new Set(out.bench)) {
            const p = placed[bi];
            if (p) benchedIds.add(p.item.id);
          }
          activeItems = activeItems.filter((i) => !benchedIds.has(i.id));
          placed = composeLook(activeItems);
          console.log(
            `[lookbook ${lookbookId}] critique look ${no} round ${round + 1}: ${out.bench.length} benched (recomposed)`
          );
          continue; // fresh render next round
        }
        for (const adj of out.nudges) {
          const p = placed[adj.item];
          if (!p) continue;
          const s = p.slot;
          s.left += Math.max(-8, Math.min(8, adj.dx || 0));
          s.top += Math.max(-8, Math.min(8, adj.dy || 0));
          s.left = Math.min(97 - s.width, Math.max(3, s.left));
          s.top = Math.min(98 - s.height, Math.max(1.5, s.top));
        }
        // Re-normalize: fill the canvas and re-clamp margins
        autoscale(placed);
        console.log(
          `[lookbook ${lookbookId}] critique look ${no} round ${round + 1}: ${out.nudges.length} nudges`
        );
      }

      await Promise.all([
        ...placed.map(({ item, slot }) =>
          db.from("lookbook_items").update({ slot }).eq("id", item.id)
        ),
        ...[...benchedIds].map((id) =>
          db.from("lookbook_items").update({ slot: { benched: true } }).eq("id", id)
        ),
      ]);
    } catch (err) {
      console.error(`[lookbook ${lookbookId}] critique skipped for look ${no}:`, err);
    }
  }
}
