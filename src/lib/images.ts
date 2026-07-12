import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GarmentBox } from "@/lib/ai";

/**
 * Turn a retailer product photo into a transparent cutout and host it in
 * Supabase Storage. Pass a crop box (percentages) for on-model shots to
 * produce a headless garment crop first. Falls back to the original URL
 * if anything fails — a boxed image beats a broken one.
 */
export async function processProductImage(
  imageUrl: string,
  ownerId: string,
  supabase: SupabaseClient,
  crop?: GarmentBox | null
): Promise<string> {
  if (!imageUrl) return "";
  try {
    const { removeBackground } = await import("@imgly/background-removal-node");
    const sharp = (await import("sharp")).default;

    // Always work from a fetched buffer so every fallback path can still
    // upload SOMETHING to our bucket — pieces must never miss the canvas.
    const res = await fetch(imageUrl, {
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    let sourceBuf = Buffer.from(await res.arrayBuffer());

    if (crop) {
      const img = sharp(sourceBuf);
      const meta = await img.metadata();
      const W = meta.width ?? 0;
      const H = meta.height ?? 0;
      if (W > 0 && H > 0) {
        const left = Math.max(0, Math.round((crop.left / 100) * W));
        const top = Math.max(0, Math.round((crop.top / 100) * H));
        const width = Math.min(W - left, Math.round((crop.width / 100) * W));
        const height = Math.min(H - top, Math.round((crop.height / 100) * H));
        if (width > 40 && height > 40) {
          sourceBuf = await img.extract({ left, top, width, height }).png().toBuffer();
        }
      }
    }

    const blob = await removeBackground(
      new Blob([new Uint8Array(sourceBuf)], { type: "image/png" }),
      { output: { format: "image/png", quality: 0.9 } }
    );
    let upload = Buffer.from(await blob.arrayBuffer());

    // Quality gate: low-contrast garments get shredded by segmentation —
    // a near-empty cutout falls back to the clean rectangle photo, which
    // still belongs on the board (reference boards mix both).
    try {
      const stats = await sharp(upload).ensureAlpha().stats();
      const alpha = stats.channels[3];
      const coverage = (alpha?.mean ?? 255) / 255;
      if (coverage < 0.2) {
        // Trim the rectangle tight to its content so a white product photo
        // blends into the canvas like a cutout instead of reading as a card
        upload = await sharp(sourceBuf).trim({ threshold: 25 }).png().toBuffer();
      }
    } catch {
      // stats failed — keep the cutout as-is
    }

    const path = `${ownerId}/${crypto.randomUUID()}.png`;
    const { error } = await supabase.storage
      .from("cutouts")
      .upload(path, upload, { contentType: "image/png" });
    if (error) throw error;

    const { data } = supabase.storage.from("cutouts").getPublicUrl(path);
    return data.publicUrl;
  } catch (err) {
    console.error("cutout failed, keeping original image:", err);
    return imageUrl;
  }
}
