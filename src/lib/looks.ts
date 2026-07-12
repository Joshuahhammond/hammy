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
};

export type Slot = {
  left: number; // percentages of the canvas
  top: number;
  width: number;
  height: number;
  z: number;
  rotate: number;
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

// ——— slot tables (percent coords on a 4:5 canvas) ———

// Garment row across the top, sized by how many share it
const HEAD_SLOTS: Record<number, Slot[]> = {
  1: [{ left: 6, top: 0, width: 52, height: 48, z: 3, rotate: 0 }],
  2: [
    { left: -2, top: 0, width: 48, height: 46, z: 3, rotate: 0 },
    { left: 40, top: 2, width: 46, height: 44, z: 2, rotate: 0 },
  ],
  3: [
    { left: -3, top: 0, width: 40, height: 42, z: 3, rotate: 0 },
    { left: 30, top: 2, width: 40, height: 42, z: 4, rotate: 0 },
    { left: 63, top: 0, width: 40, height: 42, z: 2, rotate: 0 },
  ],
};

const BOTTOM_SLOTS: Record<number, Slot[]> = {
  1: [{ left: 62, top: 36, width: 38, height: 62, z: 2, rotate: 0 }],
  2: [
    { left: -2, top: 40, width: 34, height: 58, z: 2, rotate: 0 },
    { left: 66, top: 38, width: 36, height: 60, z: 2, rotate: 0 },
  ],
};

const SHOE_SLOTS: Record<number, Slot[]> = {
  1: [{ left: 31, top: 74, width: 36, height: 23, z: 5, rotate: 0 }],
  2: [
    { left: 30, top: 64, width: 34, height: 19, z: 5, rotate: 0 },
    { left: 33, top: 82, width: 34, height: 17, z: 6, rotate: 0 },
  ],
};

// Accessories fill the gaps: center (watch/bag), resting on the top row
// (sunglasses), lower-left pocket
const ACC_SLOTS: Slot[] = [
  { left: 39, top: 45, width: 21, height: 17, z: 6, rotate: 0 },
  { left: 71, top: 1, width: 17, height: 11, z: 7, rotate: -4 },
  { left: 38, top: 64, width: 22, height: 15, z: 6, rotate: -5 },
];

// With no left-flank trouser the left-middle goes dead — pull accessories in
const ACC_SLOTS_LEFTFILL: Slot[] = [
  { left: 8, top: 46, width: 26, height: 22, z: 6, rotate: -4 },
  { left: 40, top: 48, width: 20, height: 16, z: 6, rotate: 3 },
  { left: 71, top: 1, width: 17, height: 11, z: 7, rotate: -4 },
];

// No garments made the canvas (all model shots): bottoms grow to full
// height and accessories stack the center column
const BOTTOM_SLOTS_NOHEAD: Record<number, Slot[]> = {
  1: [{ left: 52, top: 2, width: 46, height: 76, z: 2, rotate: 0 }],
  2: [
    { left: 0, top: 2, width: 44, height: 76, z: 2, rotate: 0 },
    { left: 55, top: 4, width: 44, height: 76, z: 2, rotate: 0 },
  ],
};

const ACC_SLOTS_NOHEAD: Slot[] = [
  { left: 37, top: 8, width: 25, height: 21, z: 6, rotate: -4 },
  { left: 38, top: 34, width: 23, height: 19, z: 6, rotate: 3 },
  { left: 39, top: 58, width: 21, height: 17, z: 6, rotate: -5 },
];

/** Only transparent cutouts belong on the collage canvas */
export const isCutout = (url: string) => url.includes("/cutouts/");

export function composeLook(items: LookItem[]): Array<{ item: LookItem; slot: Slot }> {
  const withImage = items.filter((i) => i.image_url && isCutout(i.image_url));

  const heads = withImage
    .filter((i) => ["outerwear", "dresses", "tops"].includes(i.category))
    .slice(0, 3);
  const bottoms = withImage.filter((i) => i.category === "bottoms").slice(0, 2);
  const shoes = withImage.filter((i) => i.category === "shoes").slice(0, 2);
  const noHeads = heads.length === 0;
  const accSlots = noHeads
    ? ACC_SLOTS_NOHEAD
    : bottoms.length < 2
      ? ACC_SLOTS_LEFTFILL
      : ACC_SLOTS;
  const accs = withImage
    .filter((i) => !heads.includes(i) && !bottoms.includes(i) && !shoes.includes(i))
    .slice(0, accSlots.length);

  const placed: Array<{ item: LookItem; slot: Slot }> = [];

  const headSlots = HEAD_SLOTS[heads.length as 1 | 2 | 3] ?? [];
  heads.forEach((item, i) => {
    let slot = headSlots[i];
    // A dress needs a taller run than a top
    if (item.category === "dresses") {
      slot = { ...slot, height: slot.height + 18, z: slot.z - 1 };
    }
    placed.push({ item, slot });
  });

  const bottomTable = noHeads ? BOTTOM_SLOTS_NOHEAD : BOTTOM_SLOTS;
  (bottomTable[bottoms.length as 1 | 2] ?? []).forEach((slot, i) =>
    placed.push({ item: bottoms[i], slot })
  );
  (SHOE_SLOTS[shoes.length as 1 | 2] ?? []).forEach((slot, i) =>
    placed.push({ item: shoes[i], slot })
  );
  accs.forEach((item, i) => placed.push({ item, slot: accSlots[i] }));

  return placed;
}
