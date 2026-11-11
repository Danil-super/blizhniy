# Review: общая проверка системных прав финансовых ролей

10.11.2026. [Точный patch](financial-catalog-transfer.patch).

Новая financial-catalog-privileges.mjs содержит уже проверенные schema/parameter/system ACL проверки refund worker. Оба guard используют один модуль. Прежний payment reconciler дополнительно отклоняет CREATE в системных namespace, права параметров SET/ALTER SYSTEM, pg_read_binary_file/pg_authid и другие дополнительные системные ACL, включая PUBLIC. Точные namespace исключения и relkind t закрывают доступ к TOAST, не замечаемый прежним фильтром pg_. В старый preflight добавлены statement_timeout5s/lock_timeout1s в его read-only транзакции. Роли/гранты/миграции/политика магазина не меняются.

Сборщик копирует дополнительный файл, чтобы автономный пакет выполнял ту же проверку. 10 новых регрессий до исправления воспроизвели приём лишних прав и исходниками, и собранным пакетом. После исправления targeted367/367 (реальная PostgreSQL и native artifact/mocks) прошли; отдельный тест покрывает SELECT реальной pg_toast relation без schema USAGE. В fake fixture схемы32/33 добавлены ответы на новые metadata запросы; все её прежние assertions сохранены. Проверки роли возвратов и общая регрессия выполняются отдельно.

Согласование требуется для изменения самого guard по CONSTRAINTS.md:47 — «Изменения самого guard/workflows … обязательно проверяются человеком». Запрашивается только сохранение локального кандидата после проверок. Нет push/deploy, замены установленного обработчика, изменения ручной/production БД, провайдерского HTTP или денежных операций.

Не расширяются прежние допустимые схемы24/25/32/33, whitelist финансовых колонок, lock guards, TEST и membership ограничения. Код ранее согласованного managed membership predicate остаётся прежним; эта работа не продлевает production-допуск PAYMENT-PG18-ADMIN-20261020 с датой пересмотра03.11.2026. Его отдельный пересмотр требуется до production-обновления; новая refund-роль по-прежнему запрещает все memberships.

Полная сверка фактических business-объектов БД и готовность refund службы этим изменением не закрываются. Независимое инженерное ревью нашло gap pg_toast; добавлены проверка и регрессия. Дополнительную модель владелец пропустил.

Владелец одобрил точные версии10.11.2026: «Одобряю точный diff, только локально». Согласование не включает установку, push/deploy или продление production-допуска managed membership.

Итоговая регрессия11.11.2026: native2576/2576 и все13 обязательных PG-наборов785/785 за233.5s без skips. Код и patch побайтно совпали с согласованными версиями. Сборка/секреты/запуск стенда фиксируются в основном журнале завершения.

При сохранении patch представлен с нулевым контекстом (`--unified=0`), чтобы служебные строки контекста не создавали trailing whitespace в Git. Код и SHA256 согласованных версий неизменны; для применения такого формата нужен `git apply --unidiff-zero`.

SHA256 точных версий:

- `scripts/financial-catalog-privileges.mjs`: `91bde4f04f60dcea274c797e4603d49489b3d91279e64ae0a365f44f144e28f9`
- `scripts/payment-reconciliation-role.mjs`: `8d052257be9d59eb25423c98f7b4c429dc341156b43570aed522deeddadea1b3`
- `scripts/refund-worker-role.mjs`: `0c96d2adb3b0cb87e92ff1f3b886f92d25e31ddcd8ebf3eb9bfc1b29bc9a422d`
- `scripts/build-payment-worker.mjs`: `e6b4d8e6c3ea0f15fada3ad43ef07893599530517d57088c5ef6a38e84bd3c52`
- `tests/payment-reconciliation-role-integration.mjs`: `7d5f5a4a1b8d09310648e817b48c14f5740531285b86ee52433baf5e07db293b`
- `tests/payment-reconciliation-deletion-schema.test.mjs`: `52fc20cd1e7b27f1c043d830d2f9447df281f38e804ceeb11d7e09deb8670619`
- `tests/refund-worker-role-cases.mjs`: `07a5a4be8765d4085cd70bed8200c0bbec30f9bffd8672a746a3fd163bb74585`
