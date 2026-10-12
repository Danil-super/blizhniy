# Транзакционная почта Timeweb

## Статус

SMTP-адаптер, зашифрованный outbox, delivery engine и атомарные Auth producers реализованы. Отдельная production-safe HTTP-фабрика подключена к `/api/account/[action]` только при явном `BLIZHNIY_AUTH_MODE=postgres`; она передаёт cipher в stores. Формы входа, регистрации, подтверждения и восстановления также готовы под этим opt-in. На рабочем VPS этот режим **не включён**: кабинет/общие guards, минимальные роли, миграции0008/0009, ключ и worker-процесс ещё требуют подключения. Локальный capture-контур и действующая авторизация не переключены.

## Первичные страницы аккаунта

- `/auth` — вход, проверка сессии, смена аккаунта и выход; `/auth/register` — регистрация и password-gated повторное письмо; `/auth/confirm` — явное подтверждение; `/auth/recover` и `/auth/reset` — восстановление и новый пароль.
- Новые страницы доступны только при серверном `postgres` opt-in. Ошибка конфигурации показывает общий отказ, не старую форму. В клиентские props не передаются rate secret, SMTP/DB credentials, путь или содержимое ключа.
- Сессия идёт через same-origin JSON POST и host HttpOnly cookie: browser adapter не получает, не читает и не сохраняет токен. Неизвестный результат входа/выхода убирает прежнюю личность и требует проверки. Вкладки получают только сигнал инвалидирования, не email/роль/credentials.
- Подтверждение/reset читают только fragment и сразу убирают его из текущего URL; GET ничего не меняет, нужна кнопка/отправка формы. Все auth-страницы имеют `no-referrer`; query-only token не принимается. Поздний ответ для предыдущей reset-ссылки не подтверждает новую.
- Рабочие формы требуют настоящий CAPTCHA provider, без quiet fallback. CAPTCHA заново запрашивается после попытки; expiry/error/удаление widget не сохраняют готовность. Компактный размер не растягивает мобильную форму. Callback-контракт сверён с [официальной документацией Turnstile](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/). Переход на Яндекс по поручению владельца отложен; эти формы не отключают существующий server-side CAPTCHA.
- Визуальный контракт: существующие brand/tailwind tokens и компактная карточка аккаунта, один h1, видимые labels/documents, focusable alert, loading/success/error, кнопки с min-height44 и без горизонтальной прокрутки на 320/768/1024/1440. Это проверка данного UI, не доказательство доступности/производительности всего сайта.

Проверки UI: native1099/1099; существующая PostgreSQL/HTTPS/Chromium регрессия116/116; production build успешна (57 статических страниц + динамические маршруты). `tests/production-account-browser.mjs` — ещё7/7 проверок реальных production-компонентов с изолированными API/CAPTCHA transport fixtures: exact payloads, explicit confirm, cross-tab logout, неизвестный commit, expiry, stale reset response, no-referrer и axe main-region (без нарушений на 320/1440). Этот тест **не** доказывает новый public HTTPS backend, реальные cookie между сервером/браузером, настоящую CAPTCHA/SMTP-доставку или права Timeweb.

Для повторения UI-проверки сначала собрать приложение с `NEXT_PUBLIC_TURNSTILE_SITE_KEY=public-browser-fixture-key`, `NEXT_PUBLIC_SUPABASE_URL=''`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=''`, затем на Node22 выполнить `node --experimental-strip-types --test tests/production-account-browser.mjs`. Fixture запускает свой Next process на loopback, не использует production DB/mail key и блокирует внешние browser requests. Тестовую сборку не публиковать: CI собирает release со штатной конфигурацией. До включения opt-in остаётся перенос общего `useAuthState`/server authorization и данных кабинета; идентификаторы нового PG Auth нельзя смешивать с legacy mutations.

12.10.2026 новый модуль проверен на VPS через Node22.23.3: TLS/authentication успешны; SMTP принял одно техническое письмо на собственный ящик notifications. Владелец затем подтвердил доставку этого письма в интерфейсе почты. Сообщение не содержит пользовательских данных или одноразовых токенов. Проверка SMTP не переключала production-процесс, его environment или схему БД.

## Контракт

- `src/lib/timeweb-mail.ts` — только серверный код; disabled-by-default, без dotenv/legacy fallback.
- Режим `BLIZHNIY_MAIL_MODE=timeweb`, логин `BLIZHNIY_SMTP_USER` и пароль `BLIZHNIY_SMTP_PASSWORD` задаются явно. При отсутствии всех трёх переменных модуль отключён; частичная/неправильная настройка отказана.
- Разрешён только уже выбранный ящик `notifications@ближний-ру.рф`. Логин и SMTP-envelope используют ASCII/Punycode-домен; пароль сохраняется побайтово, включая обратную косую черту и пробелы.
- Endpoint фиксирован: `smtp.timeweb.ru:465`, implicit TLS, проверка сертификата/имени, минимум TLS1.2. Connection/greeting/DNS timeout 5 секунд, idle socket timeout 15 секунд. Небезопасный ambient `NODE_TLS_REJECT_UNAUTHORIZED=0` отказан.
- Письмо — ровно один адрес, UUID намерения, ограниченные subject/text; без подмены from, произвольных заголовков, вложений, чтения файлов или URL. CRLF в адресе/subject отказаны. Кириллический текст кодирует Nodemailer.
- TLS/auth проверить можно без отправки. `send()` означает принятие SMTP-сервером, а не доставку получателю. Каждый вызов делает одну попытку. Стабильный Message-ID **не** обеспечивает exactly-once: сервер может принять письмо до потери ответа.
- Ошибки наружу: `AUTH_FAILED`, `TEMPORARY`, `REJECTED`, `UNKNOWN`; без raw SMTP response, адресов, тела, токенов, пароля или exception cause. Unknown нельзя считать доказанным отказом доставки.

## Хранение и проверка конфигурации

Секреты находятся вне Git. На VPS подготовлен `/etc/blizhniy/staging/smtp.json` (root, 0600) под каталогом 0700. Это конфигурация отдельной проверки, **не** активное окружение сайта. Перед будущим worker нужны явно назначенная непривилегированная runtime-учётная запись и минимальный доступ к её конфигурации.

Формат JSON — ровно три строковых ключа:

```json
{
  "BLIZHNIY_MAIL_MODE": "timeweb",
  "BLIZHNIY_SMTP_USER": "notifications@xn----9sbphbgks4a4a.xn--p1ai",
  "BLIZHNIY_SMTP_PASSWORD": "<пароль из защищённого канала>"
}
```

Диагностика из корня проекта на Node22, без отправки:

```sh
node --experimental-strip-types scripts/check-timeweb-mail.mjs /etc/blizhniy/staging/smtp.json
```

CLI принимает только абсолютный путь, проверяет regular file/владельца/0600, не следует final symlink и читает максимум 4097 байт с отказом при >4096. Не переносит содержимое JSON в process.env. Успех: `{"smtp":"authenticated","messageSent":false}`; ошибка — только обезличенный код. На VPS диагностическая копия расположена в существующем `/var/www/blizhniy-prebuilt-rehearsal`, отдельно от активного релиза.

## Проверки и оставшиеся границы

33 focused-теста: opt-in/config, IDN, injection/URL-shaped адреса, границы длины, запрещённые вложения, безопасные ошибки, ambiguous acceptance, отсутствие retries, real MIME и private config loader. RED→GREEN; временное отключение TLS certificate validation обнаружено тестом и отменено. Native1063/1063, сборка58 страниц, types после сборки успешны; lint0 errors/одно прежнее предупреждение. Clean frozen `npm ci --ignore-scripts` успешен; установка не запускает dependency lifecycle scripts (существующая `.npmrc` также задаёт ignore-scripts). Nodemailer10.1.0 закреплён lockfile; новых транзитивных runtime dependencies нет. `npm audit signatures`: 402 package registry signatures и 70 attestations подтверждены. Production-only advisory audit0; отдельные прежние build/dev риски и CI scanners не считаются закрытыми этим результатом.

## Основа постоянной очереди

`src/lib/mail-outbox.ts` и аддитивная миграция `0008-mail-outbox.sql` предоставляют storage foundation, не работающий delivery worker. Миграция пока **не включена** в автоматический bootstrap manifest и не применена на российской БД. Тестовый harness применяет её только в собственной disposable PostgreSQL18.6.

- AES-256-GCM, случайный nonce12 bytes, tag16 bytes, версия формата. Ключ — отдельный случайный Buffer32 bytes вне БД/Git; SMTP-пароль не используется как ключ. В этом этапе реальный ключ ещё не создавался и не устанавливался.
- В payload зашифрованы только адрес и одноразовый токен; цель/UUID/пользователь/даты/ID ключа остаются метаданными. ID пользователя тоже является связанными с аккаунтом данными; он не публикуется. После проверки tag полученные JSON-поля повторно валидируются.
- AAD связывает ciphertext с ID задания, пользователем, purpose, createdAt/expiresAt и ID ключа. `open()` обязательно получает сохранённый `key_id`; неверный/пропущенный ID отказан. SQL `timestamptz(3)` не допускает скрытой от JS микросекундной части.
- Сроки: confirm≤1h, recover≤30m, reset_notice≤24h. Producer обязан копировать реальный срок исходного токена, а не назначать новый TTL. Изменение срока или другого защищённого поля нарушает authentication.
- `enqueueAuthMail()` вызывается на query-interface **транзакции бизнес-операции**. Сам helper не открывает транзакцию и не делает retry. Повтор UUID — конфликт, не silent adoption. Сохранение только очереди без бизнес-транзакции не считается готовой регистрацией.
- FK пользователя с CASCADE удаляет его queued payload. `pruneExpiredMail()` удаляет только истёкшие задания, максимум1000 за вызов, пропуская блокировки. Расписание очистки ещё не включено. Down под эксклюзивной блокировкой отказывается удалять непустую очередь.

Проверено: 6 native focused-тестов плюс 6 новых реальных PG-сценариев; общий native1069/1069, PG+HTTP+browser102/102, build58, types/lint0 errors (одно прежнее warning), production audit0. Временная инверсия проверки key_id обнаружена тестами и отменена. Независимый review выявил и позволил исправить timestamp precision/key_id/invalid Punycode; финальный review не нашёл оставшихся существенных нарушений этого ограниченного контракта. Внешняя CLI-проверка пропущена по выбору владельца.

## Доставка и восстановление после сбоя

`src/lib/mail-delivery.ts` и миграция `0009-mail-delivery.sql` добавляют состояние доставки. Миграции0008/0009 не включены в bootstrap и не применены на удалённой БД. Нет активного worker-процесса или отправки при импорте.

- `claim()` резервирует ровно одно готовое неистёкшее задание через `FOR UPDATE SKIP LOCKED`; lease60 секунд и новый UUID владельца. Конкурирующие процессы не забирают один job одновременно.
- `prepare()` блокирует пользователя прежде задания/source token. Расшифровка аутентифицирует routing context; перед dispatch проверяются email, текущая auth_version, SHA-256 исходного токена, его точный миллисекундный срок и состояние аккаунта. Подтверждение блокированного/уже подтверждённого аккаунта отменяется; recovery блокированного подтверждённого владельца разрешён без снятия блокировки, как в существующем recovery-контракте.
- Истечение срока проверяется после ожидания блокировок и ещё раз непосредственно при переходе в `sending`. Устаревшие/потреблённые/заменённые ссылки становятся `cancelled`; повреждённый payload/ошибка trusted renderer — `failed`, без SMTP. Транзакция dispatch коммитится **до** отправки; сетевой вызов не держит SQL locks.
- `runOne()` выполняет одну попытку через уже существующий SMTP-адаптер. Renderer — явно переданная синхронная функция приложения, не URL/шаблон из задания; готовые production confirmation/reset страницы пока не подключены. Результат содержит только id/state, не адрес, токен, тело или raw exception. `accepted` означает SMTP acceptance, не inbox delivery.
- Только явный SMTP4xx (`TEMPORARY`) повторяется: задержки60/120/240/480 секунд, максимум5 попыток. Auth/permanent failure — `failed`; неизвестный результат — `unknown` без автоматического resend. Очередь не продлевает source expiry; job с retry за пределами срока больше не отправляется.
- `recoverAbandoned()` обрабатывает максимум1000 строк с пропуском locks. Истёкшая **резервация до dispatch** возвращается в `ready`; сбой после перехода в **sending** становится `unknown`. Старый claim UUID не может отправить или подтвердить задание после передачи другому владельцу. Down0009 под эксклюзивной блокировкой отказывается удалить состояние непустой очереди.

Граница гарантии: уже начатое письмо нельзя отозвать, если resend/reset/смена адреса произошли после dispatch. Приостановленный процесс также может возобновить начатую попытку позже; lease — механизм восстановления/fencing записи, не отмена сети. Ссылка всё равно проверяется заново при использовании и не должна авторизовать после отзыва/expiry. Exactly-once SMTP не обещается. Неизвестный исход требует наблюдения/нового пользовательского намерения, а не сброса state в ready вручную.

Проверено12.10.2026: native1072/1072 и isolated PostgreSQL+HTTP+Chromium110/110, без пропусков. Реальные SQL-сценарии: конкуренция, restart/backoff, stale-owner fencing, потеря worker до/после dispatch, source binding/corruption, expiry под user/token lock, budget5 и renderer faults. Временная инверсия SMTP retry policy обнаружена тестом и отменена. Сборку запускать отдельно от PG integration: его Next dev также изменяет `.next`.

## Атомарные Auth producers

`RegistrationStore(db, cipher)` и `PasswordRecoveryStore(db, cipher)` включают durable enqueue явно. Вызов без cipher сохраняет прежний локальный capture-контракт и не обращается к таблице outbox. HTTP responses не менялись; внутренние email/token receipt нельзя отдавать публичным JSON или логировать.

Регистрация и password-gated resend создают confirmation job на **том же tx**, что пользователь/документы/исходный token hash. Дубликат signup — no-op без письма. Recovery request сохраняет source hash и job атомарно; reset сохраняет смену пароля, отзыв сессий и `reset_notice` в одной транзакции. Недоступность SMTP не откатывает эти операции: сетевой вызов отделён worker-очередью; ошибка именно записи outbox откатывает все бизнес-изменения.

Confirmation/recovery TTL копируется из созданной source строки, не вычисляется заново при enqueue/retry. Обычный pg decoder отбрасывает долю миллисекунды source timestamp; это может сократить срок менее чем на1 мс, но не продлить его. Notice получает время БД и TTL24 часа; токена в нём нет. После resend прежний ещё не отправленный job отменяется worker preflight, а не доставляется со старым токеном.

Проверено: native1075/1075, PostgreSQL+HTTP+Chromium113/113 без пропусков; signup/resend → queue → тестовый транспорт → одноразовое подтверждение → настоящий password login. Queue fault injection на реальном PG доказал полный rollback signup/resend/recovery/reset: старые tokens, password/auth_version, документы и сессии сохранены. Normal reset отзывает сессии и создаёт только одно notice. Транспорт в этих сценариях **тестовый**, а не доказательство отправки настоящего registration email через Timeweb. RED→GREEN и временное удаление enqueue обнаружено тестом, изменение отменено. Новых зависимостей нет.

## Рабочая HTTP-граница Auth

- `production-auth-config.ts` допускает только production, точный HTTPS origin сайта, согласованный Timeweb host/default_db, `blizhniy_runtime`, verify-full и явные mail/CAPTCHA/rate/key settings. Local capture, PG* overrides, другой host/DB/owner-role и отключение TLS отказаны. Этот config содержит server-only secret: не передавать его клиентским компонентам.
- Ключ читается из owned0600 regular32-byte файла под owned0700 каталогом; no-follow, bounded33-byte read. После копирования в `KeyObject` рабочий buffer обнуляется; rate secret нельзя использовать как ключ очереди. Новый production renderer создаёт фиксированные `/auth/confirm#token=…` и `/auth/reset#token=…`, не URL из запроса и не query token. Эти страницы ещё не подключены — worker не включать раньше UI.
- `production-account-http.ts` сохраняет строгие Origin/Host/custom-header/Fetch-Site/JSON/4096-byte/deadline guards. Закрытый action/input allowlist; SMTP-compatible email нормализуется в lower ASCII/Punycode **до** БД и CAPTCHA. Business stores не получают captchaToken. Все credentials/register/resend/recover/reset требуют успешную CAPTCHA; confirm требует одноразовый token и явный POST, не GET. Logout не блокируется credential quota; некорректные cookie/Bearer не являются авторизацией.
- Shared PG budgets имеют отдельный `production:*` namespace: credential600 global/20 IP/5 email за фиксированные15 минут; session2000 global/300 IP. Это консервативные начальные ограничения, не измеренная launch-capacity. IP берётся только из canonical `X-Real-IP` за проверенным ingress, не CF/XFF. Существующий local limiter60/5 не ослаблен. Перед включением проверить Caddy overwrite и bind Next на127.0.0.1.
- Cookie только host-only `__Host-blizhniy_session`, HttpOnly/Secure/SameSite=Lax/Path=/, максимум остатка8 часов. Login/session DTO не содержит password hash или session token. Confirm/reset не создают сессию. Ответы без кэширования; sanitized events содержат operation/status/duration/requestId/code, не email/IP/body/token/exception.
- `production-auth-runtime.ts` создаёт один lazy pool/cipher. Перед первой бизнес-записью проверяет имя роли, отсутствие super/create-role/create-db/replication/bypass-RLS, CREATE на app/public/БД, TEMP и UPDATE роли пользователя; проверяет delivery schema/read grants. Ошибка startup закрывает pool и остаётся отказом до restart, без перехода на owner/legacy credentials. Импорт/invalid request не открывают pool, не читают ключ, не отправляют SMTP и не применяют миграции.
- Recovery в новом контуре коммитится **до**202, не запускает volatile background work. Existing/missing/pending email имеют одинаковое тело ответа; абсолютная неразличимость timing под DB contention не заявляется. Ошибка queue/commit — generic unavailable, не основание для автоматического destructive retry. Прежний local async capture contract сохранён.

Проверки12.10.2026: native1092/1092, isolated PG/HTTP/Chromium116/116, build58, types/lint без ошибок (одно прежнее lint warning). Новые production-style Request+PG сценарии проверяют signup/queue/confirmation/cookie/session/logout/recovery/reset и shared limiter; CAPTCHA/SMTP в них тестовые, реальный внешний provider и привилегии Timeweb runtime ими не подтверждены. Отдельные runtime unit probes отказали elevated/wrong roles/missing schema и проверили lazy singleton/key zeroing. Инверсия CAPTCHA guard обнаружена4 тестами и отменена. Code Graph дал неполный backend impact, поэтому реальные consumers сверены исходниками, а не объявлены изолированными.

Следующий этап: формы и cookie-aware кабинет/guards, затем минимальные runtime grants, bootstrap миграций0008/0009, защищённая runtime-конфигурация и worker-процесс с cleanup/метриками/оповещением backlog/failed/unknown. Только после настоящего доменного signup→mail→confirm→login→logout→reset включать рабочий Auth. Не снимать local-only guards и не считать один новый account endpoint завершением переноса остальных API/Supabase consumers.

## Официальные источники

- [Timeweb Cloud: SMTP-параметры](https://timeweb.cloud/docs/mail/email-clients-configuration).
- [Nodemailer: SMTP/TLS, таймауты, verify и ограничения источников](https://nodemailer.com/smtp).
- [Nodemailer: поля сообщения](https://nodemailer.com/message).
- [Node22: authenticated cipher/AAD](https://nodejs.org/docs/latest-v22.x/api/crypto.html#ciphersetaadbuffer-options).
- [PostgreSQL18: ограничения таблиц](https://www.postgresql.org/docs/18/ddl-constraints.html).
- [PostgreSQL18: SKIP LOCKED и блокировки очереди](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE).
