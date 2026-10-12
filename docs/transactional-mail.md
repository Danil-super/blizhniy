# Транзакционная почта Timeweb

## Статус

SMTP-адаптер, операторская проверка, зашифрованный outbox и серверная логика доставки реализованы. Регистрация и восстановление пока не используют этот адаптер: локальный capture-контур и действующая авторизация не переключены. Подключение producer/worker, его процесс и production-safe HTTP-граница — следующие инкременты L05–L07, не завершённая функциональность.

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

Следующий этап: атомарно подключать новую регистрацию/recovery, затем production-safe HTTP/формы, назначать минимальные runtime grants, устанавливать ключ и включать worker с расписанием cleanup и sanitized метриками/оповещением backlog/failed/unknown. Не снимать local-only guards, выдавая это за production Auth. Не считать смену подключения PostgreSQL завершением переноса всех API.

## Официальные источники

- [Timeweb Cloud: SMTP-параметры](https://timeweb.cloud/docs/mail/email-clients-configuration).
- [Nodemailer: SMTP/TLS, таймауты, verify и ограничения источников](https://nodemailer.com/smtp).
- [Nodemailer: поля сообщения](https://nodemailer.com/message).
- [Node22: authenticated cipher/AAD](https://nodejs.org/docs/latest-v22.x/api/crypto.html#ciphersetaadbuffer-options).
- [PostgreSQL18: ограничения таблиц](https://www.postgresql.org/docs/18/ddl-constraints.html).
- [PostgreSQL18: SKIP LOCKED и блокировки очереди](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE).
