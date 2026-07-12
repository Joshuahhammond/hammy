import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { addClient } from "./actions";
import type { Client } from "@/lib/types";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("*")
    .order("created_at", { ascending: false });

  const clients = (data ?? []) as Client[];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-ink">Clients</h1>

      <form
        action={addClient}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-bone bg-white p-4"
      >
        <div className="min-w-40 flex-1">
          <label htmlFor="name" className="mb-1 block text-xs font-medium text-ink/70">
            Name
          </label>
          <input
            id="name"
            name="name"
            required
            className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
          />
        </div>
        <div className="min-w-40 flex-1">
          <label htmlFor="email" className="mb-1 block text-xs font-medium text-ink/70">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-cream hover:bg-taupe-dark"
        >
          Add client
        </button>
      </form>

      {clients.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-bone bg-white p-8 text-center text-sm text-ink/60">
          No clients yet — add your first client above.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-bone rounded-xl border border-bone bg-white">
          {clients.map((client) => (
            <li key={client.id}>
              <Link
                href={`/clients/${client.id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-cream"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{client.name}</p>
                  {client.email && <p className="text-xs text-ink/60">{client.email}</p>}
                </div>
                <span className="text-xs text-ink/50">
                  Added {new Date(client.created_at).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
