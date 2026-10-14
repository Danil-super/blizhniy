# ADR-008: Отдельная подготовка хранения объявлений

## Статус

Принято для schema-only инкремента L10. Новые repository/API/формы, runtime grants и переключение рабочего сайта сюда не входят.

## Контекст

Российская БД содержит identity, справочники, media metadata, очередь писем и профиль. Старый listing-store использует другой backend. Для первого объявления сначала нужна независимая схема: без импорта прежних пользователей/публикаций и без автоматического изменения БД при deploy.

## Решение

Миграция `0012-listings.sql` добавляет `app.listings`. `--plan-listings` / `{includeListings:true}` явно расширяют проверенный account-план до 12 шагов; прежние 7/10/11-шаговые варианты и их hashes не меняются. Операторское применение требует точного host/database, PG18, TLS и совпадения всего записанного префикса. Приложение/CI её не применяет.

Владелец — FK `author_id` к `app.users`, удаление владельца удаляет связанные строки. Это возможность SQL-схемы, не доказательство завершённого account-erasure workflow или очистки файлов/backup. Категория и город связаны с новыми reference IDs, а не display names. `draft` допускает незаполненные title/category/city; цена nullable, точная decimal RUB, zero допустим, отрицательное/NaN запрещены. Координаты либо обе отсутствуют, либо обе конечны и в диапазоне; 0/0 допустим. Exact-location флаг требует пару координат.

Статусы соответствуют существующему PublicationStatus. Публикация требует заполненных полей, paid-state и конечной упорядоченной пары дат; draft/pending_payment не могут иметь paid-state или publication dates. Эти CHECKs доказывают только согласованность строки, **не факт оплаты/модерации**. Только будущая серверная логика с подтверждёнными платежами сможет менять служебные поля. `revision bigint` — заготовка серверной CAS версии, должна передаваться строкой; сама схема не увеличивает её и не защищает от stale save.

Контакты, точный адрес/координаты, owner ID и booking JSON считаются приватными исходными данными. Нет PUBLIC/runtime grants, публичного view, RLS session policy или SELECT * endpoint. Будущий repository обязан проверять текущую сессию/владельца и выдавать отдельную публичную проекцию: только published+неистёкшие строки, скрытые геоданные/контакты не сериализуются. Booking JSON сейчас ограничен object/20KB; проверка его бизнес-полей и URL protocol выполняется будущим input contract **до** выдачи write grants. Схема не является валидатором всего HTTP payload.

Индексы: owner+updated_at+id для ограниченной сортировки кабинета, FK category/city и partial published+created_at+id. Это индексные пути, не измеренный p95/нагрузочный допуск. UUIDv4 сохранён по существующему контракту; новая extension/sequence не нужна.

## Альтернативы

Один JSON-документ для всего объявления хуже отделяет служебные paid/owner/status поля от редактируемых. Прямой перенос старой схемы/ID противоречит чистому старту. Автоматическая миграция при старте или default expansion изменяет БД без отдельной операторской операции.

## Последствия и откат

Schema-only release безопасен для старого приложения: оно не обращается к новой таблице. Down берёт ACCESS EXCLUSIVE lock с deadline и **отказывает на непустой таблице**, без CASCADE или удаления пользовательских строк. После появления данных откатывать приложение, сохраняя additive schema; восстановление/изменение migration journal согласовывается отдельно. Удаление пользователей/файлов и retention до запуска остаются открытыми L21/L22.

Проверки: `tests/listing-schema-plan.test.mjs` и owned loopback `tests/bootstrap-postgres-integration.mjs` / `tests/listing-schema-integration.mjs`: additive/repeat/down, FK, частичный draft, денежные/географические/date/length границы, deny runtime/PUBLIC, индексы и owner cascade. Mutation paid-condition должна ломать published-consistency тест. Никаких настоящих аккаунтов/писем/платежей в этих fixtures.

Основание SQL: [PostgreSQL 18 constraints](https://www.postgresql.org/docs/18/ddl-constraints.html), [numeric types](https://www.postgresql.org/docs/18/datatype-numeric.html). CHECK допускает SQL NULL, поэтому обязательные поля отдельно NOT NULL; NaN и бесконечные даты проверяются явно.
