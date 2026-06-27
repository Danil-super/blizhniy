create table if not exists public.ad_marquee_placements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 10 and 140),
  href text,
  status text not null default 'pending_review' check (status in ('pending_review', 'pending_payment', 'paid', 'active', 'rejected', 'expired', 'archived')),
  payment_status payment_status not null default 'created',
  payment_id uuid references public.payments(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  admin_comment text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_marquee_placements_user_id_idx on public.ad_marquee_placements (user_id);
create index if not exists ad_marquee_placements_status_queue_idx on public.ad_marquee_placements (status, sort_order, paid_at, created_at);
create index if not exists ad_marquee_placements_active_idx on public.ad_marquee_placements (status, ends_at, sort_order, starts_at);

alter table public.ad_marquee_placements enable row level security;

drop policy if exists "Public can read active ad marquee placements" on public.ad_marquee_placements;
create policy "Public can read active ad marquee placements"
on public.ad_marquee_placements
for select
to anon, authenticated
using (status = 'active' and (ends_at is null or ends_at > now()));

drop policy if exists "Users can read own ad marquee placements" on public.ad_marquee_placements;
create policy "Users can read own ad marquee placements"
on public.ad_marquee_placements
for select
to authenticated
using ((select auth.uid()) = user_id or private.is_admin());

drop policy if exists "Users can create own ad marquee placements" on public.ad_marquee_placements;
create policy "Users can create own ad marquee placements"
on public.ad_marquee_placements
for insert
to authenticated
with check ((select auth.uid()) = user_id and status = 'pending_review');

drop policy if exists "Users can edit own draft ad marquee placements" on public.ad_marquee_placements;
create policy "Users can edit own draft ad marquee placements"
on public.ad_marquee_placements
for update
to authenticated
using ((select auth.uid()) = user_id and status = 'pending_review')
with check ((select auth.uid()) = user_id and status = 'pending_review');

drop policy if exists "Admins can manage ad marquee placements" on public.ad_marquee_placements;
create policy "Admins can manage ad marquee placements"
on public.ad_marquee_placements
for all
to authenticated
using (private.is_admin())
with check (private.is_admin());

grant select on public.ad_marquee_placements to anon, authenticated;
grant insert, update, delete on public.ad_marquee_placements to authenticated;
