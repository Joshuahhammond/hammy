import "server-only";

/**
 * Read a PNG's pixel dimensions from its IHDR header via a 64-byte range
 * request — cheap enough to run for every board item at render time.
 * Cutout URLs are immutable (uuid filenames), so cache aggressively.
 */
export async function probeAspect(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-63", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 86400 },
    });
    if (!res.ok && res.status !== 206) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    // PNG signature then IHDR: width at bytes 16-19, height at 20-23 (big-endian)
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    const w = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
    const h = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
    if (w <= 0 || h <= 0) return null;
    return w / h;
  } catch {
    return null;
  }
}
