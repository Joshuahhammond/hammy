import Link from "next/link";

const PALETTE = ["#dad6c9", "#9b8570", "#1b1715"];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-cream">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <span className="text-2xl font-bold lowercase tracking-tight text-ink">hammy</span>
        <nav className="flex items-center gap-5">
          <Link href="/login" className="text-sm font-medium text-ink/70 hover:text-ink">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-cream hover:bg-taupe-dark"
          >
            Get started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-16 pt-24 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-taupe-dark">
          The stylist&apos;s toolbox
        </p>
        <h1 className="mt-6 text-7xl font-bold lowercase tracking-tight text-ink sm:text-8xl">
          hammy
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink/70">
          Branded lookbooks, client wardrobes, and color-exact search — the
          quiet, considered home for your styling business.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/signup"
            className="rounded-full bg-ink px-7 py-3 text-sm font-medium text-cream hover:bg-taupe-dark"
          >
            Create your account
          </Link>
          <Link
            href="/login"
            className="rounded-full border border-ink/20 px-7 py-3 text-sm font-medium text-ink hover:border-ink"
          >
            Sign in
          </Link>
        </div>
        <div className="mt-16 flex justify-center gap-3">
          {PALETTE.map((c) => (
            <span
              key={c}
              className="h-10 w-10 rounded-full border border-ink/10"
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-3">
        <div className="rounded-2xl bg-bone p-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-taupe-dark">01</p>
          <h2 className="mt-3 font-semibold text-ink">Lookbooks</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/70">
            Curate collections with styling notes and share them through a
            private link — no client login required.
          </p>
        </div>
        <div className="rounded-2xl bg-taupe p-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-cream/80">02</p>
          <h2 className="mt-3 font-semibold text-cream">Color search</h2>
          <p className="mt-2 text-sm leading-relaxed text-cream/90">
            Every piece is indexed by hue. Filter your library by color family
            to match a client&apos;s palette instantly.
          </p>
        </div>
        <div className="rounded-2xl bg-ink p-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-bone/70">03</p>
          <h2 className="mt-3 font-semibold text-cream">Client wardrobes</h2>
          <p className="mt-2 text-sm leading-relaxed text-cream/80">
            Track what each client already owns so new recommendations always
            work with their existing pieces.
          </p>
        </div>
      </section>

      <footer className="border-t border-bone py-8 text-center text-xs lowercase tracking-widest text-ink/50">
        hammy
      </footer>
    </main>
  );
}
