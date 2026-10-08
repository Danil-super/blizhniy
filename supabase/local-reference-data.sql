-- The only seed payload is a whitelist of reference exports from src/lib/data.ts.
-- All input travels as a quoted psql variable; never SQL-interpolate names.
create temporary table local_reference as
select convert_from(decode(:'local_reference','base64'),'UTF8')::jsonb as data;

insert into public.regions(slug,name)
select data->'region'->>'slug', data->'region'->>'name' from local_reference
on conflict(slug) do update set name=excluded.name;

insert into public.cities(region_id,slug,name)
select region.id,city->>'slug',city->>'name'
from local_reference,jsonb_array_elements(data->'cities') city
join public.regions region on region.slug=city->>'regionSlug'
on conflict(slug) do update set region_id=excluded.region_id,name=excluded.name;

insert into public.categories(slug,name,sort_order)
select category->>'slug',category->>'name',ordinality::integer*10
from local_reference,jsonb_array_elements(data->'categories') with ordinality as categories(category,ordinality);

insert into public.categories(parent_id,slug,name,sort_order)
select parent.id,child->>'slug',child->>'name',children.ordinality::integer*10
from local_reference,jsonb_array_elements(data->'categories') category
cross join lateral jsonb_array_elements(category->'children') with ordinality as children(child,ordinality)
join public.categories parent on parent.slug=category->>'slug';

insert into public.specialist_categories(parent_name,slug,name,active)
select profession->>'parent',profession->>'slug',profession->>'name',(profession->>'active')::boolean
from local_reference,jsonb_array_elements(data->'professions') profession;

insert into public.tariffs(name,action,price,duration_days,active)
select tariff->>'name',(tariff->>'action')::public.tariff_action,(tariff->>'price')::numeric,
  (tariff->>'durationDays')::integer,(tariff->>'active')::boolean
from local_reference,jsonb_array_elements(data->'tariffs') tariff
on conflict(action) do update set name=excluded.name,price=excluded.price,
  duration_days=excluded.duration_days,active=excluded.active;
drop table local_reference;
