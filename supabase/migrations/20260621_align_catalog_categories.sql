-- Align public catalog categories with the current product taxonomy.
-- Old categories are deactivated instead of deleted to keep existing listing FK relations intact.

with canonical(slug, name, sort_order) as (
  values
    ('zhivotnye', 'Животные', 10),
    ('sad-i-rasteniya', 'Сад и огород', 20),
    ('tovary-dlya-detey', 'Товары для детей', 30),
    ('ritualnye-uslugi', 'Ритуальные услуги', 40),
    ('nedvizhimost', 'Недвижимость', 50),
    ('rabota', 'Работа', 60),
    ('odezhda-obuv-aksessuary', 'Одежда, обувь, аксессуары', 70),
    ('otdyh', 'Хобби и отдых', 80),
    ('transport', 'Авто', 90),
    ('biznes', 'Готовый бизнес и оборудование', 100),
    ('uslugi-dlya-doma', 'Услуги', 110),
    ('elektronika', 'Электроника', 120),
    ('dlya-doma-i-dachi', 'Для дома и дачи', 130),
    ('instrumenty', 'Инструменты', 140),
    ('posuda', 'Посуда', 150),
    ('krasota-i-uhod', 'Красота и здоровье', 160),
    ('raznoe', 'Разное', 170)
)
insert into public.categories (slug, name, sort_order, active)
select slug, name, sort_order, true
from canonical
on conflict (slug) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    parent_id = null,
    active = true;

update public.categories
set active = false
where slug in (
  'antikvariat-i-kollektsii',
  'meditsina',
  'mebel-i-interer',
  'remont-i-stroitelstvo',
  'tovary-i-veshchi',
  'yarmarka-masterov',
  'znakomstva'
);

update public.categories child
set active = false
from public.categories parent
where child.parent_id = parent.id
  and parent.slug in (
    'antikvariat-i-kollektsii',
    'meditsina',
    'mebel-i-interer',
    'remont-i-stroitelstvo',
    'tovary-i-veshchi',
    'yarmarka-masterov',
    'znakomstva'
  );

with child_categories(parent_slug, slug, name, sort_order) as (
  values
    ('nedvizhimost', 'prodam-nedvizhimost', 'Продам недвижимость', 10),
    ('nedvizhimost', 'kuplyu-nedvizhimost', 'Куплю недвижимость', 20),
    ('nedvizhimost', 'kommercheskaya-nedvizhimost', 'Коммерческая недвижимость', 30),
    ('nedvizhimost', 'zhile-dlya-puteshestviya', 'Жилье для путешествия', 40),
    ('transport', 'prodam-avto', 'Продам авто', 10),
    ('transport', 'kuplyu-avto', 'Куплю авто', 20),
    ('transport', 'mototehnika', 'Мототехника', 30),
    ('transport', 'zapchasti', 'Запчасти', 40),
    ('zhivotnye', 'domashnie-pitomtsy', 'Домашние питомцы', 10),
    ('zhivotnye', 'selhoz-zhivotnye', 'Сельхоз животные', 20),
    ('zhivotnye', 'ekzoticheskie-zhivotnye', 'Экзотические животные', 30),
    ('biznes', 'prodam-biznes', 'Продам бизнес', 10),
    ('biznes', 'kuplyu-biznes', 'Куплю бизнес', 20),
    ('biznes', 'oborudovanie', 'Оборудование', 30),
    ('biznes', 'partnerstvo', 'Партнерство', 40),
    ('krasota-i-uhod', 'parikmahery', 'Парикмахеры', 10),
    ('krasota-i-uhod', 'manikyur-i-pedikyur', 'Маникюр и педикюр', 20),
    ('krasota-i-uhod', 'uhod-i-kosmetika', 'Уход и косметика', 30),
    ('elektronika', 'smartfony', 'Смартфоны', 10),
    ('elektronika', 'noutbuki', 'Ноутбуки', 20),
    ('elektronika', 'kompyutery', 'Компьютеры', 30),
    ('elektronika', 'audio-i-video', 'Аудио и видео', 40),
    ('elektronika', 'igrovye-pristavki', 'Игровые приставки', 50),
    ('dlya-doma-i-dachi', 'mebel-dlya-doma-i-dachi', 'Мебель для дома и дачи', 10),
    ('dlya-doma-i-dachi', 'osveshchenie', 'Освещение', 20),
    ('dlya-doma-i-dachi', 'dekor', 'Декор', 30),
    ('dlya-doma-i-dachi', 'sadovyy-inventar', 'Садовый инвентарь', 40),
    ('dlya-doma-i-dachi', 'tovary-dlya-bani-i-sauny', 'Товары для бани и сауны', 50),
    ('dlya-doma-i-dachi', 'biotualety-i-umyvalniki', 'Биотуалеты и умывальники', 60),
    ('odezhda-obuv-aksessuary', 'odezhda', 'Одежда', 10),
    ('odezhda-obuv-aksessuary', 'obuv', 'Обувь', 20),
    ('odezhda-obuv-aksessuary', 'aksessuary', 'Аксессуары', 30),
    ('otdyh', 'turbazy', 'Турбазы', 10),
    ('otdyh', 'gostinitsy', 'Гостиницы', 20),
    ('otdyh', 'pohody', 'Походы', 30),
    ('rabota', 'vakansii', 'Вакансии', 10),
    ('rabota', 'ankety-spetsialistov', 'Анкеты специалистов', 20),
    ('sad-i-rasteniya', 'tsvety-i-sazhentsy', 'Цветы и саженцы', 10),
    ('tovary-dlya-detey', 'igrushki', 'Игрушки', 10),
    ('tovary-dlya-detey', 'tehnicheskie-igrushki', 'Технические игрушки', 20),
    ('tovary-dlya-detey', 'didakticheskie-igrushki', 'Дидактические игрушки', 30),
    ('tovary-dlya-detey', 'sportivnye-sportivno-motornye-igrushki', 'Спортивные (спортивно-моторные) игрушки', 40),
    ('instrumenty', 'slesarno-montazhnyy-ruchnoy-instrument', 'Слесарно-монтажный ручной инструмент', 10),
    ('instrumenty', 'elektroinstrument', 'Электроинструмент', 20),
    ('instrumenty', 'izmeritelnyy-instrument', 'Измерительный инструмент', 30),
    ('instrumenty', 'instrumenty-dlya-stroyki-i-otdelki', 'Инструменты для стройки и отделки', 40),
    ('instrumenty', 'sadovyy-instrument', 'Садовый инструмент', 50),
    ('instrumenty', 'vspomogatelnye-i-zashchitnye-sredstva', 'Вспомогательные и защитные средства', 60),
    ('uslugi-dlya-doma', 'klining', 'Клининг', 10),
    ('uslugi-dlya-doma', 'remont-i-stroitelstvo', 'Ремонт и строительство', 20),
    ('uslugi-dlya-doma', 'bytovye-uslugi', 'Бытовые услуги', 30),
    ('ritualnye-uslugi', 'organizatsiya-pohoron', 'Организация похорон', 10),
    ('ritualnye-uslugi', 'pamyatniki', 'Памятники', 20),
    ('ritualnye-uslugi', 'uhod-za-mestom', 'Уход за местом', 30),
    ('posuda', 'kuhonnaya-posuda', 'Кухонная', 10),
    ('posuda', 'stolovaya-posuda', 'Столовая', 20),
    ('posuda', 'dlya-napitkov', 'Для напитков', 30),
    ('posuda', 'dlya-hraneniya-i-zagotovok', 'Для хранения и заготовок', 40),
    ('posuda', 'pribory-dlya-podachi', 'Приборы для подачи', 50),
    ('posuda', 'prochaya-utvar', 'Прочая утварь', 60),
    ('raznoe', 'kollektsii-i-antikvariat', 'Коллекции и антиквариат', 20)
)
insert into public.categories (parent_id, slug, name, sort_order, active)
select parent.id, child.slug, child.name, child.sort_order, true
from child_categories child
join public.categories parent on parent.slug = child.parent_slug
on conflict (slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    active = true;
