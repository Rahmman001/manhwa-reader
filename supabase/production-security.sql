-- Run this after creating your first account in Supabase Auth.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

drop policy if exists "public can read admin users" on public.admin_users;
create policy "users can read their own admin row" on public.admin_users
  for select using (auth.uid() = user_id);

drop policy if exists "public can create series" on public.series;
drop policy if exists "public can update series" on public.series;
drop policy if exists "public can delete series" on public.series;
drop policy if exists "public can create chapters" on public.chapters;
drop policy if exists "public can update chapters" on public.chapters;
drop policy if exists "public can delete chapters" on public.chapters;

create policy "admins can create series" on public.series
  for insert with check (exists (select 1 from public.admin_users where user_id = auth.uid()));
create policy "admins can update series" on public.series
  for update using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));
create policy "admins can delete series" on public.series
  for delete using (exists (select 1 from public.admin_users where user_id = auth.uid()));

create policy "admins can create chapters" on public.chapters
  for insert with check (exists (select 1 from public.admin_users where user_id = auth.uid()));
create policy "admins can update chapters" on public.chapters
  for update using (exists (select 1 from public.admin_users where user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users where user_id = auth.uid()));
create policy "admins can delete chapters" on public.chapters
  for delete using (exists (select 1 from public.admin_users where user_id = auth.uid()));

drop policy if exists "public can upload manhwa files" on storage.objects;
drop policy if exists "public can update manhwa files" on storage.objects;
drop policy if exists "public can delete manhwa files" on storage.objects;

create policy "admins can upload manhwa files" on storage.objects
  for insert with check (
    bucket_id = 'manhwa' and
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );
create policy "admins can update manhwa files" on storage.objects
  for update using (
    bucket_id = 'manhwa' and
    exists (select 1 from public.admin_users where user_id = auth.uid())
  ) with check (
    bucket_id = 'manhwa' and
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );
create policy "admins can delete manhwa files" on storage.objects
  for delete using (
    bucket_id = 'manhwa' and
    exists (select 1 from public.admin_users where user_id = auth.uid())
  );
