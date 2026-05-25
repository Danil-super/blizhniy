# БЛИЖНИЙ

MVP региональной платформы объявлений, вакансий и специалистов для Краснодарского края.

## Что сделано в первом срезе

- Next.js + TypeScript + Tailwind CSS.
- Главная страница с категориями и стартовой географией.
- Страница `/blizhniy/rabota` по макету: вакансии слева, специалисты справа, CTA, чипы, классификатор, короткие подборки.
- Страницы полных списков `/blizhniy/rabota/vakansii` и `/blizhniy/rabota/specialisty`.
- Новые категории каталога: «Отдых», «Знакомства», «Ярмарка мастеров».
- MVP-раздел `/yarmarka-masterov`: дата ближайшей ярмарки, категории мастеров, заявки/участники, заглушка онлайн-трансляции.
- Форма `/yarmarka-masterov/zayavka` с полями участника, категории, описания, фото, ссылки на видео, контактов и согласия с правилами.
- Раздел «Работа» с переключаемыми вкладками спроса/предложения: новые вакансии, заказчики, новые специалисты, исполнители.
- Базовая карта/местоположение через `LocationMap`: адрес, район, координаты, скрытие точного адреса для частных лиц и внешний маршрут в Яндекс Картах.
- Базовые SEO-файлы: metadata, canonical, `robots.txt`, `sitemap.xml`.
- SQL-схема Supabase/PostgreSQL в `supabase/schema.sql`.
- Инструкция подключения Supabase/Auth: `docs/SUPABASE_SETUP.md`.

## Запуск

```bash
npm install
npm run dev
```

После запуска:

- главная: `http://localhost:3000`
- работа: `http://localhost:3000/blizhniy/rabota`
- объявления: `http://localhost:3000/blizhniy/prodam`
- категории: `http://localhost:3000/blizhniy/kategorii`
- ярмарка мастеров: `http://localhost:3000/yarmarka-masterov`
- заявка на ярмарку: `http://localhost:3000/yarmarka-masterov/zayavka`
- кабинет: `http://localhost:3000/cabinet`
- заявки на ярмарку в кабинете: `http://localhost:3000/cabinet/fair-applications`
- админка: `http://localhost:3000/admin`
- заявки на ярмарку в админке: `http://localhost:3000/admin/fair-applications`
- mock-оплата: `http://localhost:3000/blizhniy/oplata/listing-publication`

## Новые SQL-изменения

- `supabase/seed.sql` добавляет категории «Отдых», «Знакомства», «Ярмарка мастеров» и подкатегории без дублей через `on conflict`.
- `tariff_action` расширен действием `fair_participation`, тариф «Участие в ярмарке мастеров» стоит 1000 ₽ и сидится как остальные тарифы.
- Добавлены таблицы `work_requests`, `fair_applications`, `fair_application_images` и RLS-политики для публичного чтения опубликованных записей, управления своими заявками и админского доступа.
- Поля местоположения используются в существующих сущностях и новых заявках: `address`, `district`, `latitude`, `longitude`, `show_exact_address`.

## Следующие этапы

- Создать Supabase-проект, применить `schema.sql`, `seed.sql`, `rls.sql`, заполнить `.env.local`.
- Подключить Supabase/Auth и заменить мок-данные на запросы.
- Реализовать формы объявлений, вакансий и анкет специалистов.
- Добавить mock payment provider и webhook-обработчик.
- Собрать личный кабинет и минимальную админ-панель.

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
git clone git@github.com:USER/REPO.git /var/www/blizhniy
cd /var/www/blizhniy
npm ci
npm run build
pm2 startOrReload ecosystem.config.cjs
pm2 save
```

Пример nginx-конфига лежит в `deploy/nginx.conf.example`. В нём нужно заменить `example.com` на домен и подключить файл в `/etc/nginx/sites-enabled/`.

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

GitHub Actions подключится к VPS, подтянет свежий `main`, выполнит `npm ci`, `npm run build` и перезапустит приложение через PM2.
