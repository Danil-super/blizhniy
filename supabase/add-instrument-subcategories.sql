insert into categories (slug, name, sort_order) values
  ('instrumenty', 'Инструменты', 135)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into categories (parent_id, slug, name, sort_order)
select parent.id, child.slug, child.name, child.sort_order
from (
  values
    ('instrumenty', 'slesarno-montazhnyy-ruchnoy-instrument', 'Слесарно-монтажный ручной инструмент', 10),
    ('instrumenty', 'elektroinstrument', 'Электроинструмент', 20),
    ('instrumenty', 'izmeritelnyy-instrument', 'Измерительный инструмент', 30),
    ('instrumenty', 'instrumenty-dlya-stroyki-i-otdelki', 'Инструменты для стройки и отделки', 40),
    ('instrumenty', 'sadovyy-instrument', 'Садовый инструмент', 50),
    ('instrumenty', 'vspomogatelnye-i-zashchitnye-sredstva', 'Вспомогательные и защитные средства', 60)
) as child(parent_slug, slug, name, sort_order)
join categories parent on parent.slug = child.parent_slug
on conflict (slug) do update set name = excluded.name, parent_id = excluded.parent_id, sort_order = excluded.sort_order;
