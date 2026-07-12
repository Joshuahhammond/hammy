# hammy

Warm-minimal toolbox for personal stylists and image consultants — a Hue & Stripe
competitor. Stylists build branded lookbooks, track client wardrobes, and
search their item library by exact color. Clients view shared lookbooks
through a private link with no login.

## Stack

- **Next.js 16** (App Router, Server Components + Server Actions, `src/proxy.ts` for session refresh)
- **Supabase** — Postgres + Auth + RLS (`@supabase/ssr`)
- **Tailwind CSS v4**

## Features (MVP thin slices)

| Slice | Where |
|---|---|
| Stylist auth (email/password) | `/signup`, `/login` |
| Client roster + per-client wardrobe tracking | `/clients`, `/clients/[id]` |
| Item library with color-family search (hue indexed from hex at write time) | `/items?color=blue` |
| Lookbook builder with per-item styling notes | `/lookbooks/[id]` |
| Public tokenized share page, stylist-branded | `/share/[token]` |

## Setup

1. Create a Supabase project (or link an existing one):

   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push          # applies supabase/migrations/
   ```

2. Copy env and fill in from Supabase → Project Settings → API:

   ```bash
   cp .env.example .env.local
   ```

3. Run it:

   ```bash
   npm run dev
   ```

Note: if email confirmation is enabled in Supabase Auth (default), you must
confirm your email after signup before signing in. Disable it under
Auth → Providers → Email for local development.

## Architecture notes

- **RLS everywhere.** Every table is stylist-scoped (`stylist_id = auth.uid()`).
  The only public door is the `get_lookbook_by_token(text)` security-definer
  RPC used by the share page — tokens are 32-hex-char unguessable strings.
- **Color search** stores hue/saturation/lightness (derived from the hex
  swatch in the server action) on each item. Filtering happens in
  `src/lib/color.ts` (`inColorFamily`) with a neutrals bucket for
  low-saturation pieces; a `(stylist_id, hue)` index exists for pushing this
  into SQL when libraries grow.
- **New auth flows go through `src/proxy.ts`** (Next 16's middleware) — it
  refreshes the Supabase session cookie and gates `/dashboard`, `/clients`,
  `/items`, `/lookbooks`.

## Brand

Isola-inspired warm minimalism, lowercase wordmark. Tokens live in
`src/app/globals.css` (`@theme`): cream `#f4f2ec` (paper), bone `#dad6c9`
(panels/borders), taupe `#9b8570` (accent, default stylist brand color),
ink `#1b1715` (text, primary buttons).
