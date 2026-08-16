# Manhwa Reader

Small personal manhwa reader built with Vite, React, Tailwind CSS, Supabase, and browser-side PDF.js.

## What it does

- Shows a Netflix-style dark library.
- Creates series and uploads PDF chapters from `/admin`.
- Converts PDF pages to WebP in the browser.
- Stores images at `series_[id]/chapter_[number]/[page].webp`.
- Reads chapters as a continuous vertical image strip.

## Project tree

```text
src/
  App.jsx          # Home, series, reader, and admin views
  supabase.js      # Supabase client and storage helpers
  pdfProcessor.js  # PDF.js -> canvas -> WebP -> Supabase upload
  index.css        # Tailwind import and small shared styles
  main.jsx         # React entry point
supabase/schema.sql
.env.example
```

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:5173`.

Fill `.env.local` with the URL and publishable key from your Supabase project:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Never put a Supabase service-role key in this frontend.

## Supabase setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor.
3. Paste and run `supabase/schema.sql`.
4. Add the two Vite environment variables.
5. Restart `npm run dev`.

The SQL intentionally allows public read/write because this is a personal MVP. It is not suitable for a public multi-user site. Before sharing the app publicly, replace these policies with authenticated admin-only writes.

## Enable authentication and admin-only uploads

1. Run `supabase/production-security.sql` in the Supabase SQL Editor.
2. Open the app, choose **Sign in**, and create your account.
3. Confirm your email if Supabase requires confirmation.
4. In the Supabase SQL Editor, add your account as the only admin. Replace the email below:

```sql
insert into public.admin_users (user_id)
select id from auth.users where email = 'your-email@example.com'
on conflict (user_id) do nothing;
```

5. Sign out and sign in again. The Admin page will now be available to your account.

The app keeps public reading enabled, but only accounts listed in `admin_users` can create, update, or delete series, chapters, and storage files. Do not add anyone else to this table.

When editing a series description, add genres as hashtags, for example `#Action #Fantasy #Adventure`. They appear as small rounded tags below the description.

Each series page remembers the last opened chapter and shows a **Continue reading** button for that series. Reading progress is stored locally in the browser.

## Bulk upload chapters

Open **Admin** and choose **PDF files** to select one or more PDFs, or choose **folder** to select a complete folder. Name files with their chapter number, for example:

```text
The Horizon/
  Chapter 1.pdf
  Chapter 2.pdf
  Chapter 3.pdf
```

The app sorts the files numerically, converts them, uploads them one at a time, and saves the chapter records. If an upload stops, retrying skips page images that were already uploaded and keeps failed chapters selected for another attempt.

## Commands

```bash
npm run dev
npm run lint
npm run build
npm run preview
```

## Deploy

Push the project to GitHub, import it into Vercel or Netlify, set the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` environment variables, and deploy as a Vite project.

Free-tier limits and billing requirements can change, so verify the current provider terms before relying on a permanent zero-cost deployment. Upload only content you own or are legally allowed to store.
