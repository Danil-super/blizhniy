import type { Category, City, JobVacancy, Profession, SpecialistProfile } from "./types";

export const region = {
  slug: "krasnodarskiy-kray",
  name: "Краснодарский край",
};

export const cities: City[] = [
  { slug: "krasnodar", name: "Краснодар", regionSlug: region.slug },
  { slug: "sochi", name: "Сочи", regionSlug: region.slug },
  { slug: "anapa", name: "Анапа", regionSlug: region.slug },
  { slug: "novorossiysk", name: "Новороссийск", regionSlug: region.slug },
  { slug: "armavir", name: "Армавир", regionSlug: region.slug },
  { slug: "gelendzhik", name: "Геленджик", regionSlug: region.slug },
  { slug: "eysk", name: "Ейск", regionSlug: region.slug },
  { slug: "tuapse", name: "Туапсе", regionSlug: region.slug },
];

export const categories: Category[] = [
  { slug: "antikvariat-i-kollektsii", name: "Антиквариат и коллекции", children: ["Товары времен СССР", "Картины и живопись"] },
  { slug: "zhivotnye", name: "Животные", children: ["Животные", "Товары для животных"] },
  { slug: "krasota-i-uhod", name: "Красота и уход", children: ["Парикмахеры", "Маникюр и педикюр"] },
  { slug: "meditsina", name: "Медицина", children: ["Медицинский персонал", "Уход на дому"] },
  { slug: "mebel-i-interer", name: "Мебель и интерьер", children: ["Мебель"] },
  { slug: "rabota", name: "Работа", children: ["Вакансии", "Анкеты специалистов"] },
  { slug: "remont-i-stroitelstvo", name: "Ремонт и строительство", children: ["Ремонт квартир", "Сантехника"] },
  { slug: "sad-i-rasteniya", name: "Сад и растения", children: ["Цветы и саженцы"] },
  { slug: "tovary-i-veshchi", name: "Товары и вещи", children: ["Выкройки и рукоделие"] },
  { slug: "uslugi-dlya-doma", name: "Услуги для дома", children: ["Клининг"] },
];

export const professions: Profession[] = [
  { parent: "Юридические услуги", name: "Юрист", slug: "yurist", active: true },
  { parent: "Красота и уход", name: "Швея", slug: "shveya", active: true },
  { parent: "Ремонт и строительство", name: "Сварщик", slug: "svarshchik", active: true },
  { parent: "Образование", name: "Репетитор английского языка", slug: "repetitor-angliyskogo", active: true },
  { parent: "Ремонт и строительство", name: "Сантехник", slug: "santehnik", active: true },
  { parent: "Красота и уход", name: "Парикмахер", slug: "parikmaher", active: true },
  { parent: "Красота и уход", name: "Мастер маникюра", slug: "master-manikyura", active: true },
  { parent: "Услуги для дома", name: "Клининг-специалист", slug: "klining-spetsialist", active: true },
  { parent: "Медицина", name: "Сиделка", slug: "sidelka", active: true },
  { parent: "Медицина", name: "Медсестра", slug: "medsestra", active: true },
  { parent: "Ремонт и строительство", name: "Плиточник", slug: "plitochnik", active: true },
  { parent: "Ремонт и строительство", name: "Электрик", slug: "elektrik", active: true },
  { parent: "Ремонт и строительство", name: "Мастер ремонта квартир", slug: "master-remonta-kvartir", active: true },
  { parent: "Мебель и интерьер", name: "Мебельщик", slug: "mebelshchik", active: true },
];

export const vacancies: JobVacancy[] = [
  {
    id: "santehnik-remdom-123",
    organization: "ООО РемДом",
    title: "Сантехник",
    profession: "Сантехник",
    city: "Краснодар",
    salary: "от 80 000 ₽",
    logoText: "РемДом",
    logoTone: "blue",
    phone: "+78610000001",
    status: "published",
  },
  {
    id: "master-manikyura-liliya-124",
    organization: "Студия Красоты Лилия",
    title: "Мастер маникюра",
    profession: "Мастер маникюра",
    city: "Сочи",
    salary: "от 60 000 ₽",
    logoText: "Лилия",
    logoTone: "violet",
    messengerUrl: "https://wa.me/78610000002",
    status: "published",
  },
  {
    id: "kliner-clean-home-125",
    organization: "Clean Home",
    title: "Клинер",
    profession: "Клининг-специалист",
    city: "Новороссийск",
    salary: "от 45 000 ₽",
    logoText: "Clean Home",
    logoTone: "teal",
    status: "published",
  },
];

export const specialists: SpecialistProfile[] = [
  {
    id: "santehnik-aleksandr-123",
    name: "Александр",
    profession: "Сантехник",
    skills: "Монтаж, ремонт, замена",
    city: "Краснодар",
    price: "от 1 500 ₽",
    imageSeed: "alex",
    phone: "+78610001001",
    messengerUrl: "https://t.me/blizhniy_demo",
    status: "published",
  },
  {
    id: "manikyur-marina-124",
    name: "Марина",
    profession: "Мастер маникюра",
    skills: "Маникюр, педикюр, дизайн",
    city: "Сочи",
    price: "от 1 200 ₽",
    imageSeed: "marina",
    phone: "+78610001002",
    messengerUrl: "https://wa.me/78610001002",
    status: "published",
  },
  {
    id: "repetitor-irina-125",
    name: "Ирина",
    profession: "Репетитор английского",
    skills: "Подготовка, разговорный английский",
    city: "Краснодар",
    price: "от 900 ₽",
    imageSeed: "irina",
    phone: "+78610001003",
    videoUrl: "https://meet.google.com/",
    status: "published",
  },
];

export const tariffs = [
  { id: "listing-publication", name: "Размещение объявления", action: "listing_publication", price: 199, durationDays: 30, active: true },
  { id: "vacancy-publication", name: "Размещение вакансии", action: "vacancy_publication", price: 499, durationDays: 30, active: true },
  { id: "job-response", name: "Отклик на вакансию", action: "job_response", price: 99, durationDays: null, active: true },
];
