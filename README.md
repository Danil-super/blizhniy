# БЛИЖНИЙ

Региональная платформа объявлений, вакансий, заказов, специалистов, ярмарки мастеров и местной рекламы. Первый регион запуска - Краснодарский край.

Рабочий адрес: [ближний-ру.рф](https://xn----9sbphbgks4a4a.xn--p1ai/).

**Состояние на 29.10.2026: работающий сайт с основным PostgreSQL backend, но полный коммерческий запуск с массовыми LIVE-платежами пока не готов.** Наличие форм, успешной сборки и тестового платежа не означает завершение всех пользовательских сценариев.

Этот README обновлён по коду `b933c8e7ac7bec4b6504383eebda71650d965979`, результатам [проверенного выпуска](https://github.com/Danil-super/blizhniy/actions/runs/40889791667) и публичной проверке сайта 29.10.2026. Детальные документы в `docs/` часто описывают отдельные исторические этапы; дату и границы каждого такого документа нужно учитывать отдельно.

## Что реализовано и что ещё ограничено

| Область | Текущее состояние |
|---|---|
| Публичные страницы | Главная, каталог и категории, поиск, объявления, работа, специалисты, ярмарка, тарифы и документы; metadata, canonical, redirects, robots и sitemap. |
| Основной backend | Серверный PostgreSQL через `pg`, ограниченные роли, явные миграции и проверки конфигурации. Рабочая страница сообщает `blizhniy-auth-backend=postgres`. |
| Аккаунт | Регистрация с подтверждением email, вход и восстановление пароля, HttpOnly cookie-сессии, отзыв сессий, профиль и серверные проверки владельца. |
| Антибот-защита | Серверный Turnstile siteverify, граница доверенного ingress и ограничения запросов. Это уже не только локальная имитация. |
| Telegram | OIDC-подтверждение номера и его привязка к существующему аккаунту. Вход на сайт остаётся по email/паролю. На рабочей странице режим отображается как enabled; полный реальный OAuth-сценарий требует отдельной приёмки. |
| Объявления | Черновики и полная форма, фото, ревизии, модерация/постмодерация, блокировки, действия владельца и серверный контроль срока/оплаченного размещения. Рабочая страница сообщает postmoderation. |
| Работа и сервисы | Формы вакансий/заказов/специалистов/ярмарки/рекламы, кабинет, модерация, публичные проекции, отклики и бронирования. Полный цикл оплаты, снятия, отмены и продления реализован не для всех типов. |
| Медиа | Частные файлы с PostgreSQL metadata, контролем владельца, нормализацией фотографий и отдельным decoder/file runtime. Удаление связей пока не означает удаление файлов и возврат квоты. |
| Почта | Timeweb SMTP adapter, зашифрованная долговечная outbox и отдельный worker. Доставка настоящих писем проверяется отдельно от unit-тестов. |
| Платежи | Неизменяемые payment intents, привязка к владельцу/ревизии/сумме, отправка и серверная сверка ЮKassa, очередь и отдельное исполнение услуги. Основной rollout ограничен TEST; массовый LIVE и завершённые возвраты отсутствуют. |
| Администрирование | Серверные роли и PostgreSQL-пути для публикаций, модерации и справочников. Часть старых разделов ещё зависит от legacy API; вся админка не считается полностью перенесённой. |
| Выпуск | Защищённый main, PR и обязательные проверки; prebuilt-артефакт из GitHub Actions, проверка целостности, выкладка на VPS, postchecks и watchdog отката. |

### Известные ограничения перед запуском

- Завершить LIVE checkout и выдачу услуги для каждого платного типа. Вакансии, заказы и отклики имеют локальные checkout-сценарии, которые ещё не представлены полноценными production routes; специалист, ярмарка и реклама тоже требуют завершённой платёжной цепочки.
- Реализовать полные/частичные возвраты, сверку refund, изменение прав на услугу и безопасное восстановление после изменения черновика во время оплаты.
- Перенести запросы удаления аккаунта и их обработку на основной backend. На дату проверки `/cabinet/udalit-akkaunt` воспроизводит клиентскую ошибку, а старый API возвращает 503.
- Завершить отмену и срок удержания бронирований, снятие/удаление/продление рабочих и сервисных публикаций, правильное отображение истёкшего размещения.
- Довести устойчивость ограничений запросов, восстановление после временных ошибок БД, квоты медиа и контролируемую очистку.
- Включить настоящие PostgreSQL integration suites в обязательный release CI; проверить поиск и конкурентную выдачу фотографий на репрезентативной нагрузке.
- Подтвердить восстановление PostgreSQL вместе с файлами, наблюдение за workers/очередями, доставку алертов, регион размещения данных и эксплуатационные процедуры.
- Закончить проверку доступности интерфейса, включая управление бегущей строкой, и согласовать тексты тарифов/документов с реально доступными действиями.

Полные критерии качества и согласованный объём продукта находятся в [CONSTRAINTS.md](CONSTRAINTS.md). Их нельзя ослаблять ради зелёного CI. Исторические baseline-числа в этом файле не являются сегодняшним измерением.

## Стек и структура

- Next.js 15.5.28 в lockfile, React 19, TypeScript, Tailwind CSS.
- Node.js **22**; текущий основной CI использует **22.23.3**. Worker-контракты требуют Linux и поддерживаемую Node 22, запуск под ограниченным пользователем. Прежнее указание «Node 20+» для текущего контура неприменимо.
- PostgreSQL; основной изолированный стенд использует PostgreSQL **18.6**. Исторические платёжные integration suites используют отдельные закреплённые образы, включая PostgreSQL 17.
- `pg`, `nodemailer`, `openid-client`, `sharp`; legacy Supabase сохранён для совместимости, а не как автоматический fallback основного backend.
- Production prebuilt рассчитан на Linux x64/glibc, VPS с reverse proxy, PM2 и отдельно установленными workers.

| Каталог | Назначение |
|---|---|
| `src/app` | Страницы App Router и HTTP routes |
| `src/components` | Интерфейс и клиентские формы |
| `src/lib` | Контракты, авторизация, PostgreSQL stores, платежи, медиа, почта |
| `database/migrations` | 32 последовательных миграции основного backend и отдельные down-планы |
| `database/permissions` | Точечные операторские планы прав |
| `supabase` | Историческая схема, RLS и миграции старого контура |
| `scripts` | Проверки, изолированные стенды, операторские процедуры и выпуск |
| `tests` | Native, SQL, HTTP и browser-проверки; не все запускаются командой `npm test` |
| `deploy`, `.github/workflows` | Примеры ingress и действующие workflows |
| `docs`, `tasks` | Контракты, решения и история этапов |

## Локальная установка

Установить Node.js 22 и зависимости из lockfile:

```bash
npm ci
```

Проектная `.npmrc` задаёт `ignore-scripts=true` и `install-links=true`. Явные `npm run` команды выполняются. Не включайте lifecycle scripts для всего графа зависимостей и не применяйте `npm audit fix --force`.

### Текущий изолированный PostgreSQL-стенд

Для полноценной проверки нового backend использовать [инструкцию локального стенда](docs/local-primary-stand.md). Нужны Docker с доступом к своему daemon, закреплённый в `scripts/local-primary-config.mjs` PostgreSQL image, OpenSSL и Node.js 22.

```bash
env __NEXT_PROCESSED_ENV=true NEXT_TELEMETRY_DISABLED=1 npm run build
node --experimental-strip-types scripts/local-primary.mjs --prepare
node --experimental-strip-types scripts/local-primary.mjs --start
```

Начальная страница: `https://127.0.0.1:3045/__local`. Стенд создаёт собственную БД, справочники и синтетические аккаунты; перехватывает письма и имитирует оплату. Он не использует production-данные. Локальная имитация не подтверждает работу настоящей ЮKassa. Настройки Telegram подключаются отдельно по [инструкции](docs/telegram-phone-setup.md).

Существующий стенд не мигрируется автоматически. После изменения приложения остановить только свой launcher, пересобрать сайт и запустить заново; две сборки в одном `.next` одновременно не выполнять.

### Быстрая работа с интерфейсом и старый стенд

`npm run dev` запускает Next.js на `http://localhost:3000`, но сам по себе не поднимает полноценный PostgreSQL/Auth/mail/media/payment контур.

`npm run dev:local` и `npm run supabase:local` относятся к прежнему Supabase-стенду. Не путать их с `scripts/local-primary.mjs` и не переносить его настройки в production.

## Проверки

Перед изменением кода прочитать [AGENTS.md](AGENTS.md) и [CONSTRAINTS.md](CONSTRAINTS.md).

```bash
npm run check:floor
npm run check:types
npm run lint
npm test
env __NEXT_PROCESSED_ENV=true NEXT_TELEMETRY_DISABLED=1 npm run build
npm audit --omit=dev --audit-level=high
npm audit
```

`npm run check:fast` объединяет floor, types и lint. Для native suite необходимы предусмотренные CI системные зависимости; OpenSSH regression требует `ssh`, `ssh-keygen`, `sshd` и подготовленный `/run/sshd`. Почтовый worker намеренно не запускается от root.

### Подтверждённый срез 29.10.2026

[Выпуск исходного коммита](https://github.com/Danil-super/blizhniy/actions/runs/40889791667) завершился успешно:

- native suite: **2107/2107**, без пропусков;
- types и lint: без ошибок, одно существующее lint-предупреждение `targetType` в тесте;
- production build: **72/72** страниц на этапе генерации, packaging и runtime smoke пройдены;
- Gitleaks, Semgrep, Trivy и CodeQL gates пройдены; успешный gate не означает отсутствие всех предупреждений;
- deploy, публичные layout/SEO/header postchecks и подтверждение выпуска пройдены;
- отдельная публичная проверка: **131/131 URL sitemap отвечают 200**, имеют canonical и один H1; health/ready возвращают 200.

Актуальный npm audit этого lockfile: **0** предупреждений в production-графе; **1 moderate** в полном графе для локального `postcss-selector-parser 6.1.4`. Проект содержит backport, поэтому предупреждение по версии нельзя автоматически считать доказанным эксплуатируемым HTTP-дефектом. Уже доступен [официальный совместимый 6.1.5](https://github.com/postcss/postcss-selector-parser/releases/tag/6.1.5): переход требует отдельной проверки и обновления provenance. [Advisory braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) отозван 23.10.2026; прежние цифры в [dependency-security.md](docs/dependency-security.md) являются историческими.

### Что проверяется отдельно

`npm test` запускает `*.test.mjs`, `*.test.cjs` и `scripts/test-*.mjs`. Настоящие `*integration*.mjs`, сценарии с PostgreSQL и многие браузерные тесты не входят в этот шаблон и пока не являются полным release gate.

```bash
npm run test:postgres:local
npm run test:payments:local
node --experimental-strip-types --test tests/bootstrap-postgres-integration.mjs
```

Эти команды требуют собственного изолированного Docker/PG стенда; они не должны направляться на рабочую БД. Матрицу дополнительных сценариев см. в `tests/`, [локальном стенде](docs/local-primary-stand.md) и [платёжных интеграционных проверках](docs/payment-lifecycle-integration.md). Ни native suite, ни SQL fixture не заменяют реальный sandbox E2E провайдера, проверку восстановления и нагрузку.

## Конфигурация

`.env.example` содержит имена переменных и исторические пояснения; это **не готовый production-конфиг**. Настройки основного backend проверяются fail-closed и не принимают произвольный адрес БД или legacy-учётные данные.

| Группа | Основные параметры / процедура |
|---|---|
| Адрес сайта | `NEXT_PUBLIC_SITE_URL`; production origin также строго проверяется серверными контрактами |
| PostgreSQL | `BLIZHNIY_DB_HOST/PORT/NAME/USER/PASSWORD`, `BLIZHNIY_DB_SSL_MODE=verify-full`, `BLIZHNIY_DB_CA_FILE` |
| Основной Auth | `BLIZHNIY_AUTH_MODE=postgres`, `BLIZHNIY_AUTH_ORIGIN`, `BLIZHNIY_AUTH_RATE_SECRET`, `BLIZHNIY_AUTH_MAIL_KEY_FILE` |
| Почта | `BLIZHNIY_MAIL_MODE=timeweb`, `BLIZHNIY_SMTP_USER/PASSWORD`; отдельно установленный outbox worker |
| CAPTCHA | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`; [доверенная ingress-граница](deploy/captcha-boundary.md) |
| Telegram | `BLIZHNIY_TELEGRAM_PHONE`, `BLIZHNIY_TELEGRAM_CLIENT_ID/CLIENT_SECRET/CALLBACK_URL`; [полный порядок](docs/telegram-phone-setup.md) |
| Публикации | `BLIZHNIY_LISTING_WORKFLOW`, отдельные режимы допуска и актуальные schema/grants |
| TEST checkout | `BLIZHNIY_LISTING_CHECKOUT=prepare-only`, `BLIZHNIY_PAYMENT_MODE=test`, shop/VAT; отдельный account-test opt-in |
| Медиа | Защищённая runtime-конфигурация, частный root, decoder socket и отдельные Unix-права; [инструкция](docs/production-media.md) |
| Legacy | `NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_PROVIDER` относятся к старому пути и не включают новый LIVE checkout |

Секреты и ключ шифрования писем хранятся вне Git, артефактов сборки и логов. Параметры клиента `NEXT_PUBLIC_*` нельзя использовать для паролей или закрытых ключей. Точные требования к origin, TLS, роли, файлам и флагам находятся в серверных config-модулях и профильных инструкциях.

### ЮKassa: разные маршруты и этапы

- Основной queued TEST webhook: `/api/payments/yookassa/primary-webhook`; допускается только при отдельно проверенной конфигурации `queued-test`.
- Legacy canonical webhook: `/api/payments/yookassa/webhook`, compatibility route `/api/webhooks/yookassa`. Наличие этих маршрутов не означает готовый новый LIVE-контур.
- [Account TEST checkout](docs/account-test-checkout.md) разрешает отправку только выбранному аккаунту. Его verifier подтверждает TEST-статус, но **не публикует объявления за тестовые деньги**.
- Очередь, reconciliation и fulfillment имеют отдельные роли и режимы. Не включать режимы одновременно только потому, что все модули присутствуют в репозитории.
- Возвраты, продления, остальные услуги, фискализация и полный LIVE admission требуют завершения и приёмки. Значение `PAYMENT_PROVIDER=yookassa` само по себе этого не делает.

## База данных и миграции

Основная схема находится в `database/migrations/` (`0001`-`0032`). Применение миграций и grants - явные операторские процедуры; приложение и web deploy не мигрируют БД при запуске.

Перед изменением проверяются точная цель, журнал и SHA256 исходников, роли/ACL, резервная копия, совместимость приложения и workers. Старые baseline-файлы `supabase/schema.sql`, `seed.sql` и `rls.sql` не воспроизводят текущую основную БД. Базовый план bootstrap также не равен всей современной схеме; нужный проверенный suffix выбирается отдельно.

Подробности: [PostgreSQL backend](docs/postgresql-backend.md), [решение о двух серверах](docs/decisions/0001-two-server-postgresql.md), [staging](docs/postgresql-staging.md), [жизненный цикл публикации](docs/listing-publication-check.md). Записи «применено на такую-то дату» в этих документах не заменяют свежую проверку рабочего migration journal.

## Деплой и эксплуатация

Действующая схема:

1. PR в `main` проходит обязательные Validate app, Security checks, Review dependency changes и CodeQL; обход защиты main не предусмотрен.
2. Push после merge запускает [Deploy to VPS](.github/workflows/deploy.yml). CI собирает standalone-артефакт, привязывает BUILD_ID к commit, проверяет inventory/hash и runtime.
3. VPS получает готовый архив по SSH с закреплённым host key. Секреты не включаются в артефакт и подключаются на сервере отдельно.
4. Installer создаёт release, переключает PM2 и проверяет health/readiness. Затем выполняются публичные browser/SEO/header postchecks.
5. Watchdog ожидает подтверждение; при ошибке или отсутствии подтверждения предусмотрен возврат к предыдущему release.

**Это переключение одного PM2 fork process, а не zero-downtime:** новый процесс стартует после остановки прежнего, поэтому возможен короткий перерыв. Сам rollback пока проверяет liveness; проверку готовности БД и прикладных функций нужно усилить.

Для workflow используются `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `APP_DIR`. TLS/ingress проверяются по фактической установке; в репозитории есть [Caddy example](deploy/Caddyfile.example), [nginx example](deploy/nginx.conf.example), [SSH trust](deploy/SSH_HOST_TRUST.md) и TLS workflow. Эти примеры не доказывают текущую полную конфигурацию VPS.

Web deploy не заменяет установку mail/payment/media workers, настройку резервирования, мониторинга и миграций. Worker не должен зависеть от release, который удалит очистка старых web-версий. `/api/health` проверяет liveness; `/api/ready` - часть PostgreSQL/Auth-контура, а не SMTP, медиа, все 32 миграции и полный платёжный сценарий.

## Порядок допуска к коммерческому запуску

1. Закрыть подтверждённые дефекты аккаунта, доступности и жизненного цикла данных.
2. Завершить каждый платный сценарий, возвраты и восстановление после неопределённого результата; пройти sandbox E2E ЮKassa и реальное подтверждение Telegram/почты на выделенных тестовых аккаунтах.
3. Сделать обязательными чистую установку схемы, реальные SQL/ACL/concurrency проверки и сквозной сценарий двух независимых пользователей.
4. Восстановить PostgreSQL и файлы на отдельной цели, измерить RPO/RTO, проверить алерты, workers, перезапуск сервера и откат.
5. Выполнить нагрузочные, мобильные и accessibility проверки, затем наблюдаемую ограниченную бету.

Целевые показатели из CONSTRAINTS (нагрузка, Core Web Vitals, доступность, RPO/RTO) остаются целями до воспроизводимого подтверждения. Успешный деплой или большое число тестов не переводят сайт автоматически в состояние готовности к массовому запуску.
