-- Keep the production catalog aligned with the approved public taxonomy.
-- Historical categories are removed only after their listings are moved or when unused.

insert into public.categories (slug, name, sort_order, active)
values ('menyayu-ili-otdam-darom', 'Меняю или отдам даром', 60, true)
on conflict (slug) do update
set name = excluded.name,
    parent_id = null,
    sort_order = excluded.sort_order,
    active = true;

with parent_category as (
  select id
  from public.categories
  where slug = 'menyayu-ili-otdam-darom'
  limit 1
),
child_categories(slug, name, sort_order) as (
  values
    ('menyayu', 'Меняю', 10),
    ('otdam-darom', 'Отдам даром', 20)
)
insert into public.categories (parent_id, slug, name, sort_order, active)
select parent_category.id, child_categories.slug, child_categories.name, child_categories.sort_order, true
from child_categories
cross join parent_category
on conflict (slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    active = true;

with target_category as (
  select id
  from public.categories
  where slug = 'mebel-dlya-doma-i-dachi'
  limit 1
),
old_category as (
  select id
  from public.categories
  where slug = 'mebel'
  limit 1
)
update public.listings
set category_id = target_category.id
from target_category, old_category
where listings.category_id = old_category.id;

with target_category as (
  select id
  from public.categories
  where slug = 'raznoe'
    and parent_id is null
  limit 1
),
old_category as (
  select id
  from public.categories
  where slug = 'tovary-i-veshchi'
  limit 1
)
update public.listings
set category_id = target_category.id
from target_category, old_category
where listings.category_id = old_category.id;

update public.categories
set active = false
where slug in (
  'nedvizhimost-arenda',
  'organizatsiya-pohoron',
  'pamyatniki',
  'tovary-dlya-detey-sportivnye-igrushki',
  'tovary-dlya-zhivotnyh',
  'transport-zapchasti',
  'uhod-za-mestom',
  'zapchasti',
  'zhivotnye-pets'
);

delete from public.categories category
where category.active = false
  and not exists (
    select 1
    from public.listings listing
    where listing.category_id = category.id
  )
  and not exists (
    select 1
    from public.categories child
    where child.parent_id = category.id
  );

delete from public.categories category
where category.active = false
  and not exists (
    select 1
    from public.listings listing
    where listing.category_id = category.id
  )
  and not exists (
    select 1
    from public.categories child
    where child.parent_id = category.id
  );
