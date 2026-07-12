// Compose lookbook items into outfit "looks" and assign collage positions.
// Layout mirrors a stylist's board: dressed columns (top over bottom, or a
// dress) side by side, shoes at the foot, bags overlaying column edges,
// trinkets in the gaps between column tops.

export type LookItem = {
  id: string;
  name: string;
  brand: string;
  category: string;
  price_cents: number | null;
  product_url: string;
  image_url: string;
  color_hex: string;
  note: string;
  /** explicit outfit number (0 = ungrouped legacy items) */
  look_no?: number;
};

/** Group by explicit outfit numbers when present, else fall back to recipe */
export function groupLookbookItems(items: LookItem[]): LookItem[][] {
  const tagged = items.filter((i) => (i.look_no ?? 0) > 0);
  if (tagged.length === 0) return groupIntoLooks(items);

  const byNo = new Map<number, LookItem[]>();
  for (const item of items) {
    const no = item.look_no && item.look_no > 0 ? item.look_no : 999; // stragglers last
    byNo.set(no, [...(byNo.get(no) ?? []), item]);
  }
  return [...byNo.entries()].sort(([a], [b]) => a - b).map(([, group]) => group);
}

export type Slot = {
  left: number; // percentages of the canvas
  top: number;
  width: number;
  height: number;
  z: number;
  rotate: number;
  /** anchor within the slot: tops hang to their hem, bottoms hang from the waist */
  align?: "top" | "bottom";
  /** horizontal anchor so letterboxed cutouts hug their rail, not the slot center */
  alignX?: "left" | "right";
};

const take = (pools: Map<string, LookItem[]>, key: string, n: number): LookItem[] =>
  pools.get(key)?.splice(0, n) ?? [];

/**
 * Distribute items into balanced outfits. Per look: up to 3 headliner
 * garments (outerwear/dress/tops), 2 bottoms, 2 shoes, 3 accessories/other.
 */
export function groupIntoLooks(items: LookItem[]): LookItem[][] {
  const pools = new Map<string, LookItem[]>();
  for (const item of items) {
    const key = ["outerwear", "dresses", "tops", "bottoms", "shoes", "accessories"].includes(item.category)
      ? item.category
      : "other";
    pools.set(key, [...(pools.get(key) ?? []), item]);
  }

  const looks: LookItem[][] = [];
  while ([...pools.values()].some((p) => p.length > 0)) {
    const look: LookItem[] = [];
    look.push(...take(pools, "outerwear", 1));
    look.push(...take(pools, "dresses", Math.max(0, 2 - look.length)));
    look.push(...take(pools, "tops", 3 - look.length));
    look.push(...take(pools, "bottoms", 2));
    look.push(...take(pools, "shoes", 2));
    look.push(...take(pools, "accessories", 3));
    look.push(...take(pools, "other", 1));
    if (look.length === 0) break;
    looks.push(look);
  }

  if (looks.length > 1 && looks[looks.length - 1].length < 3) {
    const last = looks.pop()!;
    looks[looks.length - 1].push(...last);
  }
  return looks;
}

// Accessory subtypes place differently (bag beside the column, belt at the
// waist, sunglasses/jewelry sprinkled top-left) — classify by name
export function accKind(name: string): "bag" | "belt" | "sunglasses" | "jewelry" | "other" {
  if (/bag|tote|clutch|crossbody|crescent|satchel|hobo/i.test(name)) return "bag";
  if (/belt/i.test(name)) return "belt";
  if (/sunglass|eyewear|frames/i.test(name)) return "sunglasses";
  if (/earring|necklace|ring|bracelet|hoop|pendant|choker|chain|watch|cuff|jewel/i.test(name)) return "jewelry";
  return "other";
}

/** Only transparent cutouts belong on the collage canvas */
export const isCutout = (url: string) => url.includes("/cutouts/");

/**
 * Cutouts that may contain body fragments or an opaque rectangle — these
 * never earn the dressed hem-over-waist overlap. Legacy suffix-less URLs
 * read as flat so existing boards don't regress.
 */
export const isModelCrop = (url: string) => /\.(model|card)\.png($|[?#])/.test(url);

/**
 * Column-packed composition (Stefana Silber / Hue & Stripe style): every
 * top pairs with a bottom into a dressed column, dresses and unpaired
 * garments hold columns alone — up to 4 columns side by side, so a 14-piece
 * capsule reads as interlocking mini-outfits instead of dropping garments.
 */
export function composeLook(items: LookItem[]): Array<{ item: LookItem; slot: Slot }> {
  const withImage = items.filter((i) => i.image_url && isCutout(i.image_url));

  // Miscategorized trinkets must never claim a garment column — a
  // mislabeled "top" earring in a 40%-wide column reads absurd.
  const isSmallAcc = (i: LookItem) =>
    ["jewelry", "sunglasses", "belt"].includes(accKind(i.name));
  const dresses = withImage
    .filter((i) => i.category === "dresses" && !isSmallAcc(i))
    .slice(0, 2);
  const heads = withImage
    .filter((i) => ["outerwear", "tops"].includes(i.category) && !isSmallAcc(i))
    .slice(0, 4);
  const bottoms = withImage
    .filter((i) => i.category === "bottoms" && !isSmallAcc(i))
    .slice(0, 3);
  const shoes = withImage.filter((i) => i.category === "shoes").slice(0, 2);
  const rest = withImage.filter(
    (i) =>
      !dresses.includes(i) && !heads.includes(i) && !bottoms.includes(i) && !shoes.includes(i)
  );
  const bags = rest.filter((i) => accKind(i.name) === "bag").slice(0, 2);
  const belts = rest.filter((i) => accKind(i.name) === "belt").slice(0, 1);
  const sunnies = rest.filter((i) => accKind(i.name) === "sunglasses").slice(0, 1);
  const jewelry = rest.filter((i) => accKind(i.name) === "jewelry").slice(0, 3);
  // Overflow garments don't belong in the rotated corner trinket slots —
  // and neither do surplus trinkets (a second belt at a canvas edge reads
  // as a mistake; it lives in the thumbnail strip instead)
  const GARMENT_CATS = ["outerwear", "dresses", "tops", "bottoms"];
  const others = rest
    .filter(
      (i) =>
        !GARMENT_CATS.includes(i.category) &&
        !isSmallAcc(i) &&
        ![...bags, ...belts, ...sunnies, ...jewelry].includes(i)
    )
    .slice(0, 2);

  const placed: Array<{ item: LookItem; slot: Slot }> = [];
  const put = (item: LookItem | undefined, slot: Slot) => {
    if (item) placed.push({ item, slot });
  };

  // ---- Garment columns -------------------------------------------------
  type Col = { head?: LookItem; bottom?: LookItem; dress?: LookItem };
  const cols: Col[] = [];
  for (let i = 0; i < Math.max(heads.length, bottoms.length); i++) {
    if (heads[i] || bottoms[i]) cols.push({ head: heads[i], bottom: bottoms[i] });
  }
  for (const d of dresses) {
    // Dress goes second-from-right like the references, not tacked on the end
    cols.splice(Math.max(0, cols.length - 1), 0, { dress: d });
  }
  const columns = cols.slice(0, 4);
  const n = columns.length;

  const COL_W = n <= 1 ? 44 : n === 2 ? 40 : n === 3 ? 29 : 22;
  const GAP = n <= 2 ? 6 : 3;
  const startX = 50 - (n * COL_W + (n - 1) * GAP) / 2;

  columns.forEach((col, i) => {
    const x = startX + i * (COL_W + GAP);
    const off = (i % 2) * 3; // stagger alternate columns for organic rhythm
    if (col.dress) {
      put(col.dress, { left: x, top: 2 + off, width: COL_W, height: 74, z: 3, rotate: 0 });
    } else if (col.head && col.bottom) {
      // Overlap is an earned privilege of clean flat cutouts — a column
      // containing a model-crop gets air so bodies never merge.
      const gap = isModelCrop(col.head.image_url) || isModelCrop(col.bottom.image_url) ? 5 : 0;
      put(col.head, {
        left: x, top: 2 + off, width: COL_W, height: 32, z: 4, rotate: 0,
        align: gap ? undefined : "bottom",
      });
      put(col.bottom, {
        left: x + 1, top: 33 + off + gap, width: COL_W - 2, height: 50 - gap, z: 2, rotate: 0,
        align: gap ? undefined : "top",
      });
    } else if (col.head) {
      put(col.head, { left: x, top: 4 + off, width: COL_W, height: 44, z: 3, rotate: 0 });
    } else {
      put(col.bottom, { left: x, top: 3 + off, width: COL_W, height: 72, z: 2, rotate: 0 });
    }
  });

  // ---- Shoes: wide and substantial, overlapping the trouser hems -------
  put(shoes[0], { left: 14, top: 78, width: 28, height: 16, z: 6, rotate: 0, align: "bottom" });
  put(shoes[1], { left: 50, top: 80, width: 26, height: 14, z: 7, rotate: 0, align: "bottom" });

  // ---- Satellites: bags overlay column edges (reference style) ---------
  put(bags[0], { left: 76, top: 52, width: 20, height: 20, z: 5, rotate: 0, alignX: "right" });
  put(bags[1], { left: 2, top: 52, width: 18, height: 18, z: 5, rotate: 0, alignX: "left" });
  // Belt reads right at a waistline, not on a shirt chest: center gap at
  // waist height on multi-column boards, beside the column waist on single
  put(belts[0], n >= 2
    ? { left: 41, top: 52, width: 16, height: 11, z: 6, rotate: -8 }
    : { left: 58, top: 30, width: 16, height: 10, z: 6, rotate: -8 });

  // Trinkets live in the gaps between column tops when there are columns
  // to gap; on single-column boards they stack the left rail. Necklace and
  // chain shots are mostly empty space, so jewelry boxes stay ≥10% wide.
  if (n >= 2) {
    put(sunnies[0], { left: 22, top: 0, width: 14, height: 8, z: 6, rotate: -5 });
    put(jewelry[0], { left: 54, top: 0, width: 12, height: 11, z: 6, rotate: 0 });
    put(jewelry[1], { left: 2, top: 38, width: 11, height: 10, z: 6, rotate: 4, alignX: "left" });
    put(jewelry[2], { left: 86, top: 33, width: 11, height: 10, z: 6, rotate: -3, alignX: "right" });
  } else {
    put(sunnies[0], { left: 4, top: 2, width: 16, height: 9, z: 6, rotate: -5, alignX: "left" });
    put(jewelry[0], { left: 4, top: 14, width: 12, height: 11, z: 6, rotate: 0, alignX: "left" });
    put(jewelry[1], { left: 4, top: 28, width: 10, height: 9, z: 6, rotate: 4, alignX: "left" });
    put(jewelry[2], { left: 86, top: 33, width: 11, height: 10, z: 6, rotate: -3, alignX: "right" });
  }
  put(others[0], { left: 80, top: 66, width: 14, height: 12, z: 5, rotate: 3, alignX: "right" });
  put(others[1], { left: 2, top: 66, width: 13, height: 11, z: 5, rotate: -4, alignX: "left" });

  // References are dense edge-to-edge: a sparse board scales its whole
  // cluster up around the canvas center instead of floating tiny pieces.
  if (placed.length > 0) {
    const minL = Math.min(...placed.map(({ slot }) => slot.left));
    const maxR = Math.max(...placed.map(({ slot }) => slot.left + slot.width));
    const minT = Math.min(...placed.map(({ slot }) => slot.top));
    const maxB = Math.max(...placed.map(({ slot }) => slot.top + slot.height));
    const s = Math.min(1.3, 92 / Math.max(1, maxR - minL), 92 / Math.max(1, maxB - minT));
    if (s > 1.02) {
      const cx = (minL + maxR) / 2;
      const cy = (minT + maxB) / 2;
      for (const { slot } of placed) {
        slot.left = 50 + (slot.left - cx) * s;
        slot.top = 50 + (slot.top - cy) * s;
        slot.width *= s;
        slot.height *= s;
      }
    }
  }

  return placed;
}
