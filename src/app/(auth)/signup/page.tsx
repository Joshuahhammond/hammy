import Link from "next/link";
import { signUp } from "../actions";

type Props = {
  searchParams: Promise<{ error?: string }>;
};

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: Props) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-8 block text-center text-2xl font-bold tracking-tight text-ink">
          hammy
        </Link>
        <div className="rounded-xl border border-bone bg-white p-6 shadow-sm">
          <h1 className="mb-4 text-lg font-semibold text-ink">Create your stylist account</h1>
          {error && (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <form action={signUp} className="space-y-4">
            <div>
              <label htmlFor="full_name" className="mb-1 block text-sm font-medium text-ink/80">
                Your name
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                required
                className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="business_name" className="mb-1 block text-sm font-medium text-ink/80">
                Business name <span className="font-normal text-ink/50">(optional)</span>
              </label>
              <input
                id="business_name"
                name="business_name"
                type="text"
                className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
              />
            </div>
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
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-md border border-bone px-3 py-2 text-sm focus:border-taupe focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-ink px-3 py-2 text-sm font-medium text-cream hover:bg-taupe-dark"
            >
              Create account
            </button>
          </form>
        </div>
        <p className="mt-4 text-center text-sm text-ink/70">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-taupe-dark hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
