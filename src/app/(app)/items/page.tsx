import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { addItem, deleteItem } from "./actions";
import { COLOR_FAMILIES, inColorFamily, formatPrice } from "@/lib/color";
import { CATEGORIES, type Item } from "@/lib/types";

export const metadata = { title: "Item library" };

type Props = { searchParams: Promise<{ color?: string }> };

export default async function ItemsPage({ searchParams }: Props) {
  const { color } = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase
    .from("items")
    .select("*")
    .order("created_at", { ascending: false });

  const allItems = (data ?? []) as Item[];
  const items = color
    ? allItems.filter((i) => inColorFamily(color, i.hue, i.saturation, i.lightness))
    : allItems;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-ink">Item library</h1>
      <p className="mt-1 text-sm text-ink/60">
        Pieces you recommend to clients, indexed by color.
      </p>

      <details className="mt-6 rounded-xl border border-bone bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-taupe-dark">
          + Add an item
        </summary>
        <form action={addItem} className="flex flex-wrap items-end gap-3 border-t border-bone/60 p-4">
          <div className="min-w-40 flex-1">
            <label htmlFor="i-name" className="mb-1 block text-xs font-medium text-ink/70">
              Name
            </label>
            <input
              id="i-name"
              name="name"
              required
              placeholder="Silk midi skirt"
              className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
            />
          </div>
          <div className="w-32">
            <label htmlFor="i-brand" className="mb-1 block text-xs font-medium text-ink/70">
              Brand
            </label>
            <input
              id="i-brand"
              name="brand"
              className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="i-category" className="mb-1 block text-xs font-medium text-ink/70">
              Category
            </label>
            <select
              id="i-category"
              name="category"
              className="rounded-md border border-bone px-2 py-2 text-sm focus:border-taupe focus:outline-none"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="w-24">
            <label htmlFor="i-price" className="mb-1 block text-xs font-medium text-ink/70">
              Price ($)
            </label>
            <input
              id="i-price"
              name="price"
              type="number"
              step="0.01"
              min="0"
              className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="i-color" className="mb-1 block text-xs font-medium text-ink/70">
              Color
            </label>
            <input
              id="i-color"
              name="color_hex"
              type="color"
              defaultValue="#9b8570"
              className="h-9 w-12 cursor-pointer rounded-md border border-bone"
            />
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor="i-url" className="mb-1 block text-xs font-medium text-ink/70">
              Product URL
            </label>
            <input
              id="i-url"
              name="product_url"
              type="url"
              placeholder="https://..."
              className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
            />
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor="i-image" className="mb-1 block text-xs font-medium text-ink/70">
              Image URL
            </label>
            <input
              id="i-image"
              name="image_url"
              type="url"
              placeholder="https://..."
              className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-cream hover:bg-taupe-dark"
          >
            Add item
          </button>
        </form>
      </details>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Link
          href="/items"
          className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
            !color
              ? "border-ink bg-ink text-cream"
              : "border-bone bg-white text-ink/80 hover:border-taupe"
          }`}
        >
          All colors
        </Link>
        {COLOR_FAMILIES.map((f) => (
          <Link
            key={f.key}
            href={`/items?color=${f.key}`}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
              color === f.key
                ? "border-ink bg-ink text-cream"
                : "border-bone bg-white text-ink/80 hover:border-taupe"
            }`}
          >
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: f.swatch }} />
            {f.label}
          </Link>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-bone bg-white p-8 text-center text-sm text-ink/60">
          {color
            ? "No items in this color family yet."
            : "Your library is empty — add your first item above."}
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <li key={item.id} className="overflow-hidden rounded-xl border border-bone bg-white">
              {item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary retailer hosts; next/image needs per-domain config
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="h-44 w-full object-cover"
                />
              ) : (
                <div
                  className="h-44 w-full"
                  style={{ backgroundColor: item.color_hex }}
                />
              )}
              <div className="flex items-start gap-3 p-4">
                <span
                  className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-bone"
                  style={{ backgroundColor: item.color_hex }}
                  title={item.color_hex}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                  <p className="truncate text-xs text-ink/60">
                    {[item.brand, item.category, formatPrice(item.price_cents)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {item.product_url && (
                    <a
                      href={item.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-taupe-dark hover:underline"
                    >
                      View product ↗
                    </a>
                  )}
                </div>
                <form action={deleteItem}>
                  <input type="hidden" name="id" value={item.id} />
                  <button
                    type="submit"
                    aria-label={`Delete ${item.name}`}
                    className="text-xs text-ink/50 hover:text-red-600"
                  >
                    ✕
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
