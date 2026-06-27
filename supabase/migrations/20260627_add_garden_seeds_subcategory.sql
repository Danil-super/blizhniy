-- Add the "Семена" child category to the garden catalog.

insert into public.categories (parent_id, slug, name, sort_order, active)
select parent.id, 'semena', 'Семена', 20, true
from public.categories parent
where parent.slug = 'sad-i-rasteniya'
on conflict (slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    active = true;
