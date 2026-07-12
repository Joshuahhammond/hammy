import Link from "next/link";
import { signIn } from "../actions";

type Props = {
  searchParams: Promise<{ error?: string; message?: string }>;
};

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: Props) {
  const { error, message } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-2xl font-bold tracking-tight text-ink">
          hammy
        </Link>
        <div className="rounded-xl border border-bone bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-lg font-semibold text-ink">Sign in</h1>
          {message && (
            <p className="mb-4 rounded-md bg-bone/50 px-3 py-2 text-sm text-ink/80">{message}</p>
          )}
          {error && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <form action={signIn} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-ink/80">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1 block text-sm font-medium text-ink/80">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-ink px-3 py-2 text-sm font-medium text-cream hover:bg-taupe-dark"
            >
              Sign in
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-ink/70">
          New here?{" "}
          <Link href="/signup" className="font-medium text-taupe-dark hover:underline">
            Create a stylist account
          </Link>
        </p>
      </div>
    </main>
  );
}
