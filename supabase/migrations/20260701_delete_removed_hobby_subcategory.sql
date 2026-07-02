do $$
declare
  removed_category_id uuid;
  fallback_category_id uuid;
begin
  select child.id
    into removed_category_id
  from public.categories child
  join public.categories parent on parent.id = child.parent_id
  where parent.slug = 'otdyh'
    and child.slug = concat('tvorchestvo-i-', 'rukodelie')
  limit 1;

  select id
    into fallback_category_id
  from public.categories
  where slug = 'pohody'
  limit 1;

  if removed_category_id is not null and fallback_category_id is not null then
    update public.listings
    set category_id = fallback_category_id
    where category_id = removed_category_id;
  end if;

  if removed_category_id is not null then
    delete from public.categories
    where id = removed_category_id
      and not exists (
        select 1
        from public.listings
        where category_id = removed_category_id
      );
  end if;
end $$;
