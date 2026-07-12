import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createLookbook } from "./actions";
import type { Client, Lookbook } from "@/lib/types";

export const metadata = { title: "Lookbooks" };

export default async function LookbooksPage() {
  const supabase = await createClient();

  const [lookbooksRes, clientsRes] = await Promise.all([
    supabase.from("lookbooks").select("*").order("created_at", { ascending: false }),
    supabase.from("clients").select("*").order("name"),
  ]);

  const lookbooks = (lookbooksRes.data ?? []) as Lookbook[];
  const clients = (clientsRes.data ?? []) as Client[];
  const clientName = (id: string | null) =>
    clients.find((c) => c.id === id)?.name ?? null;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Lookbooks</h1>

      <form
        action={createLookbook}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-bone bg-white p-4"
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="lb-title" className="mb-1 block text-xs font-medium text-ink/70">
            Title
          </label>
          <input
            id="lb-title"
            name="title"
            required
            placeholder="Spring capsule for Anna"
            className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
          />
        </div>
        <div>
          <label htmlFor="lb-client" className="mb-1 block text-xs font-medium text-ink/70">
            Client <span className="font-normal text-ink/50">(optional)</span>
          </label>
          <select
            id="lb-client"
            name="client_id"
            className="rounded-md border border-bone px-2 py-2 text-sm focus:border-taupe focus:outline-none"
          >
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-cream hover:bg-taupe-dark"
        >
          Create lookbook
        </button>
      </form>

      {lookbooks.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-bone bg-white p-8 text-center text-sm text-ink/60">
          No lookbooks yet — create one above, then add items from your library.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-bone rounded-xl border border-bone bg-white">
          {lookbooks.map((lb) => (
            <li key={lb.id}>
              <Link
                href={`/lookbooks/${lb.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-cream"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{lb.title}</p>
                  <p className="text-xs text-ink/60">
                    {clientName(lb.client_id) ?? "No client"} ·{" "}
                    {new Date(lb.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className="text-xs font-medium text-taupe-dark">Open →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
