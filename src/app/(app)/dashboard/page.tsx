import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Lookbook } from "@/lib/types";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();

  const [clients, items, lookbooks, recent] = await Promise.all([
    supabase.from("clients").select("id", { count: "exact", head: true }),
    supabase.from("items").select("id", { count: "exact", head: true }),
    supabase.from("lookbooks").select("id", { count: "exact", head: true }),
    supabase
      .from("lookbooks")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const stats = [
    { label: "Clients", count: clients.count ?? 0, href: "/clients" },
    { label: "Items in library", count: items.count ?? 0, href: "/items" },
    { label: "Lookbooks", count: lookbooks.count ?? 0, href: "/lookbooks" },
  ];

  const recentLookbooks = (recent.data ?? []) as Lookbook[];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Dashboard</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="rounded-xl border border-bone bg-white p-5 hover:border-taupe"
          >
            <p className="text-3xl font-semibold text-ink">{s.count}</p>
            <p className="mt-1 text-sm text-ink/70">{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="mt-10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Recent lookbooks</h2>
          <Link href="/lookbooks" className="text-sm font-medium text-taupe-dark hover:underline">
            View all
          </Link>
        </div>
        {recentLookbooks.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-bone bg-white p-8 text-center text-sm text-ink/60">
            No lookbooks yet. Add some items to your library, then create your
            first lookbook.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-bone rounded-xl border border-bone bg-white">
            {recentLookbooks.map((lb) => (
              <li key={lb.id}>
                <Link
                  href={`/lookbooks/${lb.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-cream"
                >
                  <span className="text-sm font-medium text-ink">{lb.title}</span>
                  <span className="text-xs text-ink/60">
                    {new Date(lb.created_at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
