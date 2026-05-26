insert into categories (slug, name, sort_order) values
  ('nedvizhimost', 'Недвижимость', 10),
  ('transport', 'Авто', 20),
  ('antikvariat-i-kollektsii', 'Антиквариат и коллекции', 30),
  ('zhivotnye', 'Животные', 40),
  ('biznes', 'Бизнес', 50),
  ('krasota-i-uhod', 'Красота и уход', 60),
  ('meditsina', 'Медицина', 70),
  ('mebel-i-interer', 'Мебель и интерьер', 80),
  ('otdyh', 'Отдых', 90),
  ('rabota', 'Работа', 100),
  ('remont-i-stroitelstvo', 'Ремонт и строительство', 110),
  ('sad-i-rasteniya', 'Сад и растения', 120),
  ('tovary-i-veshchi', 'Товары и вещи', 130),
  ('uslugi-dlya-doma', 'Услуги для дома', 140),
  ('ritualnye-uslugi', 'Ритуальные услуги', 150),
  ('yarmarka-masterov', 'Ярмарка мастеров', 160),
  ('znakomstva', 'Знакомства', 170)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into categories (parent_id, slug, name, sort_order)
select parent.id, child.slug, child.name, child.sort_order
from (
  values
    ('nedvizhimost', 'prodam-nedvizhimost', 'Продам недвижимость', 10),
    ('nedvizhimost', 'kuplyu-nedvizhimost', 'Куплю недвижимость', 20),
    ('nedvizhimost', 'arenda', 'Аренда', 30),
    ('nedvizhimost', 'kommercheskaya-nedvizhimost', 'Коммерческая недвижимость', 40),
    ('transport', 'prodam-avto', 'Продам авто', 10),
    ('transport', 'kuplyu-avto', 'Куплю авто', 20),
    ('transport', 'mototehnika', 'Мототехника', 30),
    ('transport', 'zapchasti', 'Запчасти', 40),
    ('antikvariat-i-kollektsii', 'tovary-vremen-sssr', 'Товары времен СССР', 10),
    ('antikvariat-i-kollektsii', 'kartiny-i-zhivopis', 'Картины и живопись', 20),
    ('zhivotnye', 'zhivotnye-pets', 'Животные', 10),
    ('zhivotnye', 'tovary-dlya-zhivotnyh', 'Товары для животных', 20),
    ('biznes', 'prodam-biznes', 'Продам бизнес', 10),
    ('biznes', 'kuplyu-biznes', 'Куплю бизнес', 20),
    ('biznes', 'oborudovanie', 'Оборудование', 30),
    ('biznes', 'partnerstvo', 'Партнерство', 40),
    ('krasota-i-uhod', 'parikmahery', 'Парикмахеры', 10),
    ('krasota-i-uhod', 'manikyur-i-pedikyur', 'Маникюр и педикюр', 20),
    ('meditsina', 'meditsinskiy-personal', 'Медицинский персонал', 10),
    ('meditsina', 'uhod-na-domu', 'Уход на дому', 20),
    ('mebel-i-interer', 'mebel', 'Мебель', 10),
    ('otdyh', 'turbazy', 'Турбазы', 10),
    ('otdyh', 'gostinitsy', 'Гостиницы', 20),
    ('otdyh', 'pohody', 'Походы', 30),
    ('rabota', 'vakansii', 'Вакансии', 10),
    ('rabota', 'ankety-spetsialistov', 'Анкеты специалистов', 20),
    ('remont-i-stroitelstvo', 'remont-kvartir', 'Ремонт квартир', 10),
    ('remont-i-stroitelstvo', 'santehnika', 'Сантехника', 20),
    ('sad-i-rasteniya', 'tsvety-i-sazhentsy', 'Цветы и саженцы', 10),
    ('tovary-i-veshchi', 'vykroyki-i-rukodelie', 'Выкройки и рукоделие', 10),
    ('uslugi-dlya-doma', 'klining', 'Клининг', 10),
    ('ritualnye-uslugi', 'organizatsiya-pohoron', 'Организация похорон', 10),
    ('ritualnye-uslugi', 'pamyatniki', 'Памятники', 20),
    ('ritualnye-uslugi', 'uhod-za-mestom', 'Уход за местом', 30),
    ('yarmarka-masterov', 'yarmarka-mebel', 'Мебель', 10),
    ('yarmarka-masterov', 'posuda', 'Посуда', 20),
    ('yarmarka-masterov', 'makrame', 'Макраме', 30),
    ('yarmarka-masterov', 'odezhda-i-tekstil', 'Одежда и текстиль', 40),
    ('yarmarka-masterov', 'yarmarka-raznoe', 'Разное', 50),
    ('yarmarka-masterov', 'sazhentsy-i-rassada', 'Саженцы и рассада', 60)
) as child(parent_slug, slug, name, sort_order)
join categories parent on parent.slug = child.parent_slug
on conflict (slug) do update set name = excluded.name, parent_id = excluded.parent_id, sort_order = excluded.sort_order;

insert into tariffs (name, action, price, duration_days) values
  ('Участие в ярмарке мастеров', 'fair_participation', 1000, null)
on conflict (action) do update set name = excluded.name, price = excluded.price, duration_days = excluded.duration_days, active = true;

insert into specialist_categories (parent_name, slug, name) values
  ('Юридические услуги', 'yurist', 'Юрист'),
  ('Красота и уход', 'shveya', 'Швея'),
  ('Ремонт и строительство', 'svarshchik', 'Сварщик'),
  ('Образование', 'repetitor-angliyskogo', 'Репетитор английского языка'),
  ('Ремонт и строительство', 'santehnik', 'Сантехник'),
  ('Красота и уход', 'parikmaher', 'Парикмахер'),
  ('Красота и уход', 'master-manikyura', 'Мастер маникюра'),
  ('Услуги для дома', 'klining-spetsialist', 'Клининг-специалист'),
  ('Медицина', 'sidelka', 'Сиделка'),
  ('Медицина', 'medsestra', 'Медсестра'),
  ('Ремонт и строительство', 'plitochnik', 'Плиточник'),
  ('Ремонт и строительство', 'elektrik', 'Электрик'),
  ('Ремонт и строительство', 'master-remonta-kvartir', 'Мастер ремонта квартир'),
  ('Мебель и интерьер', 'mebelshchik', 'Мебельщик')
on conflict (slug) do update set parent_name = excluded.parent_name, name = excluded.name;
