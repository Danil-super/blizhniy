alter type public.listing_type add value if not exists 'rent';

alter table public.listings
  add column if not exists booking jsonb;

update public.categories as child
set active = false
where slug = 'arenda'
  and exists (
    select 1
    from public.categories parent
    where parent.id = child.parent_id
      and parent.slug = 'nedvizhimost'
  );
