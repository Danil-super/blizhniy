# Черновики объявлений: серверное ядро

Слой L10 использует `app.listings` из миграции0012 и существующий `withAppSessionTransaction`. Реализованы create/read/update repository и HTTP чтения/изменения существующего черновика. **Создание через HTTP и форма ещё не подключены**. Новые runtime grants на рабочей БД не применены; активный backend сайта не переключён. Все прежние функции остаются в объёме запуска.

## Контракт

`ListingDraftInput` содержит только `kind`, `title`, `description`, nullable `categoryId`/`cityId` и nullable `price`. `kind` — существующие четыре ListingKind. Ожидаемые IDs — UUID новой БД, не названия или static IDs; отсутствующий FK даёт ListingDraftInputError. На этом шаге draft допускает неактивную, но существующую категорию: активность и полнота проверяются будущим переходом к публикации, не при сохранении незаполненного черновика.

Частичный новый draft имеет пустые title/description и null references/price. Цена — точная неотрицательная RUB decimal **строка**, нормализуемая до двух знаков без Number/округления; zero допустим, max9999999999.99. Scientific/comma/negative/NaN/лишние дробные знаки запрещены. Title≤160 UTF-16 units, description≤10000; title trim, описание сохраняет переносы/TAB/CR, недопустимые controls/непарные суррогаты отвергаются. Только plain/null-prototype объекты и шесть известных полей.

```typescript
const created = await store.create(token, expectedOwnerId, { kind: "prodam" });
const saved = await store.read(token, expectedOwnerId, created.id);
const updated = await store.update(token, expectedOwnerId, saved.id, saved.revision,
  { ...saved.draft, title: "Новое название" });
```

`create` генерирует UUID на сервере; paid=false/status=draft и даты — defaults БД, не request fields. `update` заменяет **core**, не делает PATCH: отсутствующие core поля возвращаются к draft defaults. Фото, booking, contacts, точная география и прочие колонки не входят в этот контракт, не записываются/не очищаются и не выдаются. Для них нужны следующие контракты/проверки; это не решение убрать их из интерфейса.

Ответ только `{id,revision,draft}`. Нет author ID, оплаты, статусных дат или SELECT *; это owner-private DTO, не публичная проекция объявления. Произвольные status/paid/owner/media поля отклоняются, а не молча игнорируются. Текст остаётся untrusted content: будущая UI должна использовать обычное escaping, не raw HTML.

## Доступ и конкуренция

В каждой операции настоящая identity берётся из App-сессии и сравнивается с expectedOwnerId. Порядок lock: user → session → owned draft row при update. Blocked/unverified/expired/idle/revoked/stale-auth-version/data-subject denied; admin не обходит ownership. Несуществующий, чужой и не-draft ID дают одинаковый ListingDraftAccessError. Базовый AppSessionAccessError и неизвестные SQL/COMMIT failures не превращаются в пустой draft или fallback.

Update требует canonical positive bigint **строку**, не Date/JS Number. Под row lock сравнивается текущая revision; UPDATE дополнительно ограничен ID+author+draft+revision и повышает revision на1 в SQL. При конфликте или bigint-max — ListingDraftConflictError, без повторного сохранения. Повторная финальная проверка сессии выполняется перед commit; expiry после реального INSERT/UPDATE откатывает запись. Даты не используются как concurrency token. SQL locks/integer semantics: [PostgreSQL18 locking](https://www.postgresql.org/docs/18/explicit-locking.html), [read-committed updates](https://www.postgresql.org/docs/18/transaction-iso.html).

Create **не идемпотентен и небезопасен для retry**: lost COMMIT reply может оставить один сохранённый draft без известного клиенту ID. Ни create, ни update автоматически не повторяются. До HTTP создания/UI нужен workflow неизвестного исхода создания (либо стабильный intent, либо явная сверка списка), bounded owner list, runtime privilege verifier и защита от утраты локального черновика. Одно отсутствие ответа не разрешает создавать ещё раз.

## HTTP существующего черновика

`/api/account/listing-drafts` включён только в явном postgres-mode; вне него POST/PUT возвращают404 без вызова runtime. POST **читает**, не создаёт: JSON `{expectedOwnerId,listingId}`. PUT заменяет core: `{expectedOwnerId,listingId,expectedRevision,draft}`. Ответ200 — тот же `{id,revision,draft}`. Не PATCH: клиент отправляет полный сохранённый core; пропущенные core поля получают draft defaults, non-core поля не затрагиваются.

Авторитет — единственная каноническая HttpOnly cookie, не body/Bearer. Host/Origin/X-Blizhniy-Request/Sec-Fetch-Site проверяются общим `readAuthJson`; query string запрещён. Требуются JSON и trusted X-Real-IP, не CF/XFF. Чтение ограничено4096 bytes, PUT65536 bytes, включая streamed body; deadline2s. Используется существующий shared session-rate budget PostgreSQL без изменения лимитов. Ресурс использует проверенный Auth pool и SELECT limit0 preflight: отсутствующие schema/grants дают отказ, не auto-provision/fallback. Этот preflight **не полный privilege verifier**, отдельный provisioner/grant audit остаётся необходимым.

Ошибки — `{error:{code}}`:401 UNAUTHENTICATED;404 DRAFT_NOT_FOUND одинаково для чужого/неизвестного/non-draft ID и stale expectedOwnerId;409 DRAFT_CHANGED;422 INVALID_INPUT;429 RATE_LIMITED с Retry-After900;503 DRAFT_UNAVAILABLE при dependency/SQL/неизвестном COMMIT исходе. Имеются общие boundary400/403/405/408/413/415. Ответы no-store/no-referrer/nosniff/CSP и request ID; audit содержит только operation/status/code/duration/request ID, без identity, draft ID, текста и причин SQL. GET405 с Allow POST,PUT; нет GET/public/create/list/delete или права менять billing/status.

PUT не повторять автоматически после409/503/network loss: сохранить локальный текст, явно прочитать существующий ID и сверить revision/content.503 не доказывает rollback. Cookie от другой identity не открывает прежний draft. UI обработки этих состояний ещё предстоит подключить.

## Проверка и границы готовности

Native contract/denial tests импортируют реальный parser/store/guard; подменяют только SQL в коротких denial fixtures. Owned PostgreSQL18.6 integration даёт минимальные column grants **только в локальной одноразовой БД** и проверяет настоящий storage/CAS/rollback/deny. Два аккаунта и admin синтетические, sessions выдаёт fixture; это не live signup/SMTP/CAPTCHA или браузерный сценарий. Отдельно проверяются неизвестные FK, non-draft, строковые версии выше JS precision, bigint-max, новые pool/store, unexposed fields и simulated post-commit acknowledgement loss без второго create.

HTTP native tests используют настоящий Request/JSON/cookie/ingress/parser/handler; подменяют resource dependency только для ingress/error веток. Тест actual Next route проверяет mode gate/delegation. Отдельные локальные PG тесты соединяют настоящий HTTP handler, cookie guard, shared limiter и ограниченную SQL роль: read/update, чужой/admin/unknown/stale account, stale revision/revoked session и simulated lost acknowledgement с одним сохранением/readback. Это не сетевой Next/browser/живой доменный сценарий.

Локальная durable проверка означает чтение из нового пула после закрытия прежнего, не массовый restart/failover тест. Changed-line coverage/нагрузочный p95 этим не измерены. Нет новых migrations/dependencies, изменений shared Auth guard, публичных запросов или remote grants. L10 целиком остаётся открытым: media/контакты, create/list HTTP и UI, публикация/модерация, owner list/search и payment lifecycle ещё не подключены.
