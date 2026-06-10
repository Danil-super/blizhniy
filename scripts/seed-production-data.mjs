import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  "content-type": "application/json",
};

const region = { slug: "krasnodarskiy-kray", name: "Краснодарский край", active: true };

const cities = [
  ["abinsk", "Абинск"],
  ["anapa", "Анапа"],
  ["apsheronsk", "Апшеронск"],
  ["armavir", "Армавир"],
  ["belorechensk", "Белореченск"],
  ["gelendzhik", "Геленджик"],
  ["goryachiy-klyuch", "Горячий Ключ"],
  ["gulkevichi", "Гулькевичи"],
  ["eysk", "Ейск"],
  ["korenovsk", "Кореновск"],
  ["krasnodar", "Краснодар"],
  ["kropotkin", "Кропоткин"],
  ["krymsk", "Крымск"],
  ["kurganinsk", "Курганинск"],
  ["labinsk", "Лабинск"],
  ["novokubansk", "Новокубанск"],
  ["novorossiysk", "Новороссийск"],
  ["primorsko-akhtarsk", "Приморско-Ахтарск"],
  ["slavyansk-na-kubani", "Славянск-на-Кубани"],
  ["sochi", "Сочи"],
  ["temryuk", "Темрюк"],
  ["timashevsk", "Тимашевск"],
  ["tikhoretsk", "Тихорецк"],
  ["tuapse", "Туапсе"],
  ["ust-labinsk", "Усть-Лабинск"],
  ["khadyzhensk", "Хадыженск"],
];

const categories = [
  { slug: "zhivotnye", name: "Животные", children: ["Домашние питомцы", "Сельхоз животные", "Экзотические животные"] },
  { slug: "sad-i-rasteniya", name: "Сад и огород", children: ["Цветы и саженцы", "Рассада", "Овощи", "Зелень", "Корнеплоды", "Бобовые", "Садовый инвентарь", "Удобрения и средства защиты растений", "Системы полива", "Мульча", "Плодовые деревья", "Ягодные кустарники", "Декоративные цветы и растения", "Газоны, клумбы, альпийские горки, живые изгороди", "Элементы ландшафтного дизайна", "Места для отдыха"] },
  { slug: "tovary-dlya-detey", name: "Товары для детей", children: ["Игрушки", "Технические игрушки", "Дидактические игрушки", "Спортивные игрушки"] },
  { slug: "odezhda-obuv-aksessuary", name: "Одежда, обувь, аксессуары", children: ["Одежда", "Обувь", "Аксессуары"] },
  { slug: "tovary-i-veshchi", name: "Товары и вещи", children: ["Выкройки и рукоделие"] },
  { slug: "ritualnye-uslugi", name: "Ритуальные услуги", children: ["Кремация", "Уход за местом захоронения", "Транспортирование останков", "Подготовка тела к погребению", "Предпохоронное содержание останков", "Захоронение и сопутствующие работы", "Организация и проведение обряда прощания", "Продажа и изготовление похоронных принадлежностей", "Изготовление, установка и демонтаж намогильных сооружений"] },
  { slug: "nedvizhimost", name: "Недвижимость", children: ["Продам недвижимость", "Куплю недвижимость", "Аренда", "Коммерческая недвижимость", "Жилье для путешествия"] },
  { slug: "elektronika", name: "Электроника", children: ["Смартфоны", "Ноутбуки", "Компьютеры", "Аудио и видео", "Игровые приставки"] },
  { slug: "antikvariat-i-kollektsii", name: "Антиквариат и коллекции", children: ["Товары времен СССР", "Картины и живопись"] },
  { slug: "transport", name: "Авто", children: ["Продам авто", "Куплю авто", "Мототехника", "Запчасти"] },
  { slug: "biznes", name: "Готовый бизнес и оборудование", children: ["Продам бизнес", "Куплю бизнес", "Оборудование", "Партнерство"] },
  { slug: "krasota-i-uhod", name: "Красота и здоровье", children: ["Парикмахеры", "Маникюр и педикюр"] },
  { slug: "meditsina", name: "Медицина", children: ["Медицинский персонал", "Уход на дому"] },
  { slug: "dlya-doma-i-dachi", name: "Для дома и дачи", children: ["Мебель для дома и дачи", "Освещение", "Декор", "Садовый инвентарь", "Товары для бани и сауны", "Биотуалеты и умывальники"] },
  { slug: "instrumenty", name: "Инструменты", children: [] },
  { slug: "mebel-i-interer", name: "Мебель и интерьер", children: ["Мебель"] },
  { slug: "otdyh", name: "Хобби и отдых", children: ["Турбазы", "Гостиницы", "Походы"] },
  { slug: "rabota", name: "Работа", children: ["Вакансии", "Анкеты специалистов"] },
  { slug: "remont-i-stroitelstvo", name: "Ремонт и строительство", children: ["Ремонт квартир", "Сантехника"] },
  { slug: "uslugi-dlya-doma", name: "Услуги", children: ["Клининг"] },
  { slug: "yarmarka-masterov", name: "Ярмарка мастеров", children: ["Мебель", "Посуда", "Макраме", "Одежда и текстиль", "Разное", "Саженцы и рассада"] },
  { slug: "znakomstva", name: "Знакомства", children: [] },
  { slug: "raznoe", name: "Разное", children: ["Разное"] },
];

const professions = [
  ["Юридические услуги", "yurist", "Юрист"],
  ["Красота и уход", "shveya", "Швея"],
  ["Ремонт и строительство", "svarshchik", "Сварщик"],
  ["Образование", "repetitor-angliyskogo", "Репетитор английского языка"],
  ["Ремонт и строительство", "santehnik", "Сантехник"],
  ["Красота и уход", "parikmaher", "Парикмахер"],
  ["Красота и уход", "master-manikyura", "Мастер маникюра"],
  ["Услуги для дома", "klining-spetsialist", "Клининг-специалист"],
  ["Медицина", "sidelka", "Сиделка"],
  ["Медицина", "medsestra", "Медсестра"],
  ["Ремонт и строительство", "plitochnik", "Плиточник"],
  ["Ремонт и строительство", "elektrik", "Электрик"],
  ["Ремонт и строительство", "master-remonta-kvartir", "Мастер ремонта квартир"],
  ["Мебель и интерьер", "mebelshchik", "Мебельщик"],
];

const tariffs = [
  { name: "Размещение объявления", action: "listing_publication", price: 199, duration_days: 30, active: true },
  { name: "Размещение вакансии", action: "vacancy_publication", price: 499, duration_days: 30, active: true },
  { name: "Отклик на вакансию", action: "job_response", price: 99, duration_days: null, active: true },
  { name: "Участие в ярмарке мастеров", action: "fair_participation", price: 1000, duration_days: null, active: true },
];

const listings = [
  { kind: "prodam", categorySlug: "dlya-doma-i-dachi", city: "krasnodar", title: "Комод из массива дерева", description: "Аккуратный комод для спальни, самовывоз из Краснодара. Есть небольшие следы использования.", district: "Фестивальный район", latitude: 45.056, longitude: 38.958, price: 12500, contact_phone: "+78610002001", published_at: "2026-05-20T10:00:00+03:00" },
  { kind: "kuplyu", categorySlug: "sad-i-rasteniya", city: "sochi", title: "Куплю саженцы гортензии", description: "Ищу 10-15 здоровых саженцев для участка. Рассмотрю Сочи и ближайшие поселки.", district: "Центральный район", latitude: 43.585, longitude: 39.723, price: 7000, messenger_url: "https://wa.me/78610002002", published_at: "2026-05-21T10:00:00+03:00" },
  { kind: "menyayu", categorySlug: "remont-i-stroitelstvo", city: "novorossiysk", title: "Меняю набор электроинструмента", description: "Обменяю комплект инструмента на материалы для ремонта или садовую технику.", district: "Приморский район", latitude: 44.724, longitude: 37.768, contact_phone: "+78610002003", published_at: "2026-05-22T10:00:00+03:00" },
  { kind: "otdam-darom", categorySlug: "tovary-i-veshchi", city: "anapa", title: "Отдам книги по рукоделию", description: "Подборка журналов и книг, все в хорошем состоянии. Забрать можно вечером.", district: "12-й микрорайон", latitude: 44.894, longitude: 37.316, messenger_url: "https://t.me/blizhniy_support", published_at: "2026-05-23T10:00:00+03:00" },
];

const vacancies = [
  { organization_name: "ООО РемДом", title: "Сантехник", professionSlug: "santehnik", city: "krasnodar", district: "Центральный округ", address: "ул. Красная, 118", latitude: 45.037, longitude: 38.975, description: "Обслуживание квартир и частных домов, аварийные и плановые заявки.", requirements: "Опыт от 1 года, аккуратность, свой базовый инструмент.", responsibilities: "Монтаж, диагностика, ремонт, общение с заказчиками.", salary: 80000, schedule: "5/2, выездные заявки", contact_phone: "+78610000001", email: "hr@remdom.example", published_at: "2026-05-20T10:15:00+03:00" },
  { organization_name: "Студия Красоты Лилия", title: "Мастер маникюра", professionSlug: "master-manikyura", city: "sochi", district: "Центральный район", address: "ул. Навагинская, 9", latitude: 43.591, longitude: 39.727, description: "Рабочее место в студии красоты с готовой клиентской базой.", requirements: "Портфолио, санитарная книжка, аккуратность.", responsibilities: "Маникюр, педикюр, дизайн, запись клиентов.", salary: 60000, schedule: "Сменный график", email: "liliya@example.test", published_at: "2026-05-21T12:30:00+03:00" },
  { organization_name: "Clean Home", title: "Клинер", professionSlug: "klining-spetsialist", city: "novorossiysk", district: "Центральный район", address: "ул. Советов, 42", latitude: 44.724, longitude: 37.768, description: "Клининг квартир и домов по заявкам заказчиков.", requirements: "Ответственность и пунктуальность.", responsibilities: "Поддерживающая и генеральная уборка.", salary: 45000, schedule: "Гибкий график", email: "clean@example.test", published_at: "2026-05-22T09:45:00+03:00" },
];

const specialists = [
  { name: "Александр", professionSlug: "santehnik", city: "krasnodar", district: "Фестивальный район", latitude: 45.056, longitude: 38.958, skills: ["Монтаж", "Ремонт", "Замена"], description: "Сантехнические работы по Краснодару и ближайшим районам.", price_from: 1500, contact_phone: "+78610001001", messenger_url: "https://t.me/blizhniy_support", created_at: "2026-05-20T11:20:00+03:00" },
  { name: "Марина", professionSlug: "master-manikyura", city: "sochi", district: "Центральный район", latitude: 43.585, longitude: 39.723, skills: ["Маникюр", "Педикюр", "Дизайн"], description: "Маникюр и педикюр в Сочи, аккуратная работа и стерильные инструменты.", price_from: 1200, contact_phone: "+78610001002", messenger_url: "https://wa.me/78610001002", created_at: "2026-05-21T14:05:00+03:00" },
];

const listingTypeByKind = {
  prodam: "sell",
  kuplyu: "buy",
  menyayu: "exchange",
  "otdam-darom": "free",
};

function slugify(text) {
  const map = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ы: "y", э: "e", ю: "yu", я: "ya",
  };
  return text
    .toLowerCase()
    .replace(/[ъь]/g, "")
    .replace(/[а-яё]/g, (char) => map[char] ?? char)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function rest(path, options = {}) {
  let res;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
        ...options,
        headers: { ...headers, ...(options.headers ?? {}) },
      });
      break;
    } catch (error) {
      if (attempt === 5) {
        throw error;
      }
      await sleep(attempt * 1000);
    }
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${options.method ?? "GET"} ${path}: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function upsert(table, rows, conflict) {
  if (!rows.length) return [];
  return rest(`${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
}

async function selectAll(table, query = "select=*") {
  return rest(`${table}?${query}`);
}

async function tableExists(table) {
  const res = await head(table);
  return res.ok;
}

async function head(table) {
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return await fetch(`${supabaseUrl}/rest/v1/${table}?select=*`, {
        method: "HEAD",
        headers: { ...headers, Prefer: "count=exact" },
      });
    } catch (error) {
      if (attempt === 12) {
        throw error;
      }
      await sleep(attempt * 1500);
    }
  }
}

async function existsByTitle(table, title) {
  const rows = await selectAll(table, `select=id&title=eq.${encodeURIComponent(title)}&limit=1`);
  return rows.length > 0;
}

const [regionRow] = await upsert("regions", [region], "slug");

await upsert(
  "cities",
  cities.map(([slug, name]) => ({ slug, name, region_id: regionRow.id, active: true })),
  "slug",
);

const topCategories = await upsert(
  "categories",
  categories.map((category, index) => ({ slug: category.slug, name: category.name, sort_order: (index + 1) * 10, active: true })),
  "slug",
);
const topCategoryBySlug = Object.fromEntries(topCategories.map((category) => [category.slug, category]));

const childRows = categories.flatMap((category) =>
  category.children.map((name, index) => ({
    parent_id: topCategoryBySlug[category.slug].id,
    slug: `${category.slug}-${slugify(name)}`.slice(0, 90),
    name,
    sort_order: (index + 1) * 10,
    active: true,
  })),
);
await upsert("categories", childRows, "slug");

await upsert(
  "specialist_categories",
  professions.map(([parent_name, slug, name]) => ({ parent_name, slug, name, active: true })),
  "slug",
);
try {
  await upsert("tariffs", tariffs, "action");
} catch (error) {
  if (!String(error.message).includes("fair_participation")) {
    throw error;
  }
  console.warn("Skipping fair_participation tariff because the remote tariff_action enum is not migrated yet.");
  await upsert("tariffs", tariffs.filter((tariff) => tariff.action !== "fair_participation"), "action");
}

const [allProfiles, allCities, allCategories, allProfessions] = await Promise.all([
  selectAll("profiles", "select=id,email,display_name&order=created_at"),
  selectAll("cities", "select=id,slug"),
  selectAll("categories", "select=id,slug"),
  selectAll("specialist_categories", "select=id,slug"),
]);

if (!allProfiles.length) {
  throw new Error("No profiles found. Register at least one user before seeding authored content.");
}

const cityBySlug = Object.fromEntries(allCities.map((city) => [city.slug, city]));
const categoryBySlug = Object.fromEntries(allCategories.map((category) => [category.slug, category]));
const professionBySlug = Object.fromEntries(allProfessions.map((profession) => [profession.slug, profession]));
const authorId = allProfiles[0].id;

let insertedListings = 0;
for (const item of listings) {
  if (await existsByTitle("listings", item.title)) continue;
  await rest("listings", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      author_id: authorId,
      listing_type: listingTypeByKind[item.kind],
      category_id: categoryBySlug[item.categorySlug].id,
      region_id: regionRow.id,
      city_id: cityBySlug[item.city].id,
      district: item.district,
      latitude: item.latitude,
      longitude: item.longitude,
      show_exact_address: false,
      title: item.title,
      description: item.description,
      price: item.price ?? null,
      contact_phone: item.contact_phone ?? null,
      messenger_url: item.messenger_url ?? null,
      status: "published",
      is_paid: true,
      published_at: item.published_at,
      expires_at: "2026-12-31T23:59:59+03:00",
    }),
  });
  insertedListings += 1;
}

let insertedVacancies = 0;
for (const item of vacancies) {
  if (await existsByTitle("vacancies", item.title)) continue;
  await rest("vacancies", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      author_id: authorId,
      organization_name: item.organization_name,
      title: item.title,
      specialist_category_id: professionBySlug[item.professionSlug]?.id ?? null,
      region_id: regionRow.id,
      city_id: cityBySlug[item.city].id,
      district: item.district,
      address: item.address,
      latitude: item.latitude,
      longitude: item.longitude,
      show_exact_address: true,
      description: item.description,
      requirements: item.requirements,
      responsibilities: item.responsibilities,
      salary: item.salary,
      schedule: item.schedule,
      contact_phone: item.contact_phone ?? null,
      email: item.email,
      status: "published",
      is_paid: true,
      published_at: item.published_at,
      expires_at: "2026-12-31T23:59:59+03:00",
    }),
  });
  insertedVacancies += 1;
}

const specialistRows = specialists.slice(0, allProfiles.length).map((item, index) => ({
  user_id: allProfiles[index].id,
  name: item.name,
  region_id: regionRow.id,
  city_id: cityBySlug[item.city].id,
  district: item.district,
  latitude: item.latitude,
  longitude: item.longitude,
  show_exact_address: false,
  specialist_category_id: professionBySlug[item.professionSlug]?.id ?? null,
  skills: item.skills,
  description: item.description,
  price_from: item.price_from,
  contact_phone: item.contact_phone,
  messenger_url: item.messenger_url,
  status: "published",
  created_at: item.created_at,
}));
await upsert("specialist_profiles", specialistRows, "user_id");

const optionalTables = {};
for (const table of ["work_requests", "fair_applications"]) {
  optionalTables[table] = await tableExists(table);
}

const finalTables = ["regions", "cities", "categories", "specialist_categories", "tariffs", "profiles", "listings", "vacancies", "specialist_profiles", "payments"];
const counts = {};
for (const table of finalTables) {
  try {
    const res = await head(table);
    counts[table] = res.headers.get("content-range")?.split("/")?.[1] ?? "unknown";
  } catch (error) {
    counts[table] = `network_error:${error?.cause?.code ?? error.message}`;
  }
}

console.log(JSON.stringify({ insertedListings, insertedVacancies, upsertedSpecialists: specialistRows.length, optionalTables, counts }, null, 2));
