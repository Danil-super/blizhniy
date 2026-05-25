# БЛИЖНИЙ

MVP региональной платформы объявлений, вакансий и специалистов для Краснодарского края.

## Что сделано в первом срезе

- Next.js + TypeScript + Tailwind CSS.
- Главная страница с категориями и стартовой географией.
- Страница `/krasnodar/rabota` по макету: вакансии слева, специалисты справа, CTA, чипы, классификатор, короткие подборки.
- Страницы полных списков `/krasnodar/rabota/vakansii` и `/krasnodar/rabota/specialisty`.
- Базовые SEO-файлы: metadata, canonical, `robots.txt`, `sitemap.xml`.
- SQL-схема Supabase/PostgreSQL в `supabase/schema.sql`.

## Запуск

```bash
npm install
npm run dev
```

После запуска:

- главная: `http://localhost:3000`
- работа: `http://localhost:3000/krasnodar/rabota`

## Следующие этапы

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
