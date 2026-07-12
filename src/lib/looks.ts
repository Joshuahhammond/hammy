// Compose lookbook items into outfit "looks" and assign collage positions.
// Layout mirrors a stylist's board: garments in a row across the top,
// trousers flanking tall on the sides, shoes stacked bottom-center,
// accessories tucked into the middle gaps.

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
 * Column-cluster composition (Stefana Silber style): the outfit reads as a
 * dressed column — top overlapping the trousers below it, shoes at the foot,
 * bag beside the column, small accessories sprinkled around the edges.
 */
export function composeLook(items: LookItem[]): Array<{ item: LookItem; slot: Slot }> {
  const withImage = items.filter((i) => i.image_url && isCutout(i.image_url));

  // Miscategorized trinkets must never claim a hero garment slot — a
  // 13%-wide jewelry slot can't produce a 38%-wide earring card, but a
  // mislabeled "top" earring in the 44×36 hero slot can.
  const isSmallAcc = (i: LookItem) =>
    ["jewelry", "sunglasses", "belt"].includes(accKind(i.name));
  const dress = withImage.find((i) => i.category === "dresses" && !isSmallAcc(i));
  const heads = withImage
    .filter((i) => ["outerwear", "tops"].includes(i.category) && !isSmallAcc(i))
    .slice(0, 3);
  const bottoms = withImage
    .filter((i) => i.category === "bottoms" && !isSmallAcc(i))
    .slice(0, 2);
  const shoes = withImage.filter((i) => i.category === "shoes").slice(0, 2);
  const rest = withImage.filter(
    (i) => i !== dress && !heads.includes(i) && !bottoms.includes(i) && !shoes.includes(i)
  );
  const bags = rest.filter((i) => accKind(i.name) === "bag").slice(0, 1);
  const belts = rest.filter((i) => accKind(i.name) === "belt").slice(0, 1);
  const sunnies = rest.filter((i) => accKind(i.name) === "sunglasses").slice(0, 1);
  const jewelry = rest.filter((i) => accKind(i.name) === "jewelry").slice(0, 2);
  // Overflow garments don't belong in the rotated corner trinket slots
  const GARMENT_CATS = ["outerwear", "dresses", "tops", "bottoms"];
  const others = rest
    .filter(
      (i) =>
        !GARMENT_CATS.includes(i.category) &&
        ![...bags, ...belts, ...sunnies, ...jewelry].includes(i)
    )
    .slice(0, 2);

  const placed: Array<{ item: LookItem; slot: Slot }> = [];
  const put = (item: LookItem | undefined, slot: Slot) => {
    if (item) placed.push({ item, slot });
  };

  if (dress) {
    // Dress owns the column; tops become satellites
    put(dress, { left: 30, top: 2, width: 42, height: 76, z: 3, rotate: 0 });
    put(heads[0], { left: 2, top: 4, width: 30, height: 30, z: 4, rotate: 0, alignX: "left" });
    put(heads[1], { left: 66, top: 2, width: 30, height: 28, z: 2, rotate: 0, alignX: "right" });
    put(bottoms[0], { left: 64, top: 36, width: 32, height: 44, z: 2, rotate: 0, alignX: "right" });
  } else if (heads.length === 0) {
    // No garment for the column top — bottoms take the full height
    put(bottoms[0], { left: 6, top: 3, width: 42, height: 78, z: 2, rotate: 0 });
    put(bottoms[1], { left: 54, top: 5, width: 42, height: 76, z: 2, rotate: 0 });
  } else if (bottoms.length === 0) {
    // Tops-only outfit: garments sit side-by-side large so the canvas
    // stays full instead of leaving the whole lower half empty
    put(heads[0], { left: 6, top: 4, width: 46, height: 60, z: 3, rotate: 0 });
    put(heads[1], { left: 52, top: 8, width: 44, height: 56, z: 2, rotate: 0 });
    put(heads[2], { left: 28, top: 60, width: 36, height: 26, z: 4, rotate: 0 });
  } else {
    // The dressed column: the top's hem meets the trouser's waistband on a
    // shared center axis. Overlap is an earned privilege of clean flat
    // cutouts — model-crops carry body fragments, so they get air instead.
    const crops = [heads[0], bottoms[0]].filter(
      (i) => i && isModelCrop(i.image_url)
    ).length;
    if (crops === 2) {
      // Never stack two body crops: side-by-side, no overlap
      put(heads[0], { left: 4, top: 2, width: 42, height: 46, z: 4, rotate: 0 });
      put(bottoms[0], { left: 52, top: 4, width: 42, height: 62, z: 2, rotate: 0 });
      put(heads[1], { left: 52, top: 70, width: 30, height: 16, z: 3, rotate: 0 });
    } else {
      const gap = crops === 1 ? 5 : 0; // one body crop: 5% air instead of overlap
      put(heads[0], { left: 16, top: 2, width: 44, height: 36, z: 4, rotate: 0, align: gap ? undefined : "bottom" });
      put(bottoms[0], { left: 18, top: 35 + gap, width: 40, height: 50 - gap, z: 2, rotate: 0, align: gap ? undefined : "top" });
      put(heads[1], { left: 62, top: 2, width: 34, height: 30, z: 3, rotate: 0, align: "bottom", alignX: "right" });
      put(heads[2], { left: 2, top: 12, width: 28, height: 26, z: 2, rotate: 0, align: "bottom", alignX: "left" });
      put(bottoms[1], { left: 62, top: 36, width: 34, height: 46, z: 2, rotate: 0, align: "top", alignX: "right" });
    }
  }

  // Reference shoes are wide but short (6-9% tall) and tuck under the
  // trouser hem (85%) by a few percent
  put(shoes[0], { left: 24, top: 81, width: 24, height: 10, z: 5, rotate: 0 });
  put(shoes[1], { left: 54, top: 82, width: 22, height: 9, z: 6, rotate: 0 });

  // Satellites: bag beside the column (left when the right column is busy)
  const rightBusy = bottoms.length > 1 || Boolean(dress);
  put(bags[0], rightBusy
    ? { left: 2, top: 55, width: 20, height: 20, z: 5, rotate: 0, alignX: "left" }
    : { left: 68, top: 52, width: 20, height: 20, z: 5, rotate: 0, alignX: "right" });
  put(belts[0], { left: 64, top: 31, width: 16, height: 9, z: 6, rotate: -8, alignX: "right" });
  put(sunnies[0], { left: 4, top: 2, width: 14, height: 8, z: 6, rotate: -5, alignX: "left" });
  put(jewelry[0], { left: 4, top: 14, width: 8, height: 8, z: 6, rotate: 0, alignX: "left" });
  put(jewelry[1], { left: 5, top: 26, width: 7, height: 7, z: 6, rotate: 4, alignX: "left" });
  put(others[0], { left: 82, top: 64, width: 14, height: 12, z: 5, rotate: 3, alignX: "right" });
  put(others[1], { left: 3, top: 44, width: 13, height: 11, z: 5, rotate: -4, alignX: "left" });

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
