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
  /** cutout image aspect ratio (w/h), probed at render time */
  aspect?: number | null;
  /** designed role from generation ("sunglasses", "belt"...) — beats title guessing */
  kind?: string;
  /** AI-critiqued board position override (persisted at generation time);
   *  benched:true means the art director removed it from the canvas */
  slot?: (Slot & { benched?: boolean }) | null;
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
// waist, sunglasses/jewelry sprinkled top-left). The designed role (kind)
// wins when present — product titles like "The Legend in Tokyo Tortoise"
// say nothing about being sunglasses.
export function accKind(
  i: Pick<LookItem, "name" | "kind"> & { note?: string }
): "bag" | "belt" | "sunglasses" | "jewelry" | "other" {
  const classify = (text: string) => {
    if (/bag|tote|clutch|crossbody|crescent|satchel|hobo/i.test(text)) return "bag" as const;
    if (/belt/i.test(text)) return "belt" as const;
    if (/sunglass|eyewear|frames|acetate/i.test(text)) return "sunglasses" as const;
    if (/earring|necklace|\brings?\b|bracelet|\bhoops?\b|pendant|choker|\bchains?\b|\bwatch(es)?\b|\bcuffs?\b(?!ed)|jewel/i.test(text)) return "jewelry" as const;
    return "other" as const;
  };
  // Three tiers: designed role (exact), then product title, then the
  // stylist note as a last resort — titles like "The Legend in Tokyo
  // Tortoise" say nothing, but the note calls it sunglasses
  const byKind = i.kind ? classify(i.kind) : "other";
  if (byKind !== "other") return byKind;
  const byName = classify(i.name);
  if (byName !== "other") return byName;
  return i.note ? classify(i.note) : "other";
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
    // Two dressed columns flanking a solo center top (traced from the
    // H&S olive/tan board): camp shirt TL over shorts, tank center,
    // second shirt TR over trousers. Accessories anchor anatomically.
    id: "trio",
    needs: { head: 3, bottom: 2 },
    pairs: [[0, 1], [2, 3]],
    slots: [
      { kind: "head", left: 2, top: 2, width: 30, height: 32, z: 4, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 3, top: 36, width: 29, height: 28, z: 2, rotate: 0, align: "top" },
      { kind: "head", left: 66, top: 2, width: 32, height: 34, z: 4, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 66, top: 38, width: 32, height: 54, z: 2, rotate: 0, align: "top" },
      { kind: "head", left: 37, top: 4, width: 24, height: 30, z: 3, rotate: 0, align: "bottom" },
      { kind: "shoes", left: 36, top: 50, width: 26, height: 22, z: 6, rotate: 0, align: "top" },
      { kind: "shoes", left: 5, top: 66, width: 28, height: 16, z: 5, rotate: 0, align: "top" },
    ],
  },
  {
    // Single-outfit two-column grid (traced from the H&S denim board):
    // hero top left, bottoms as the right column, shoes stacked left,
    // belt/jewelry on the center seam
    id: "solo",
    needs: { head: 1, bottom: 1, shoes: 1 },
    pairs: [],
    slots: [
      { kind: "head", left: 3, top: 2, width: 44, height: 38, z: 4, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 58, top: 34, width: 40, height: 60, z: 2, rotate: 0, align: "top" },
      { kind: "head", left: 56, top: 2, width: 40, height: 30, z: 3, rotate: 0, align: "bottom" },
      { kind: "shoes", left: 6, top: 46, width: 27, height: 16, z: 5, rotate: 0, align: "bottom" },
      { kind: "shoes", left: 8, top: 66, width: 26, height: 15, z: 5, rotate: 0, align: "top" },
      { kind: "belt", left: 42, top: 44, width: 17, height: 11, z: 6, rotate: -6 },
      { kind: "jewelry", left: 45, top: 6, width: 10, height: 12, z: 6, rotate: 0 },
      { kind: "sunglasses", left: 44, top: 24, width: 14, height: 8, z: 6, rotate: -4 },
      { kind: "bag", left: 74, top: 6, width: 20, height: 18, z: 5, rotate: 0 },
    ],
  },
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
      { kind: "head", left: 2, top: 2, width: 44, height: 36, z: 3, rotate: 0, align: "bottom" },
      { kind: "head", left: 54, top: 2, width: 44, height: 36, z: 3, rotate: 0, align: "bottom" },
      { kind: "bottom", left: 56, top: 40, width: 42, height: 53, z: 2, rotate: 0, align: "top" },
      { kind: "bottom", left: 2, top: 58, width: 34, height: 36, z: 2, rotate: 0, align: "top" },
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

  const GARMENT_CATS = ["outerwear", "dresses", "tops", "bottoms"];
  // Miscategorized trinkets must never claim a garment column — a
  // mislabeled "top" earring in a 40%-wide column reads absurd. NO note
  // tier here: a shirt whose styling note mentions "rolled cuffs" is
  // still a shirt.
  const isSmallAcc = (i: LookItem) =>
    ["jewelry", "sunglasses", "belt"].includes(accKind({ name: i.name, kind: i.kind }));
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
  // Note-tier classification only for non-garments: leftover garments in
  // rest must never become trinkets because their note mentions a belt
  const trinketable = (i: LookItem) => !GARMENT_CATS.includes(i.category);
  const bags = rest.filter((i) => trinketable(i) && accKind(i) === "bag").slice(0, 2);
  const belts = rest.filter((i) => trinketable(i) && accKind(i) === "belt").slice(0, 1);
  const sunnies = rest.filter((i) => trinketable(i) && accKind(i) === "sunglasses").slice(0, 1);
  const jewelry = rest.filter((i) => trinketable(i) && accKind(i) === "jewelry").slice(0, 3);
  // Overflow garments don't belong in the rotated corner trinket slots —
  // and neither do surplus trinkets (a second belt at a canvas edge reads
  // as a mistake; it lives in the thumbnail strip instead)
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
    // Never place the same item twice: template cells claim items first,
    // the anatomical pass only fills what no cell took
    if (item && !placed.some((p) => p.item === item)) placed.push({ item, slot });
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
    let garmentSlots = 0;
    let garmentFilled = 0;
    let headsFilled = 0;
    for (const s of t.slots) {
      cap[s.kind] = (cap[s.kind] ?? 0) + 1;
      const filled = cap[s.kind]! <= byKind[s.kind].length;
      if (filled) score++;
      if (["head", "bottom", "dress"].includes(s.kind)) {
        garmentSlots++;
        if (filled) garmentFilled++;
        if (filled && s.kind === "head") headsFilled++;
      }
    }
    void score;
    // A grid with empty garment zones reads as holes — the adaptive packer
    // composes missing-piece looks better than a gappy template
    if (garmentSlots > 0 && garmentFilled / garmentSlots < 0.7) continue;
    // Garments decide the grid (accessories anchor anatomically anyway);
    // ties go to fewest unfilled garment zones, then to more tops shown
    // (a 4-shirt look wants the cascade, not a 3-shirt grid)
    const gScore =
      garmentFilled + garmentFilled / Math.max(1, garmentSlots) + headsFilled * 0.01;
    if (gScore > bestScore) {
      template = t;
      bestScore = gScore;
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
    // Templates place EVERYTHING they have a designed cell for — the cells
    // were traced from reference boards precisely to fill gutters and
    // corners. The anatomical pass below only fills kinds without a cell.
    assigned.forEach((item, i) => put(item, slots[i]));
    return anchorAndScale();
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

  const COL_W = n <= 1 ? 46 : n === 2 ? 44 : n === 3 ? 30 : 23;
  const GAP = n <= 2 ? 4 : 3;
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

  return anchorAndScale();

  /**
   * Anatomical accessory pass: the board reads top-down like a dressed
   * figure — sunglasses above the collar, necklace ON the neckline, watch
   * and bracelets at the cuff, belt on the waistband junction, shoes under
   * the trouser hem, bag at the hip. Anchors are computed from the primary
   * column's TRUE rendered rectangles, so overlays land on pixels.
   */
  function anchorAndScale(): Array<{ item: LookItem; slot: Slot }> {
    truthBoxes(placed); // garment rects become anchor truth (idempotent)

    // Normalize garment visual weight: reference boards read as a grid of
    // same-scale products, but retailer photos fill their frames
    // differently, so slot math alone lets one tall cutout dominate.
    // Bands catch OUTLIERS only — ceilings sit at the templates' own slot
    // sizes (reference shirts run 33-44% wide), so normal garments pass
    // through untouched and nothing shrinks to "mini"
    const BANDS: Record<string, [number, number]> = {
      head: [22, 36], bottom: [36, 56], dress: [50, 76],
    };
    for (const p of placed) {
      const kind = heads.includes(p.item) ? "head"
        : bottoms.includes(p.item) ? "bottom"
        : dresses.includes(p.item) ? "dress" : null;
      if (!kind || !p.item.aspect) continue;
      let [lo, hi] = BANDS[kind];
      const MAX_W: Record<string, number> = { head: 44, bottom: 44, dress: 42 };
      let maxW = MAX_W[kind];
      // Short/wide bottoms (shorts, minis) are NOT trousers — banding them
      // to trouser heights inflates square shorts to full column width
      if (kind === "bottom" && (p.item.aspect ?? 0) >= 0.8) {
        lo = 18; hi = 34; maxW = 30;
      }
      let target = Math.min(hi, Math.max(lo, p.slot.height));
      const wouldW = p.slot.width * (target / p.slot.height);
      if (wouldW > maxW) {
        target = p.slot.height * (maxW / p.slot.width);
      }
      if (Math.abs(target - p.slot.height) < 0.5) continue;
      const f = target / p.slot.height;
      const cx = p.slot.left + p.slot.width / 2;
      p.slot.width *= f;
      p.slot.left = cx - p.slot.width / 2;
      p.slot.height = target; // top edge (collar / waistband) stays put
    }
    // Cascade: when several tops share a column (the reference "rack of
    // shirts" look), chain them by TRUE rects — each shirt overlaps the
    // top third of the one beneath, staggered slightly, painting downward.
    // Rack boards only: with 2+ bottoms the tops belong to separate
    // dressed columns and must never chain into each other.
    const cascadeOk = heads.length >= 3 && bottoms.length <= 1;
    const headPs = cascadeOk
      ? heads
          .map((h) => placed.find((p) => p.item === h))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
      : [];
    const chained = new Set<number>();
    for (let i = 0; i < headPs.length; i++) {
      if (chained.has(i)) continue;
      const stack = [headPs[i]];
      for (let j = i + 1; j < headPs.length; j++) {
        if (chained.has(j)) continue;
        const a = stack[stack.length - 1].slot;
        const b = headPs[j].slot;
        const overlap = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
        if (overlap > 0.4 * Math.min(a.width, b.width)) {
          stack.push(headPs[j]);
          chained.add(j);
        }
      }
      if (stack.length < 2) continue;
      stack.sort((a, b) => a.slot.top - b.slot.top);
      for (let k = 1; k < stack.length; k++) {
        const prev = stack[k - 1].slot;
        const cur = stack[k].slot;
        cur.top = prev.top + prev.height * 0.85; // ~15% occlusion, reference depth
        cur.left = prev.left + (k % 2 === 0 ? 2 : -2); // collar stagger
        cur.z = prev.z + 1; // lower shirt paints over the one above
      }
    }

    // Hero dominance: the lead top scales up toward reference hero size
    // (stack templates height-bind shirts on 4:5, collapsing the hierarchy)
    const heroP = placed.find((p) => p.item === heads[0]);
    if (heroP && heroP.item.aspect) {
      const s = heroP.slot;
      const f = Math.min(38 / s.width, 36 / s.height);
      if (f > 1.02) {
        const cx = s.left + s.width / 2;
        s.width *= f;
        s.height *= f;
        s.left = cx - s.width / 2;
      }
    }

    // Row lock: each bottom snaps its waistband to the hem of the top
    // sharing its column, closing vertical drift into an even gutter
    for (const b of bottoms) {
      const br = placed.find((p) => p.item === b)?.slot;
      if (!br) continue;
      const h = heads
        .map((hd) => placed.find((p) => p.item === hd)?.slot)
        .find((hr) => hr && hr.left < br.left + br.width && hr.left + hr.width > br.left);
      if (!h) continue;
      const want = h.top + h.height + 1.5;
      if (Math.abs(want - br.top) < 15) br.top = want;
    }

    const rectOf = (it?: LookItem) =>
      it ? placed.find((p) => p.item === it)?.slot : undefined;
    const dress0 = dresses[0];
    const topRect = rectOf(heads[0]) ?? rectOf(dress0);
    const botRect = rectOf(bottoms[0]) ?? rectOf(dress0);
    const axis = topRect
      ? topRect.left + topRect.width / 2
      : botRect
        ? botRect.left + botRect.width / 2
        : 50;
    // Waistband line: top of the trousers, or ~42% down a dress
    const junctionY =
      botRect && botRect !== topRect
        ? botRect.top + 2
        : topRect
          ? topRect.top + topRect.height * (botRect === topRect ? 0.42 : 1)
          : 55;
    // The primary column's true floor: bottom of the trousers, or of the
    // whole cascaded shirt stack when the column has no bottoms
    const primaryStackBottom = topRect
      ? Math.max(
          topRect.top + topRect.height,
          ...heads
            .map((h) => placed.find((p) => p.item === h)?.slot)
            .filter((r): r is Slot => Boolean(r))
            .filter(
              (r) =>
                r.left < topRect.left + topRect.width && r.left + r.width > topRect.left
            )
            .map((r) => r.top + r.height)
        )
      : 40;
    // Shoe floor: below EVERY garment on the board, not just the primary
    // bottoms — shoes must never paint over any garment body
    const allGarmentRects = [...heads, ...bottoms, ...dresses]
      .map((g) => placed.find((p) => p.item === g)?.slot)
      .filter((r): r is Slot => Boolean(r));
    const garmentFloor = allGarmentRects.length
      ? Math.max(...allGarmentRects.map((r) => r.top + r.height))
      : 78;
    const hemY = botRect
      ? Math.max(botRect.top + botRect.height, garmentFloor - 6)
      : Math.min(garmentFloor, 78);

    // The accessory SPINE: references run accessories down the widest
    // gutter between garment columns in dressing order — sunglasses,
    // jewelry, watch, belt, shoes. Column representatives: each head,
    // each dress, and any bottom without a head above it.
    const reps = [
      ...heads.map((h) => rectOf(h)),
      ...dresses.map((d) => rectOf(d)),
      ...bottoms.filter((_, i) => !heads[i]).map((b) => rectOf(b)),
    ]
      .filter((r): r is Slot => Boolean(r))
      .sort((a, b) => a.left + a.width / 2 - (b.left + b.width / 2));
    let spineX = topRect ? Math.min(96, topRect.left + topRect.width + 8) : 50;
    if (reps.length >= 2) {
      let bestGap = -Infinity;
      for (let i = 0; i < reps.length - 1; i++) {
        const gap = reps[i + 1].left - (reps[i].left + reps[i].width);
        if (gap > bestGap) {
          bestGap = gap;
          spineX = (reps[i].left + reps[i].width + reps[i + 1].left) / 2;
        }
      }
    }

    const jewelText = (j: LookItem) => `${j.kind ?? ""} ${j.name}`;
    // At waist/foot level the open lane is defined by the BOTTOMS, not the
    // tops — the belt and spine shoes must sit in that gap or they clip
    // trouser corners
    const botReps = bottoms
      .map((b) => rectOf(b))
      .filter((r): r is Slot => Boolean(r))
      .sort((a, b) => a.left + a.width / 2 - (b.left + b.width / 2));
    let spineLowX = spineX;
    if (botReps.length >= 2) {
      let bestGap = -Infinity;
      for (let i = 0; i < botReps.length - 1; i++) {
        const gap = botReps[i + 1].left - (botReps[i].left + botReps[i].width);
        if (gap > bestGap) {
          bestGap = gap;
          spineLowX = (botReps[i].left + botReps[i].width + botReps[i + 1].left) / 2;
        }
      }
    } else if (botReps.length === 1) {
      // Single bottom: the free lane is on its emptier side
      const r = botReps[0];
      spineLowX = r.left + r.width / 2 > 50 ? Math.max(10, r.left - 12) : Math.min(90, r.left + r.width + 12);
    }

    const necks = jewelry.filter((j) =>
      /necklace|pendant|choker|chain|lariat/i.test(jewelText(j))
    );
    const wrist = jewelry.filter(
      (j) => !necks.includes(j) && /watch|bracelet|bangle|cuff|\bring/i.test(jewelText(j))
    );
    const ears = jewelry.filter((j) => !necks.includes(j) && !wrist.includes(j));

    // Top of spine: sunglasses, then earrings beside them
    put(sunnies[0], { left: spineX - 7, top: 1, width: 14, height: 8, z: 8, rotate: -5 });
    put(ears[0], { left: spineX + 8, top: 2, width: 8, height: 8, z: 8, rotate: 3 });
    // Necklace sits ON the primary top's neckline; a second one holds the spine
    put(necks[0], topRect
      ? { left: axis - 6, top: topRect.top + 1, width: 12, height: 12, z: 8, rotate: 0, align: "top" }
      : { left: spineX - 6, top: 11, width: 12, height: 12, z: 8, rotate: 0 });
    put(necks[1], { left: spineX - 5, top: 12, width: 11, height: 11, z: 8, rotate: 0 });
    // Mid-spine: watch / bracelets at cuff height
    wrist.slice(0, 2).forEach((w, i) =>
      put(w, { left: spineX - 5, top: junctionY - 22 + i * 11, width: 9, height: 9, z: 8, rotate: 0 })
    );
    // Waist line: belt on the junction, in the bottoms' open lane
    put(belts[0], { left: spineLowX - 8, top: junctionY - 5, width: 16, height: 10, z: 8, rotate: -6 });
    // Belt clearance: never start above the hem of a garment it overlaps
    const beltP = placed.find((p) => p.item === belts[0]);
    if (beltP) {
      const s = beltP.slot;
      for (const r of allGarmentRects) {
        const xOver = Math.min(s.left + s.width, r.left + r.width) - Math.max(s.left, r.left);
        if (xOver > s.width * 0.3 && r.top < s.top && r.top + r.height > s.top) {
          s.top = r.top + r.height + 1;
        }
      }
    }
    // Bottom of spine + under the primary hem: shoes in dressing order.
    // A legless primary column (its trousers live under another top) gets
    // its shoes right under the shirt hem, reference-style, not sunk to
    // the canvas floor.
    const bottomUnderPrimary =
      !topRect ||
      bottoms.some((b) => {
        const r = rectOf(b);
        return r && r.left < topRect.left + topRect.width && r.left + r.width > topRect.left;
      });
    put(shoes[0], {
      left: axis - 13,
      top: bottomUnderPrimary ? hemY - 3 : primaryStackBottom + 3,
      width: 26, height: 15, z: 7, rotate: 0, align: "top",
    });
    put(shoes[1], { left: spineLowX - 12, top: Math.min(hemY + 1, 84), width: 24, height: 14, z: 7, rotate: 0, align: "top" });
    // Third pair joins the footwear cluster below the first, like the
    // reference's center-bottom shoe cell — never stranded in a corner
    put(shoes[2], {
      left: spineLowX - 12, top: Math.min(hemY + 12, 80),
      width: 26, height: 15, z: 7, rotate: 0, align: "top",
    });
    // Bag at hip height on whichever side of the bottoms has real room —
    // never inside a garment
    const anchorRect = botRect ?? topRect;
    const freeLeft = anchorRect ? anchorRect.left : 50;
    const freeRight = anchorRect ? 100 - (anchorRect.left + anchorRect.width) : 50;
    const bagOnLeft = freeLeft >= freeRight;
    put(bags[0], {
      left: bagOnLeft
        ? Math.max(2, (anchorRect?.left ?? 50) - 19)
        : Math.min(80, (anchorRect ? anchorRect.left + anchorRect.width : 62) + 1),
      top: junctionY + 4, width: 18, height: 18, z: 7, rotate: 0,
    });
    put(bags[1], {
      left: bagOnLeft ? 80 : 2,
      top: junctionY + 10, width: 16, height: 16, z: 7, rotate: 0,
      alignX: bagOnLeft ? "right" : "left",
    });
    put(others[0], { left: 82, top: 64, width: 14, height: 12, z: 6, rotate: 3, alignX: "right" });
    put(others[1], { left: 2, top: 64, width: 13, height: 11, z: 6, rotate: -4, alignX: "left" });

    // Invariant: never two belts or two sunglasses on one canvas — a
    // duplicate kind reads as a mistake; the extra lives in the strip
    const seenKind = new Set<string>();
    for (let i = placed.length - 1; i >= 0; i--) {
      const k = accKind(placed[i].item);
      if (k === "belt" || k === "sunglasses") {
        if (seenKind.has(k)) placed.splice(i, 1);
        else seenKind.add(k);
      }
    }

    // Orphan-accessory snap: an accessory floating well below its nearest
    // garment pulls up to a slight hem overlap (no more stranded cuffs)
    const garmentItems = new Set<LookItem>([...heads, ...bottoms, ...dresses]);
    for (const p of placed) {
      if (garmentItems.has(p.item)) continue;
      const s = p.slot;
      let nearestBottom = -Infinity;
      for (const r of allGarmentRects) {
        const xOver = Math.min(s.left + s.width, r.left + r.width) - Math.max(s.left, r.left);
        if (xOver > s.width * 0.4 && r.top + r.height <= s.top) {
          nearestBottom = Math.max(nearestBottom, r.top + r.height);
        }
      }
      if (nearestBottom > 0 && s.top - nearestBottom > 4) {
        s.top = nearestBottom - s.height * 0.15;
      }
    }

    return autoscale(placed);
  }
}

// Canvas is 4:5 — percent units are not square, so aspect math must
// convert through these factors
const CANVAS_W = 4;
const CANVAS_H = 5;

/**
 * Slot boxes lie: object-contain letterboxes any image whose aspect differs
 * from the box, so the visible item is smaller than its slot and boards
 * read scattered even when boxes touch. When the cutout's real aspect is
 * known, shrink each slot to the exact rendered rectangle (honoring the
 * slot's align anchors) so composition and autoscaling operate on truth.
 */
function truthBoxes(placed: Array<{ item: LookItem; slot: Slot }>): void {
  for (const p of placed) {
    const ar = p.item.aspect;
    if (!ar) continue;
    const s = p.slot;
    const bw = s.width * CANVAS_W; // box in shared units
    const bh = s.height * CANVAS_H;
    let w = bw;
    let h = bw / ar;
    if (h > bh) {
      h = bh;
      w = bh * ar;
    }
    const wPct = w / CANVAS_W;
    const hPct = h / CANVAS_H;
    s.left =
      s.alignX === "left" ? s.left
      : s.alignX === "right" ? s.left + s.width - wPct
      : s.left + (s.width - wPct) / 2;
    s.top =
      s.align === "top" ? s.top
      : s.align === "bottom" ? s.top + s.height - hPct
      : s.top + (s.height - hPct) / 2;
    s.width = wPct;
    s.height = hPct;
  }
}

// References are dense edge-to-edge: a sparse board scales its whole
// cluster up around the canvas center instead of floating tiny pieces.
// Exported so the AI critique loop can re-normalize after applying nudges.
export function autoscale(
  placed: Array<{ item: LookItem; slot: Slot }>
): Array<{ item: LookItem; slot: Slot }> {
  if (placed.length === 0) return placed;
  truthBoxes(placed);
  // Vertical compaction: close LARGE interior gaps (>6%) between an item
  // and whatever sits above it in the same column, leaving designed 2-4%
  // gutters and intentional overlaps untouched. Extent-bound scaling
  // alone can't fix a void in the middle of the board.
  const byTop = [...placed].sort((a, b) => a.slot.top - b.slot.top);
  for (const p of byTop) {
    const s = p.slot;
    let above = -Infinity;
    for (const q of byTop) {
      if (q === p) continue;
      const r = q.slot;
      const xOver = Math.min(s.left + s.width, r.left + r.width) - Math.max(s.left, r.left);
      if (xOver > 0.4 * Math.min(s.width, r.width) && r.top + r.height <= s.top) {
        above = Math.max(above, r.top + r.height);
      }
    }
    if (above > 0 && s.top - above > 6) s.top = above + 2;
  }
  const minL = Math.min(...placed.map(({ slot }) => slot.left));
  const maxR = Math.max(...placed.map(({ slot }) => slot.left + slot.width));
  const minT = Math.min(...placed.map(({ slot }) => slot.top));
  const maxB = Math.max(...placed.map(({ slot }) => slot.top + slot.height));
  const s = Math.min(1.35, 92 / Math.max(1, maxR - minL), 92 / Math.max(1, maxB - minT));
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
  // Margin frame: reference boards keep a clean empty border — nothing
  // ever touches or clips the canvas edge (symmetric 3% all around)
  for (const { slot } of placed) {
    slot.left = Math.min(97 - slot.width, Math.max(3, slot.left));
    slot.top = Math.min(97 - slot.height, Math.max(3, slot.top));
  }
  return placed;
}
