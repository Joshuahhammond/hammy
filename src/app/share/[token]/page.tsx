import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { groupLookbookItems, type LookItem } from "@/lib/looks";
import { LookBoard } from "@/components/look-board";
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

  const stylistName =
    lookbook.stylist.business_name || lookbook.stylist.full_name || "Your stylist";

  const items: LookItem[] = lookbook.items.map((i) => ({
    id: i.id,
    name: i.name,
    brand: i.brand,
    category: i.category,
    price_cents: i.price_cents,
    product_url: i.product_url,
    image_url: i.image_url,
    color_hex: i.color_hex,
    note: i.note,
    look_no: i.look_no,
  }));
  const looks = groupLookbookItems(items);

  return (
    <main className="min-h-screen bg-cream">
      <header className="px-6 pb-12 pt-16 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.35em] text-taupe-dark">
          {stylistName}
        </p>
        <h1 className="mx-auto mt-5 max-w-3xl font-serif text-5xl font-medium italic tracking-tight text-ink sm:text-6xl">
          {lookbook.title}
        </h1>
        {lookbook.client_name && (
          <p className="mt-5 text-xs uppercase tracking-[0.3em] text-ink/50">
            Curated for {lookbook.client_name}
          </p>
        )}
        {lookbook.description && (
          <p className="mx-auto mt-6 max-w-xl font-serif text-lg italic leading-relaxed text-ink/70">
            {lookbook.description}
          </p>
        )}
        <div className="mx-auto mt-8 h-px w-16 bg-taupe" />
      </header>

      <section className="mx-auto max-w-2xl space-y-12 px-4 pb-20 sm:px-6">
        {looks.length === 0 ? (
          <p className="text-center text-sm text-ink/60">
            This lookbook doesn&apos;t have any pieces yet — check back soon.
          </p>
        ) : (
          looks.map((look, i) => (
            <LookBoard
              key={i}
              items={look}
              label={looks.length > 1 ? `Look ${String(i + 1).padStart(2, "0")}` : undefined}
            />
          ))
        )}
      </section>

      <footer className="border-t border-bone py-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-ink/40">
          Shared privately by {stylistName}
        </p>
        <p className="mt-2 text-xs lowercase tracking-widest text-ink/30">hammy</p>
      </footer>
    </main>
  );
}
