-- StackNote optional cross-device sync (Supabase)
-- Run this in the Supabase SQL Editor, then paste the Project URL + anon key
-- into StackNote -> Settings -> Cloud sync.
--
-- NOTE: anon keys are public by design. The "workspace code" acts as a shared
-- secret for the row. Use a long random code and do not store sensitive data.
-- For a hardened setup, replace the policies below with Supabase Auth policies.

create table if not exists public.stacknote_workspaces (
  id          text primary key,
  data        jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.stacknote_workspaces enable row level security;

drop policy if exists "stacknote anon access" on public.stacknote_workspaces;
create policy "stacknote anon access"
  on public.stacknote_workspaces
  for all
  to anon
  using (true)
  with check (true);

-- Optional: keep the table out of the auto-generated API schema cache issues
grant usage on schema public to anon;
grant select, insert, update on public.stacknote_workspaces to anon;

notify pgrst, 'reload schema';
