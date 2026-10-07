// Isolated, ephemeral test data. This server has no upstream and rejects writes.
import http from 'node:http';

const garden = { id: 'garden-root', slug: 'sad-i-rasteniya', name: 'Сад и огород', active: true, sort_order: 1 };
const home = { id: 'home-root', slug: 'dlya-doma-i-dachi', name: 'Для дома и дачи', active: true, sort_order: 2 };
const beauty = { id: 'beauty-root', slug: 'krasota-i-zdorovie', name: 'Красота и здоровье', active: true, sort_order: 3 };
const flowers = { id: 'flowers-child', parent_id: garden.id, slug: 'tsvety-i-sazhentsy', name: 'Цветы и саженцы', active: true, sort_order: 1 };
const categories = [garden, home, beauty, flowers,
  { id: 'hair-one', parent_id: beauty.id, slug: 'hair-one', name: 'Парикмахеры', active: true, sort_order: 1 },
  { id: 'hair-two', parent_id: beauty.id, slug: 'hair-two', name: 'Парикмахеры', active: true, sort_order: 2 },
  { id: 'nails-one', parent_id: beauty.id, slug: 'nails-one', name: 'Маникюр и педикюр', active: true, sort_order: 3 },
  { id: 'nails-two', parent_id: beauty.id, slug: 'nails-two', name: 'Маникюр и педикюр', active: true, sort_order: 4 },
  { id: 'beauty-hidden', parent_id: beauty.id, slug: 'beauty-hidden', name: 'Скрытая услуга', active: false, sort_order: 5 },
];
const common = {
  author_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', description: 'Синтетические данные локальной регрессионной проверки. Не настоящая публикация.',
  status: 'published', is_paid: true, view_count: 0, price: 1500,
  created_at: '2026-10-01T09:00:00.000Z', published_at: '2026-10-01T09:00:00.000Z', expires_at: '2030-10-01T09:00:00.000Z',
  cities: { name: 'Краснодар', slug: 'krasnodar' }, profiles: { display_name: 'Локальный тестовый продавец' },
  listing_images: [], show_exact_address: false,
};
const listings = [
  { ...common, id: '11111111-1111-4111-8111-111111111111', listing_type: 'buy', category_id: garden.id, categories: garden, title: 'Локальный тест: куплю саженцы гортензии' },
  { ...common, id: '22222222-2222-4222-8222-222222222222', listing_type: 'sell', category_id: home.id, categories: home, title: 'Локальный тест: комод из массива дерева' },
  { ...common, id: '33333333-3333-4333-8333-333333333333', listing_type: 'sell', category_id: flowers.id, categories: flowers, title: 'Локальный тест: цветы и саженцы' },
];

// Synthetic contact needles deliberately remain in the REST response so the
// application's public adapters, HTML and RSC can be checked for redaction.
const privacyPublicationCommon = {
  author_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  city_id: 'city-krasnodar', region_id: 'region-krasnodar',
  description: 'Синтетическая публикация для проверки приватности контактов.',
  status: 'published', is_paid: true,
  created_at: '2026-10-01T09:00:00.000Z', published_at: '2026-10-01T09:00:00.000Z', expires_at: '2099-10-01T09:00:00.000Z',
  address: 'Synthetic Street, 18', latitude: 45.10101, longitude: 38.99999, show_exact_address: true,
  cities: { name: 'Краснодар', slug: 'krasnodar' },
  specialist_categories: { name: 'Сантехник', slug: 'santehnik' },
  contact_phone: '+79995550123', email: 'private-contact@example.test', messenger_url: 'https://t.me/private_contact',
  contact_person: 'Private contact person', website: 'https://private-contact.example.test',
};
const vacancies = [{
  ...privacyPublicationCommon,
  id: '11111111-1111-4111-8111-111111111111', title: 'Синтетическая вакансия сантехника',
  employer_type: 'organization', organization_name: 'ООО Публичный работодатель', inn: '2300123456', ogrn: '1232300000001',
  salary: 60000, vacancy_images: [],
}];
const workRequests = [{
  ...privacyPublicationCommon,
  id: '66666666-6666-4666-8666-666666666666', title: 'Синтетический заказ сантехнику',
  budget: 5000, work_request_images: [], profiles: { display_name: 'Публичный заказчик' },
}];

function filtered(rows, params) {
  return rows.filter((row) => Array.from(params).every(([key, value]) => {
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
    if (value === 'is.null') return row[key] == null;
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]));
    return true;
  })).slice(Number(params.get('offset') ?? 0), Number(params.get('offset') ?? 0) + Number(params.get('limit') ?? 1000));
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:39847');
  if (request.method !== 'GET') {
    response.writeHead(405, { 'Content-Type': 'application/json', Allow: 'GET' });
    response.end(JSON.stringify({ error: 'Read-only local fixture; writes forbidden' }));
    process.stdout.write(JSON.stringify({ method: request.method, path: url.pathname, rejected: true }) + '\n');
    return;
  }
  let rows = [];
  if (url.pathname === '/rest/v1/categories') rows = filtered(categories, url.searchParams);
  if (url.pathname === '/rest/v1/listings') rows = filtered(listings, url.searchParams);
  if (url.pathname === '/rest/v1/vacancies') rows = filtered(vacancies, url.searchParams);
  if (url.pathname === '/rest/v1/work_requests') rows = filtered(workRequests, url.searchParams);
  response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(rows));
  process.stdout.write(JSON.stringify({ method: request.method, path: url.pathname, rows: rows.length }) + '\n');
});
server.listen(39847, '127.0.0.1', () => process.stdout.write('READ_ONLY_UI_FIXTURE http://127.0.0.1:39847\n'));
