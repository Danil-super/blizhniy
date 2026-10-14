# Черновики объявлений: серверное ядро

Слой L10 использует `app.listings` из миграции0012 и существующий `withAppSessionTransaction`. Это работающие create/read/update методы repository, **не подключённый HTTP endpoint или форма**. Новые runtime grants на рабочей БД не применены; активный backend сайта не переключён. Все прежние функции остаются в объёме запуска.

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

Create **не идемпотентен и небезопасен для retry**: lost COMMIT reply может оставить один сохранённый draft без известного клиенту ID. Ни create, ни update автоматически не повторяются. До подключения HTTP/UI нужен workflow неизвестного исхода создания (либо стабильный intent, либо явная сверка списка), body/CSRF/Origin/shared-rate limits, bounded owner list, runtime privilege verifier и защита от утраты локального черновика. Одно отсутствие ответа не разрешает создавать ещё раз.

## Проверка и границы готовности

Native contract/denial tests импортируют реальный parser/store/guard; подменяют только SQL в коротких denial fixtures. Owned PostgreSQL18.6 integration даёт минимальные column grants **только в локальной одноразовой БД** и проверяет настоящий storage/CAS/rollback/deny. Два аккаунта и admin синтетические, sessions выдаёт fixture; это не live signup/SMTP/CAPTCHA или браузерный сценарий. Отдельно проверяются неизвестные FK, non-draft, строковые версии выше JS precision, bigint-max, новые pool/store, unexposed fields и simulated post-commit acknowledgement loss без второго create.

Локальная durable проверка означает чтение из нового пула после закрытия прежнего, не массовый restart/failover тест. Changed-line coverage/нагрузочный p95 этим не измерены. Нет новых migrations/dependencies, изменений shared Auth guard, публичных запросов или remote grants. L10 целиком остаётся открытым: media/контакты, HTTP/UI, публикация/модерация, owner list/search и payment lifecycle ещё не подключены.
