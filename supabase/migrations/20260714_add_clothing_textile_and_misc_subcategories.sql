-- Add the approved clothing subcategories and remove historical duplicates.

with canonical_category as (
  select id
  from public.categories
  where slug = 'odezhda-obuv-aksessuary'
    and parent_id is null
  limit 1
),
child_categories(slug, name, sort_order) as (
  values
    ('tekstil', 'Текстиль', 40),
    ('odezhda-obuv-aksessuary-raznoe', 'Разное', 50)
)
insert into public.categories (parent_id, slug, name, sort_order, active)
select canonical_category.id, child_categories.slug, child_categories.name, child_categories.sort_order, true
from child_categories
cross join canonical_category
on conflict (slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    active = true;

with duplicate_map(old_slug, canonical_slug) as (
  values
    ('odezhda-obuv-aksessuary-odezhda', 'odezhda'),
    ('odezhda-obuv-aksessuary-obuv', 'obuv'),
    ('odezhda-obuv-aksessuary-aksessuary', 'aksessuary')
),
category_ids as (
  select duplicate.id as duplicate_id, canonical.id as canonical_id
  from duplicate_map
  join public.categories duplicate on duplicate.slug = duplicate_map.old_slug
  join public.categories canonical on canonical.slug = duplicate_map.canonical_slug
)
update public.listings listing
set category_id = category_ids.canonical_id
from category_ids
where listing.category_id = category_ids.duplicate_id;

delete from public.categories category
where category.slug in (
  'odezhda-obuv-aksessuary-odezhda',
  'odezhda-obuv-aksessuary-obuv',
  'odezhda-obuv-aksessuary-aksessuary'
)
  and not exists (
    select 1
    from public.listings listing
    where listing.category_id = category.id
  );
