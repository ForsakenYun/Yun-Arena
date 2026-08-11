# 选秀台 · Draft Stage

Tournament drafting website, built incrementally one feature at a time.
For project status, architecture, and product decisions, see
[`DEVLOG.md`](./DEVLOG.md) — this file only covers setup and running the
project.

## Requirements

- Node.js 18+
- npm
- A Supabase project (free tier is fine)

## Backend setup (one time)

1. Open your Supabase project's **SQL Editor**.
2. Paste in the entire contents of [`supabase/schema.sql`](./supabase/schema.sql) and run it.
   This creates every table, security policy, and database function the
   app needs, creates a public `avatars` Storage bucket, and seeds the
   real Developer account (`admin` / `111`).
3. Copy `.env.example` to `.env` and fill in your project's URL and anon
   key (Project Settings → API in the Supabase dashboard):

   ```bash
   cp .env.example .env
   ```

That's it — no other backend setup is required. See DEVLOG.md Section 15
for how the schema is put together.

## Install

```bash
npm install
```

## Run in development

```bash
npm run dev
```

Then open the printed local URL (usually http://localhost:5173).

## Build for production

```bash
npm run build
```

Output is written to `dist/`.

## Preview a production build locally

```bash
npm run preview
```

## Deployment

Not set up yet — no hosting or deployment pipeline has been chosen. This
section will be filled in once that's decided.
