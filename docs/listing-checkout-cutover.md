# Подготовка TEST-заказа в рабочем контуре

20.10.2026 владелец разрешил точечные права API и включение только
`prepare-only`/`test`, без merchant-запросов, списаний или публикации.
Это не разрешение LIVE, callback, постоянного worker или provider POST.

## Права

`database/permissions/listing-checkout.sql` — явный операторский план,
не автоматическая миграция и не startup hook. Три GRANT добавляют40 эффективных
column privileges роли `blizhniy_runtime`:

- payment_orders: SELECT8 колонок, INSERT6 колонок исходной привязки.
- payment_checkout_intents: SELECT12 колонок, INSERT11 колонок immutable намерения.
- payment_fulfillments: только SELECT intent_id/published_at/expires_at.

Нет table-level grants, grant options, UPDATE/DELETE, доступа к dispatch anchors,
provider links, verification или очереди. Runtime не может назначить status
заказа, is_paid/дату публикации, hash намерения или запись исполнения.
Запрос к БД не заменяет проверку сессии/владельца в API: роль доверенная,
без row-level изоляции пользователей. Request body с возможным email чека
читается только сервером и не входит в DTO, аудит или отчёт.

План применён атомарно в07:50:20UTC20.10.2026. Рабочий journal остаётся24,
все hashes сверены. Snapshot прежних прав вне семи финансовых таблиц и snapshot
роли обработчика совпали до/после. Настоящая HTTP runtime-роль прошла Auth
проверку и отрицательные probes: settlement, dispatch, изменение публикации
и дополнительные поля недоступны. Приватный baseline/proof сохранён вне Git.
SHA256 плана:31825d10ab549482a9f3e06496437467c118e0de19b5b275bb90dd9b9ab79484.

## Проверки и границы включения

На отдельной PG18.6 доказаны ровно40 прав; настоящий HTTP handler под обычной
ролью создаёт/replay/readback один заказ, отказывает чужой сессии/владельцу и
не меняет публикацию. Отзыв одного INSERT(request_body) даёт generic503 и
полностью откатывает заказ; исходный ключ после восстановления работает.
Проверенный down снимает40 прав, сохраняет историю, повторный up идемпотентен.
Owned PostgreSQL327/327 и native1605/1605 без skips, types/lint без ошибок;
прежнее lint-предупреждение не скрыто. Это ещё не production HTTP smoke.

API-код публикуется отдельно с обычными CI/security/CodeQL gates. После установки
проверяются `prepare-only`, `BLIZHNIY_PAYMENT_MODE=test`, server-only shop ID и
`BLIZHNIY_PAYMENT_RECEIPT_VAT=none`. Последнее касается только TEST-подготовки:
фискализация/НДС для LIVE не выбраны и не объявляются решёнными.
Нужны реальные health/ready и HTTP prepare/replay/readback/foreign-denial proofs;
наличие GRANT само по себе не считается работающей оплатой.

## Откат

Сначала отключить `BLIZHNIY_LISTING_CHECKOUT`, перезапустить только сайт и
проверить health/ready. Затем оператор применяет точный
`database/permissions/listing-checkout-revoke.sql`; прежние права Auth/media/
публикаций не меняются. Историю заказов/намерений/исполнений не удалять.
Перед отзывом сверить, что фактические права равны исходному40-column плану:
не использовать этот файл как средство удаления неизвестных чужих grants.
После неизвестного COMMIT не повторять apply вслепую: отдельно проверить ACL.

Дальше остаются admission отправки, пользовательская кнопка/история оплаты,
постоянный обработчик/наблюдение, настоящий разрешённый sandbox E2E и остальные
платные услуги. Полный перенос и массовый запуск не завершены.
