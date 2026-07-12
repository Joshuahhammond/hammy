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

// ---------------------------------------------------------------------------
// Board templates: fixed, art-directed grids traced from reference collages
// (Stefana Silber / Hue & Stripe). Every zone — bags, sunglasses, belts,
// shoes — has a designed position, size, and overlap relative to its
// neighbors, so a board that fits a template always looks composed. A
// template is selected by what the outfit actually contains; looks that fit
// no template fall back to the procedural column packer.
// ---------------------------------------------------------------------------

type SlotKind =
  | "head" | "bottom" | "dress" | "shoes" | "bag"
  | "belt" | "sunglasses" | "jewelry" | "other";
type TSlot = Slot & { kind: SlotKind };
type Template = {
  id: string;
  /** minimum item counts for this template to apply */
  needs: Partial<Record<SlotKind, number>>;
  /** [head slot index, bottom slot index] dressed-column pairs (for model-crop air) */
  pairs?: Array<[number, number]>;
  slots: TSlot[];
};

const TEMPLATES: Template[] = [
  {
    // Women's 3-column capsule + dress (traced from Stefana chocolate board)
    id: "capsule3",
    needs: { head: 3, bottom: 2 },
    pairs: [[0, 1], [2, 3], [5, 6]],
    slots: [
      { kind: "head", left: 1, top: 4, width: 30, height: 32, z: 4, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 2, top: 35, width: 30, height: 49, z: 2, rotate: 0, align: "top" },
      { kind: "head", left: 33, top: 3, width: 30, height: 30, z: 4, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 34, top: 32, width: 30, height: 52, z: 2, rotate: 0, align: "top" },
      { kind: "dress", left: 66, top: 2, width: 30, height: 42, z: 3, rotate: 0 },
      { kind: "head", left: 67, top: 45, width: 28, height: 22, z: 4, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 68, top: 66, width: 28, height: 24, z: 2, rotate: 0, align: "top" },
      { kind: "sunglasses", left: 33, top: 0, width: 14, height: 7, z: 6, rotate: -5 },
      { kind: "jewelry", left: 49, top: 0, width: 9, height: 8, z: 6, rotate: 0 },
      { kind: "jewelry", left: 58, top: 0, width: 9, height: 8, z: 6, rotate: 3 },
      { kind: "jewelry", left: 91, top: 26, width: 8, height: 9, z: 6, rotate: 0, alignX: "right" },
      { kind: "bag", left: 19, top: 42, width: 17, height: 16, z: 5, rotate: 0 },
      { kind: "bag", left: 51, top: 60, width: 16, height: 15, z: 6, rotate: 0 },
      { kind: "belt", left: 64, top: 60, width: 12, height: 8, z: 7, rotate: -10 },
      { kind: "shoes", left: 7, top: 84, width: 24, height: 13, z: 6, rotate: 0, align: "bottom" },
      { kind: "shoes", left: 38, top: 86, width: 22, height: 11, z: 7, rotate: 0, align: "bottom" },
      { kind: "other", left: 84, top: 68, width: 13, height: 11, z: 5, rotate: 3, alignX: "right" },
    ],
  },
  {
    // Women's double-dress board (traced from Stefana black/cream board)
    id: "duo-dress",
    needs: { dress: 2, head: 2, bottom: 1 },
    pairs: [[0, 1], [3, 4]],
    slots: [
      { kind: "head", left: 2, top: 2, width: 26, height: 30, z: 4, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 3, top: 30, width: 28, height: 56, z: 2, rotate: 0, align: "top" },
      { kind: "dress", left: 32, top: 4, width: 30, height: 74, z: 3, rotate: 0 },
      { kind: "head", left: 64, top: 2, width: 26, height: 30, z: 4, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 65, top: 31, width: 26, height: 26, z: 2, rotate: 0, align: "top" },
      { kind: "dress", left: 62, top: 44, width: 30, height: 42, z: 5, rotate: 0 },
      { kind: "bag", left: 12, top: 26, width: 15, height: 14, z: 5, rotate: 0 },
      { kind: "bag", left: 58, top: 60, width: 14, height: 13, z: 7, rotate: 0 },
      { kind: "shoes", left: 8, top: 86, width: 20, height: 11, z: 6, rotate: 0, align: "bottom" },
      { kind: "shoes", left: 34, top: 86, width: 20, height: 11, z: 7, rotate: 0, align: "bottom" },
      { kind: "sunglasses", left: 40, top: 0, width: 14, height: 7, z: 6, rotate: -5 },
      { kind: "jewelry", left: 28, top: 0, width: 9, height: 8, z: 6, rotate: 0 },
      { kind: "jewelry", left: 51, top: 2, width: 9, height: 8, z: 6, rotate: 0 },
      { kind: "jewelry", left: 90, top: 30, width: 8, height: 9, z: 6, rotate: 0, alignX: "right" },
      { kind: "belt", left: 41, top: 60, width: 13, height: 9, z: 6, rotate: -8 },
    ],
  },
  {
    // Men's 2x3 grid (traced from Hue & Stripe denim boards)
    id: "grid2",
    needs: { head: 2, bottom: 1, shoes: 1 },
    pairs: [[1, 2]],
    slots: [
      { kind: "head", left: 6, top: 2, width: 38, height: 33, z: 3, rotate: 0, align: "bottom" },
      { kind: "head", left: 56, top: 2, width: 38, height: 33, z: 3, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 58, top: 37, width: 36, height: 54, z: 2, rotate: 0, align: "top" },
      { kind: "bottom", left: 5, top: 56, width: 30, height: 37, z: 2, rotate: 0, align: "top" },
      { kind: "jewelry", left: 45, top: 7, width: 10, height: 13, z: 6, rotate: 0 },
      { kind: "shoes", left: 8, top: 38, width: 27, height: 15, z: 5, rotate: 0, align: "bottom" },
      { kind: "belt", left: 39, top: 43, width: 17, height: 11, z: 6, rotate: -6 },
      { kind: "shoes", left: 37, top: 60, width: 26, height: 15, z: 5, rotate: 0, align: "bottom" },
      { kind: "sunglasses", left: 38, top: 26, width: 13, height: 7, z: 6, rotate: -4 },
      { kind: "jewelry", left: 41, top: 78, width: 10, height: 11, z: 6, rotate: 0 },
      { kind: "bag", left: 76, top: 74, width: 18, height: 15, z: 6, rotate: 0, alignX: "right" },
      { kind: "other", left: 6, top: 42, width: 14, height: 12, z: 5, rotate: 0 },
    ],
  },
  {
    // Men's cascading shirt stack (traced from the tan linen board)
    id: "stack3",
    needs: { head: 3, bottom: 1 },
    slots: [
      { kind: "head", left: 4, top: 2, width: 36, height: 26, z: 3, rotate: 0, align: "bottom" },
      { kind: "head", left: 3, top: 25, width: 38, height: 28, z: 4, rotate: 0, align: "bottom" },
      { kind: "head", left: 2, top: 50, width: 38, height: 28, z: 5, rotate: 0, align: "bottom" },
      { kind: "head", left: 44, top: 4, width: 22, height: 30, z: 2, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 64, top: 5, width: 32, height: 62, z: 2, rotate: 0, align: "top" },
      { kind: "belt", left: 42, top: 36, width: 18, height: 9, z: 6, rotate: 0 },
      { kind: "shoes", left: 38, top: 46, width: 26, height: 12, z: 6, rotate: 0, align: "bottom" },
      { kind: "shoes", left: 40, top: 61, width: 26, height: 15, z: 7, rotate: 0, align: "bottom" },
      { kind: "shoes", left: 5, top: 80, width: 26, height: 14, z: 6, rotate: 0, align: "bottom" },
      { kind: "sunglasses", left: 40, top: 1, width: 15, height: 8, z: 6, rotate: -4 },
      { kind: "jewelry", left: 46, top: 80, width: 10, height: 10, z: 6, rotate: 0 },
      { kind: "bag", left: 72, top: 72, width: 20, height: 16, z: 5, rotate: 0, alignX: "right" },
      { kind: "other", left: 84, top: 40, width: 12, height: 11, z: 5, rotate: 0, alignX: "right" },
    ],
  },
];

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
  const shoes = withImage.filter((i) => i.category === "shoes").slice(0, 3);
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

  // ---- Template selection: pick the art-directed grid that places the
  // most of what this look actually contains -----------------------------
  const byKind: Record<SlotKind, LookItem[]> = {
    head: heads, bottom: bottoms, dress: dresses, shoes, bag: bags,
    belt: belts, sunglasses: sunnies, jewelry, other: others,
  };
  let template: Template | null = null;
  let bestScore = -1;
  for (const t of TEMPLATES) {
    const fits = Object.entries(t.needs).every(
      ([k, min]) => byKind[k as SlotKind].length >= (min ?? 0)
    );
    if (!fits) continue;
    const cap: Partial<Record<SlotKind, number>> = {};
    let score = 0;
    for (const s of t.slots) {
      cap[s.kind] = (cap[s.kind] ?? 0) + 1;
      if (cap[s.kind]! <= byKind[s.kind].length) score++;
    }
    if (score > bestScore) {
      template = t;
      bestScore = score;
    }
  }

  if (template) {
    const counters: Partial<Record<SlotKind, number>> = {};
    const assigned = template.slots.map((s) => {
      const i = counters[s.kind] ?? 0;
      counters[s.kind] = i + 1;
      return byKind[s.kind][i];
    });
    // Copy slots before mutating — templates are shared module constants
    const slots: Slot[] = template.slots.map((s) => {
      const { kind, ...rest } = s;
      void kind;
      return { ...rest };
    });
    for (const [hi, bi] of template.pairs ?? []) {
      const h = assigned[hi];
      const b = assigned[bi];
      if (h && b && (isModelCrop(h.image_url) || isModelCrop(b.image_url))) {
        // Model-crops don't overlap: give the pair air instead
        slots[bi].top += 4;
        slots[bi].height = Math.max(10, slots[bi].height - 4);
        slots[hi].align = undefined;
        slots[bi].align = undefined;
      }
    }
    assigned.forEach((item, i) => put(item, slots[i]));
    return autoscale(placed);
  }

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

  return autoscale(placed);
}

// References are dense edge-to-edge: a sparse board scales its whole
// cluster up around the canvas center instead of floating tiny pieces.
function autoscale(
  placed: Array<{ item: LookItem; slot: Slot }>
): Array<{ item: LookItem; slot: Slot }> {
  if (placed.length === 0) return placed;
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
  return placed;
}
