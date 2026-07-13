import { composeLook, type LookItem } from "@/lib/looks";
import { formatPrice } from "@/lib/color";

/**
 * One outfit rendered as a flat-lay collage: pieces absolutely positioned
 * and blended onto a single white canvas, Hue & Stripe style.
 */
export function LookBoard({ items, label }: { items: LookItem[]; label?: string }) {
  // AI-critiqued positions (persisted at generation) beat the live layout;
  // items the art director benched stay off the canvas entirely
  const placed = composeLook(items.filter((i) => !i.slot?.benched)).map((p) =>
    p.item.slot && !p.item.slot.benched ? { ...p, slot: p.item.slot } : p
  );

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-bone">
      {label && (
        <p className="px-6 pt-5 text-center text-[11px] font-medium uppercase tracking-[0.3em] text-ink/50">
          {label}
        </p>
      )}

      {placed.length > 0 && (
        <div
          className={`relative isolate mx-auto w-full max-w-xl bg-white ${
            placed.length <= 2 ? "aspect-[3/2]" : "aspect-[4/5]"
          }`}
        >
          {placed.map(({ item, slot }) => {
            const isCard = /\.card\.png($|[?#])/.test(item.image_url);
            return (
              // White canvas, H&S editorial: cutouts carry a whisper of
              // drop-shadow so pale garments separate from the canvas;
              // photo-cards render as framed cards — part of the collage
              // language, not something to hide.
              // eslint-disable-next-line @next/next/no-img-element -- retailer CDNs
              <img
                key={item.id}
                src={item.image_url}
                alt={item.name}
                className={`absolute object-contain ${
                  isCard ? "rounded-sm bg-white shadow-md ring-1 ring-ink/10" : ""
                }`}
                style={{
                  left: `${slot.left}%`,
                  top: `${slot.top}%`,
                  width: `${slot.width}%`,
                  height: `${slot.height}%`,
                  zIndex: slot.z,
                  transform: slot.rotate ? `rotate(${slot.rotate}deg)` : undefined,
                  objectPosition: `${slot.alignX ?? "center"} ${slot.align ?? "center"}`,
                  filter: isCard ? undefined : "drop-shadow(0 2px 4px rgba(27,23,21,0.10))",
                }}
                loading="lazy"
              />
            );
          })}
        </div>
      )}

      {/* The pieces in this look — thumbnail strip like the reference */}
      <div className="border-t border-bone">
        <ul className="grid grid-cols-3 divide-x divide-bone sm:grid-cols-6">
          {items.map((item) => {
            const tile = (
              <>
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- retailer CDNs
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="h-20 w-full object-contain p-1.5 mix-blend-multiply"
                    loading="lazy"
                  />
                ) : (
                  <div
                    className="m-2 h-16 rounded-md"
                    style={{ backgroundColor: item.color_hex }}
                  />
                )}
                <p className="truncate px-1.5 pb-1.5 text-center text-[10px] text-ink/60">
                  {item.price_cents !== null ? formatPrice(item.price_cents) : item.brand}
                </p>
              </>
            );
            return (
              <li key={item.id} title={`${item.brand} — ${item.name}`}>
                {item.product_url ? (
                  <a
                    href={item.product_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block hover:bg-cream"
                  >
                    {tile}
                  </a>
                ) : (
                  tile
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Styling notes for this look */}
      {items.some((i) => i.note) && (
        <div className="space-y-1.5 border-t border-bone px-6 py-4">
          {items
            .filter((i) => i.note)
            .map((i) => (
              <p key={i.id} className="font-serif text-sm italic leading-snug text-taupe-dark">
                &ldquo;{i.note}&rdquo;
                <span className="ml-2 font-sans text-[10px] not-italic uppercase tracking-[0.15em] text-ink/40">
                  {i.name}
                </span>
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
