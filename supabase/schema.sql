create extension if not exists pgcrypto;

create table if not exists public.series (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  cover_image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  series_id uuid not null references public.series(id) on delete cascade,
  chapter_number numeric not null,
  page_count integer not null check (page_count > 0),
  created_at timestamptz not null default now(),
  unique(series_id, chapter_number)
);

alter table public.series enable row level security;
alter table public.chapters enable row level security;

create policy "public can read series" on public.series for select using (true);
create policy "public can create series" on public.series for insert with check (true);
create policy "public can update series" on public.series for update using (true) with check (true);
create policy "public can delete series" on public.series for delete using (true);
create policy "public can read chapters" on public.chapters for select using (true);
create policy "public can create chapters" on public.chapters for insert with check (true);
create policy "public can update chapters" on public.chapters for update using (true) with check (true);
create policy "public can delete chapters" on public.chapters for delete using (true);

insert into storage.buckets (id, name, public)
values ('manhwa', 'manhwa', true)
on conflict (id) do update set public = true;

create policy "public can read manhwa files" on storage.objects for select using (bucket_id = 'manhwa');
create policy "public can upload manhwa files" on storage.objects for insert with check (bucket_id = 'manhwa');
create policy "public can update manhwa files" on storage.objects for update using (bucket_id = 'manhwa') with check (bucket_id = 'manhwa');
create policy "public can delete manhwa files" on storage.objects for delete using (bucket_id = 'manhwa');
