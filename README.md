# БЛИЖНИЙ

MVP региональной платформы объявлений, вакансий, заказов, специалистов и локальных активностей для Краснодарского края.

Проект постепенно переводится из демонстрационного MVP в рабочую версию: интерфейс уже собран, основные пользовательские сценарии разложены по страницам, Supabase-схема подготовлена, а часть серверных интеграций уже подключена через API routes.

## Текущий статус

### Уже реализовано

- Next.js 15 + TypeScript + Tailwind CSS.
- Главная страница с категориями, географией и свежими публикациями.
- Каталог объявлений с категориями и подкатегориями.
- Страницы списков объявлений по типам: продажа, покупка, аренда и «отдам даром».
- Детальная страница объявления с контактами, местоположением, шарингом и карточкой продавца.
- Раздел `/rabota`: вакансии, заказы, специалисты и подборки.
- Полные списки `/rabota/vakansii` и `/rabota/specialisty`.
- Формы размещения объявлений, вакансий, заказов, анкет специалистов и заявок на ярмарку.
- Личный кабинет с разделами публикаций, вакансий, заказов, анкеты специалиста, откликов, заявок на ярмарку и платежей.
- Админ-панель с обзором, пользователями, публикациями, категориями, тарифами и заявками.
- Раздел `/yarmarka-masterov`: описание ярмарки, дата, категории, заявки/участники, форма участия.
- Базовая карта/местоположение через `LocationMap`: район, адрес, координаты, скрытие точного адреса для частных лиц и внешний маршрут в Яндекс Картах.
- Авторизация через Supabase Auth на клиенте и серверные проверки для API-сценариев.
- SQL-схема Supabase/PostgreSQL в `supabase/schema.sql`.
- RLS-политики в `supabase/rls.sql`.
- Seed-данные категорий, подкатегорий, тарифов и классификатора специалистов в `supabase/seed.sql`.
- Миграция выравнивания enum-статусов и тарифов: `supabase/migrations/20260615_align_statuses_and_tariffs.sql`.
- Подготовка оплаты: mock-провайдер и базовая интеграция ЮKassa.
- Создание платежей, проверка оплаты после возврата пользователя и серверная логика обработки успешного платежа.
- Базовые SEO-файлы: metadata, canonical, `robots.txt`, `sitemap.xml`.
- Деплой на VPS через GitHub Actions, PM2 и nginx.
- Адаптивные правки интерфейса, включая компактные кнопки действий в карточках подкатегорий.

### Что еще в demo/MVP-режиме

- Часть публикаций, платежей и админских данных пока берется из mock/demo-хранилищ.
- Некоторые изменения в админке пока временно живут в памяти процесса Node.js и должны быть перенесены в Supabase.
- Загрузка фото подготовлена на уровне UI, но production-storage еще нужно довести до полноценного сценария.
- Turnstile-защита сейчас работает как легкая локальная проверка; перед продом нужно подключить настоящую проверку Cloudflare Turnstile.
- Webhook ЮKassa нужно вынести в отдельный production route и проверить на повторных уведомлениях.

## Запуск локально

```bash
npm install
npm run dev
```

После запуска основные страницы доступны по адресам:

- главная: `http://localhost:3000`
- работа: `http://localhost:3000/rabota`
- объявления: `http://localhost:3000/obyavleniya/prodam`
- категории: `http://localhost:3000/katalog`
- ярмарка мастеров: `http://localhost:3000/yarmarka-masterov`
- заявка на ярмарку: `http://localhost:3000/yarmarka-masterov/zayavka`
- размещение публикации: `http://localhost:3000/razmestit`
- создание объявления: `http://localhost:3000/razmestit/obyavlenie`
- кабинет: `http://localhost:3000/cabinet`
- заявки на ярмарку в кабинете: `http://localhost:3000/cabinet/fair-applications`
- админка: `http://localhost:3000/admin`
- заявки на ярмарку в админке: `http://localhost:3000/admin/fair-applications`
- mock-оплата: `http://localhost:3000/oplata/listing-publication`

## Проверки

```bash
npm run lint
npm run build
```

Эти команды также запускаются в GitHub Actions перед деплоем.

## Переменные окружения

Минимальный набор для локального подключения Supabase:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_EMAIL=admin@example.ru
PAYMENT_PROVIDER=mock
```

Для ЮKassa:

```env
PAYMENT_PROVIDER=yookassa
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=... # production: live key only, not test_
YOOKASSA_WEBHOOK_SECRET=...
NEXT_PUBLIC_SITE_URL=https://ближний-ру.рф
```

Канонический webhook ЮKassa: `https://ближний-ру.рф/api/payments/yookassa/webhook`.

Для production-защиты форм нужно будет добавить настоящие ключи Cloudflare Turnstile:

```env
NEXT_PUBLIC_TURNSTILE_SITE_KEY=...
TURNSTILE_SECRET_KEY=...
```

## Supabase

Подробная инструкция лежит в `docs/SUPABASE_SETUP.md`.

Базовый порядок применения SQL:

1. `supabase/schema.sql`
2. `supabase/seed.sql`
3. `supabase/rls.sql`
4. `supabase/migrations/20260615_align_statuses_and_tariffs.sql`

Миграция `20260615_align_statuses_and_tariffs.sql` добавляет недостающие значения enum и тарифы, которые уже используются в TypeScript-модели: `sold`, `specialist_publication`, `ad_marquee`.

## Деплой на VPS через GitHub Actions

Проект готов к схеме: локальная разработка -> GitHub -> автоматическое обновление VPS.

### 1. Первый запуск на VPS

На сервере должны быть установлены Node.js 20+, npm, git, nginx и PM2:

```bash
npm install -g pm2
```

Клонировать репозиторий:

```bash
sudo mkdir -p /var/www/blizhniy
sudo chown -R "$USER":"$USER" /var/www/blizhniy
git clone https://github.com/Danil-super/blizhniy.git /var/www/blizhniy
cd /var/www/blizhniy
npm ci
npm run build
pm2 startOrReload ecosystem.config.cjs
pm2 save
```

Пример nginx-конфига лежит в `deploy/nginx.conf.example`. В нем указан домен `ближний-ру.рф`; после копирования подключите файл в `/etc/nginx/sites-enabled/`.

### 2. Секреты GitHub

В GitHub открыть `Settings -> Secrets and variables -> Actions -> New repository secret` и добавить:

```text
VPS_HOST=IP_АДРЕС_СЕРВЕРА
VPS_PORT=22
VPS_USER=deploy
VPS_SSH_KEY=приватный_SSH_ключ_для_доступа_к_VPS
APP_DIR=/var/www/blizhniy
```

`VPS_SSH_KEY` должен быть приватным ключом, а его публичная часть должна быть добавлена на VPS в `~/.ssh/authorized_keys` пользователя `VPS_USER`.

### 3. Как теперь обновлять сайт

После настройки достаточно пушить изменения в ветку `main`:

```bash
git add .
git commit -m "Update site"
git push
```

GitHub Actions подключится к VPS и выполнит zero-downtime deploy: новый релиз собирается в отдельной папке `/var/www/blizhniy-releases`, копирует серверные `.env*`, проходит healthcheck и только после этого переключает PM2. Если healthcheck не проходит, скрипт откатывает PM2 на предыдущий релиз.

## Ближайший план исправлений

1. Убрать mock/demo-хранилища из production-сценариев.
2. Перевести тарифы, платежи и админские изменения полностью в Supabase.
3. Добавить production webhook ЮKassa.
4. Усилить серверную защиту админских действий.
5. Подключить настоящий Cloudflare Turnstile siteverify.
6. Довести загрузку фото через Supabase Storage.
7. Проверить полный сценарий: регистрация -> размещение -> оплата -> публикация -> модерация.
