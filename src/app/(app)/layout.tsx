import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import type { Profile } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "Dashboard", short: "Home" },
  { href: "/clients", label: "Clients", short: "Clients" },
  { href: "/items", label: "Item library", short: "Library" },
  { href: "/discover", label: "Discover ✦", short: "Discover" },
  { href: "/lookbooks", label: "Lookbooks", short: "Looks" },
];

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  return (
    <div className="flex min-h-screen bg-cream">
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-bone bg-white md:flex">
        <Link href="/dashboard" className="px-5 py-5 text-lg font-bold tracking-tight text-ink">
          hammy
        </Link>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm font-medium text-ink/80 hover:bg-bone/60 hover:text-ink"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-bone px-5 py-4">
          <p className="truncate text-sm font-medium text-ink">
            {profile?.full_name || user.email}
          </p>
          {profile?.business_name && (
            <p className="truncate text-xs text-ink/60">{profile.business_name}</p>
          )}
          <form action={signOut} className="mt-2">
            <button type="submit" className="text-xs font-medium text-ink/60 hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header: brand row + always-visible nav strip */}
        <header className="sticky top-0 z-20 border-b border-bone bg-white md:hidden">
          <div className="flex items-center justify-between px-4 pb-1 pt-3">
            <Link href="/dashboard" className="text-lg font-bold tracking-tight text-ink">
              hammy
            </Link>
            <form action={signOut}>
              <button type="submit" className="text-xs font-medium text-ink/60">
                Sign out
              </button>
            </form>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-2 pb-2">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-ink/70 active:bg-cream"
              >
                {item.short}
              </Link>
            ))}
          </nav>
        </header>

        <main className="flex-1 overflow-x-hidden px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
