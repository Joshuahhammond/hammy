import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@/lib/color";
import type { SharedLookbook } from "@/lib/types";

type Props = { params: Promise<{ token: string }> };

async function getSharedLookbook(token: string): Promise<SharedLookbook | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_lookbook_by_token", {
    p_token: token,
  });
  return (data as SharedLookbook) ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const lookbook = await getSharedLookbook(token);
  return {
    title: lookbook ? lookbook.title : "Lookbook",
    robots: { index: false, follow: false },
  };
}

export default async function SharedLookbookPage({ params }: Props) {
  const { token } = await params;
  const lookbook = await getSharedLookbook(token);
  if (!lookbook) notFound();

  const brandColor = lookbook.stylist.brand_color || "#9b8570";
  const stylistName =
    lookbook.stylist.business_name || lookbook.stylist.full_name || "Your stylist";

  return (
    <main className="min-h-screen bg-cream">
      <header
        className="px-6 py-10 text-center text-cream"
        style={{ backgroundColor: brandColor }}
      >
        <p className="text-sm uppercase tracking-widest opacity-80">{stylistName}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{lookbook.title}</h1>
        {lookbook.client_name && (
          <p className="mt-2 text-sm opacity-90">Curated for {lookbook.client_name}</p>
        )}
        {lookbook.description && (
          <p className="mx-auto mt-3 max-w-xl text-sm opacity-90">{lookbook.description}</p>
        )}
      </header>

      <section className="mx-auto max-w-4xl px-6 py-10">
        {lookbook.items.length === 0 ? (
          <p className="text-center text-sm text-ink/60">
            This lookbook doesn&apos;t have any items yet — check back soon.
          </p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2">
            {lookbook.items.map((item) => (
              <li
                key={item.id}
                className="overflow-hidden rounded-2xl border border-bone bg-white shadow-sm"
              >
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary retailer hosts
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="h-64 w-full object-cover"
                  />
                ) : (
                  <div className="h-40 w-full" style={{ backgroundColor: item.color_hex }} />
                )}
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-ink">{item.name}</h2>
                      <p className="text-sm text-ink/60">
                        {[item.brand, item.category].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    {item.price_cents !== null && (
                      <span className="text-sm font-semibold text-ink">
                        {formatPrice(item.price_cents)}
                      </span>
                    )}
                  </div>
                  {item.note && (
                    <p className="mt-3 rounded-lg bg-cream px-3 py-2 text-sm italic text-ink/80">
                      &ldquo;{item.note}&rdquo;
                    </p>
                  )}
                  {item.product_url && (
                    <a
                      href={item.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-block rounded-md px-4 py-2 text-sm font-medium text-cream"
                      style={{ backgroundColor: brandColor }}
                    >
                      Shop this piece ↗
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="pb-10 text-center text-xs text-ink/50">
        Shared privately by {stylistName} · Powered by hammy
      </footer>
    </main>
  );
}
