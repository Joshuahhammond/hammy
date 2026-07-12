import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/(auth)/actions";
import type { Profile } from "@/lib/types";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/clients", label: "Clients" },
  { href: "/items", label: "Item library" },
  { href: "/lookbooks", label: "Lookbooks" },
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
      <aside className="flex w-56 shrink-0 flex-col border-r border-bone bg-white">
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
      <main className="flex-1 overflow-x-hidden px-8 py-8">{children}</main>
    </div>
  );
}
