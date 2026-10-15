# Черновики объявлений: приватное создание, список и редактор

Слой L10 использует `app.listings` из миграции0012 и существующий `withAppSessionTransaction`. Реализованы стабильное пустое создание, ограниченный список, чтение/изменение и отдельный приватный редактор `/cabinet/chernoviki`. Новые runtime grants на рабочей БД не применены; активный backend сайта не переключён. Это сохранение текста/цены, не законченная публикация с фотографиями. Все прежние функции и формы остаются в объёме запуска.

## Контракт

`ListingDraftInput` содержит только `kind`, `title`, `description`, nullable `categoryId`/`cityId` и nullable `price`. `kind` — существующие четыре ListingKind. Ожидаемые IDs — UUID новой БД, не названия или static IDs; отсутствующий FK даёт ListingDraftInputError. На этом шаге draft допускает неактивную, но существующую категорию: активность и полнота проверяются будущим переходом к публикации, не при сохранении незаполненного черновика.

Частичный новый draft имеет пустые title/description и null references/price. Цена — точная неотрицательная RUB decimal **строка**, нормализуемая до двух знаков без Number/округления; zero допустим, max9999999999.99. Scientific/comma/negative/NaN/лишние дробные знаки запрещены. Title≤160 UTF-16 units, description≤10000; title trim, описание сохраняет переносы/TAB/CR, недопустимые controls/непарные суррогаты отвергаются. Только plain/null-prototype объекты и шесть известных полей.

```typescript
const created = await store.createEmpty(token, expectedOwnerId, creationKey);
const saved = await store.read(token, expectedOwnerId, created.id);
const updated = await store.update(token, expectedOwnerId, saved.id, saved.revision,
  { ...saved.draft, title: "Новое название" });
```

`create` генерирует UUID на сервере; paid=false/status=draft и даты — defaults БД, не request fields. `update` заменяет **core**, не делает PATCH: отсутствующие core поля возвращаются к draft defaults. Фото, booking, contacts, точная география и прочие колонки не входят в этот контракт, не записываются/не очищаются и не выдаются. Для них нужны следующие контракты/проверки; это не решение убрать их из интерфейса.

Ответ только `{id,revision,draft}`. Нет author ID, оплаты, статусных дат или SELECT *; это owner-private DTO, не публичная проекция объявления. Произвольные status/paid/owner/media поля отклоняются, а не молча игнорируются. Текст остаётся untrusted content: будущая UI должна использовать обычное escaping, не raw HTML.

## Доступ и конкуренция

В каждой операции настоящая identity берётся из App-сессии и сравнивается с expectedOwnerId. Порядок lock: user → session → owned draft row при update. Blocked/unverified/expired/idle/revoked/stale-auth-version/data-subject denied; admin не обходит ownership. Несуществующий, чужой и не-draft ID дают одинаковый ListingDraftAccessError. Базовый AppSessionAccessError и неизвестные SQL/COMMIT failures не превращаются в пустой draft или fallback.

Update требует canonical positive bigint **строку**, не Date/JS Number. Под row lock сравнивается текущая revision; UPDATE дополнительно ограничен ID+author+draft+revision и повышает revision на1 в SQL. При конфликте или bigint-max — ListingDraftConflictError, без повторного сохранения. Повторная финальная проверка сессии выполняется перед commit; expiry после реального INSERT/UPDATE откатывает запись. Даты не используются как concurrency token. SQL locks/integer semantics: [PostgreSQL18 locking](https://www.postgresql.org/docs/18/explicit-locking.html), [read-committed updates](https://www.postgresql.org/docs/18/transaction-iso.html).

Прежний внутренний `create(input)` **не идемпотентен и небезопасен для retry**, по HTTP не выставлен. Для нового HTTP используется только `createEmpty`: UUID операции создаётся один раз в браузере, сервер выводит owner-scoped UUIDv8 из первых16 bytes SHA256 точной строки `blizhniy-listing-creation:v1\0${user.id}\0${canonicalCreationKey}`, выставляя UUID version8/variant10. Namespace/алгоритм нельзя менять без совместимости с незавершёнными операциями. UUID не является правом доступа. [RFC9562 UUIDv8](https://www.rfc-editor.org/rfc/rfc9562.html#section-5.8).

Создание не принимает редактируемый payload: только owner и creationKey. `INSERT ... ON CONFLICT(id) DO NOTHING` либо создаёт пустой draft, либо читает уже существующий **с тем же owner и status=draft**, не изменяя его текст/revision. Поэтому потерянный ответ можно явно проверить тем же intent, не стирая последующие правки и не создавая второй объект. Не-draft повтор не восстанавливает; чужая identity не раскрывает объект. Future physical-delete workflow должен сохранить tombstone/зарезервированный ID для ещё действующего owner, иначе retry сможет создать удалённый объект заново. Сейчас delete API отсутствует; удаление аккаунта отзывает сессии. [PostgreSQL18 INSERT/ON CONFLICT](https://www.postgresql.org/docs/18/sql-insert.html).

Owner list выдаёт максимум20 narrow summaries `{id,revision,kind,title,price}`, запрашивая21 строку для признака продолжения. Cursor `{id,updatedAt}` хранит SQL UTC timestamp с шестью дробными знаками, без усечения через JS Date. Сортировка/граница `(updated_at DESC,id DESC)` соответствуют существующему индексу. Нет description/контактов/чужих owners/total count. Страницы не являются неподвижным snapshot: изменение draft может переместить его между запросами.

## HTTP существующего черновика

`/api/account/listing-drafts` включён только в явном postgres-mode; вне него POST/PUT возвращают404 без вызова runtime. POST **читает**, не создаёт: JSON `{expectedOwnerId,listingId}`. PUT заменяет core: `{expectedOwnerId,listingId,expectedRevision,draft}`. Ответ200 — тот же `{id,revision,draft}`. Не PATCH: клиент отправляет полный сохранённый core; пропущенные core поля получают draft defaults, non-core поля не затрагиваются.

Авторитет — единственная каноническая HttpOnly cookie, не body/Bearer. Host/Origin/X-Blizhniy-Request/Sec-Fetch-Site проверяются общим `readAuthJson`; query string запрещён. Требуются JSON и trusted X-Real-IP, не CF/XFF. Чтение ограничено4096 bytes, PUT65536 bytes, включая streamed body; deadline2s. Используется существующий shared session-rate budget PostgreSQL без изменения лимитов. Ресурс использует проверенный Auth pool и SELECT limit0 preflight: отсутствующие schema/grants дают отказ, не auto-provision/fallback. Этот preflight **не полный privilege verifier**, отдельный provisioner/grant audit остаётся необходимым.

Ошибки — `{error:{code}}`:401 UNAUTHENTICATED;404 DRAFT_NOT_FOUND одинаково для чужого/неизвестного/non-draft ID и stale expectedOwnerId;409 DRAFT_CHANGED;422 INVALID_INPUT;429 RATE_LIMITED с Retry-After900;503 DRAFT_UNAVAILABLE при dependency/SQL/неизвестном COMMIT исходе. Имеются общие boundary400/403/405/408/413/415. Ответы no-store/no-referrer/nosniff/CSP и request ID; audit содержит только operation/status/code/duration/request ID, без identity, draft ID, текста и причин SQL. GET405 с Allow POST,PUT; нет GET/public/create/list/delete или права менять billing/status.

PUT не повторять автоматически после409/503/network loss: сохранить локальный текст, явно прочитать существующий ID и сверить revision/content.503 не доказывает rollback. Cookie от другой identity не открывает прежний draft.

## HTTP коллекции и экран черновиков

`/api/account/listing-drafts/collection`: POST `{expectedOwnerId,cursor}` читает страницу; PUT `{expectedOwnerId,creationKey}` создаёт/сверяет пустой ресурс. Обе операции ограничены4096 bytes и используют те же guards/лимитер/безопасные ответы и metadata-only audit. Признак collection задаётся только кодом Next route, не запросом. Нет schema migration, новых dependencies, auto-retry, bearer authority или legacy fallback.

`/cabinet/chernoviki` доступен только explicit postgres-mode; вне него404, robots noindex/nofollow. Создание, список, открытие, тип/название/описание/точная цена и сохранение используют только cookie API. Category/city и остальные core поля из прочитанной версии сохраняются, non-core не затрагиваются. При конфликте/неизвестном исходе текст остаётся, повторное сохранение блокируется до readback и явного выбора сохранённой версии либо продолжения своих правок на новой revision. Ошибка создания сохраняет intent в памяти до явной проверки. Перезагрузка браузера не является durable offline storage: beforeunload/переход по ссылке предупреждают об утрате несохранённого/неподтверждённого состояния; при разрешённом уходе отправленная операция не отменяется.

Owner-keyed workspace скрывает приватный DOM при временной перепроверке сессии, сохраняя локальный буфер только для той же подтверждённой identity. Подтверждённый выход/новая identity уничтожают прежний workspace; поздний ответ не переносится в новый. Текст рендерится React escaping, не HTML. Это отдельный подготовленный экран, не замена действующих форм и не полная готовность L10.

## Проверка и границы готовности

Native contract/denial tests импортируют реальный parser/store/guard; подменяют только SQL в коротких denial fixtures. Owned PostgreSQL18.6 integration даёт минимальные column grants **только в локальной одноразовой БД** и проверяет настоящий storage/CAS/rollback/deny. Два аккаунта и admin синтетические, sessions выдаёт fixture; это не live signup/SMTP/CAPTCHA или браузерный сценарий. Отдельно проверяются неизвестные FK, non-draft, строковые версии выше JS precision, bigint-max, новые pool/store, unexposed fields и simulated post-commit acknowledgement loss без второго create.

HTTP native tests используют настоящий Request/JSON/cookie/ingress/parser/handler; подменяют resource dependency только для ingress/error веток. Тест actual Next route проверяет mode gate/delegation. Отдельные локальные PG тесты соединяют настоящий HTTP handler, cookie guard, shared limiter и ограниченную SQL роль: read/update, чужой/admin/unknown/stale account, stale revision/revoked session и simulated lost acknowledgement с одним сохранением/readback. Это не сетевой Next/browser/живой доменный сценарий.

`tests/production-account-browser.mjs` запускает настоящий production Next build и Chromium с изолированными synthetic account/draft transports: создание/сохранение, неизвестный create/write, конфликт двух вкладок, late response после смены владельца, сохранение буфера при recheck, явный auth retry, keyboard и мобильные размеры/axe. Эти fixtures не доказывают live signup или сетевое browser→Next→рабочая PG. SQL границы отдельно проверяет `tests/listing-drafts-integration.mjs`, включая concurrent replay и45 строк с microsecond/UUID ties. Native golden UUID фиксирует совместимость creation namespace, cursor mutation должна ломать native тест.

Локальная durable проверка означает чтение из нового пула после закрытия прежнего, не массовый restart/failover тест. Changed-line coverage/нагрузочный p95 этим не измерены. Нет новых migrations/dependencies, изменений shared Auth guard, публичных запросов или remote grants. Перед включением требуется отдельная установка/проверка column privileges (включая INSERT(id) и SELECT(updated_at)); LIMIT0 не заменяет полного grant audit. L10 целиком остаётся открытым: media/контакты, полная существующая форма, публикация/модерация, публичный поиск и payment lifecycle ещё не подключены.
