alter table public.listings
  add column if not exists view_count integer not null default 0 check (view_count >= 0);

create table if not exists public.listing_views (
  listing_id uuid not null references public.listings(id) on delete cascade,
  viewer_key text not null,
  created_at timestamptz not null default now(),
  primary key (listing_id, viewer_key),
  check (viewer_key <> '')
);

create index if not exists listing_views_listing_id_idx on public.listing_views (listing_id);

alter table public.listing_views enable row level security;

create or replace function public.record_listing_view(p_listing_id uuid, p_viewer_key text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_rows integer;
  next_view_count integer;
  normalized_viewer_key text := left(btrim(p_viewer_key), 160);
begin
  if normalized_viewer_key is null or normalized_viewer_key = '' then
    raise exception 'viewer key is required';
  end if;

  insert into public.listing_views (listing_id, viewer_key)
  values (p_listing_id, normalized_viewer_key)
  on conflict do nothing;

  get diagnostics inserted_rows = row_count;

  if inserted_rows > 0 then
    update public.listings
       set view_count = view_count + 1
     where id = p_listing_id
       and status = 'published'
     returning view_count into next_view_count;

    if next_view_count is not null then
      return next_view_count;
    end if;

    delete from public.listing_views
     where listing_id = p_listing_id
       and viewer_key = normalized_viewer_key;
  end if;

  select view_count
    into next_view_count
    from public.listings
   where id = p_listing_id;

  return coalesce(next_view_count, 0);
end;
$$;

grant execute on function public.record_listing_view(uuid, text) to anon, authenticated, service_role;
