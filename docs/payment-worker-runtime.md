# Изолированная сборка и TEST-конфигурация обработчика

20.10.2026: локальная подготовка L17. Служба **не установлена**, новые production
DDL/grants и merchant-запросы не выполнялись. Это не завершение полного переноса.

Владелец разрешил инженерное финансовое ревью и подготовку включения только TEST.
Три read-only разбора охватили checkout/dispatch/transport, очередь/worker и
ACL/fulfillment. Найденный пропуск схем `pgbackup` исправлен: SQL LIKE считал `_`
любым символом. Семь фильтров в preflight/bootstrap теперь исключают только
буквальный системный префикс `pg_`. PostgreSQL-тесты воспроизвели ошибку до
исправления и проверяют независимые лишние schema/column/table/sequence/function
права, а также отказ принимать чужую БД за пустую. Дополнительное ревью другой
моделью владелец пропустил. Настоящий sandbox E2E этим не заменён.

## Сборка без выполнения TypeScript в production

`scripts/build-payment-worker.mjs <новый-абсолютный-каталог>` — явный offline build.
TypeScript 5.9 компилирует транзитивное замыкание двух корней: canonical worker
и PostgreSQL adapter. Используются strict/noEmitOnError, CommonJS и переписывание
`.ts`-расширений. Ошибки типов не подавляются. Единственный runtime Next alias
в `booking-details.ts` заменён тем же относительным импортом.

В пакет входят compiled JS, пять native MJS-модулей, manifest и точные источники
24 миграций для проверки hashes/guard body. Operator/bootstrap, dotenv, исходный
TS, frontend и ключи туда не копируются. `postgres-migration-plan.mjs` читает
только статические SQL-источники; прежний bootstrap re-export сохранён.

Каталог создаётся без overwrite/recursive adoption. При ошибке частичный новый
пакет остаётся для диагностики, не считается готовым и автоматически не удаляется.
Повторная сборка требует другого нового каталога. Build не запускается импортом.
Готовый пакет размещается внутри проверенного release с его frozen `node_modules`
(`pg` и зависимости). Он **не** является полностью автономным архивом зависимостей.
Не удалять release, от которого зависит установленный процесс.

Процессные тесты грузят пакет из собственного временного каталога обычным Node22,
без TS flags/loader и доступа к source tree; dependency link указывает только на
установленные npm packages. Проверяются настоящий factory create/close без
подключения к БД, canonical imports и CLI через symlink с preserve-symlinks-main.
В PostgreSQL-сценарии ограниченного логина используется уже скомпилированный worker:
pending GET → повтор → captured GET → однократная публикация с фото.

## Закрытая по умолчанию конфигурация

`scripts/payment-worker.mjs` допускает только `--check` или `--run`, Linux,
Node22 >=22.18 и non-root. Импорт не устанавливает signal handlers и не запускает
работу. Путь команды и import.meta.url канонизируются одинаково: symlink не может
превратить проверку в молчаливый успешный выход. CLI использует существующий
[последовательный runner](payment-reconciliation-service.md), включая drain и audit.

Отдельный private environment задаёт:

- NODE_ENV=production; BLIZHNIY_PAYMENT_WORKER=queued-test;
  BLIZHNIY_PAYMENT_MODE=test; BLIZHNIY_PAYMENT_ENTRYPOINT=cli либо service.
- BLIZHNIY_PAYMENT_SHOP_ID; BLIZHNIY_PAYMENT_SECRET_KEY только с префиксом test_.
  Значения в Git/argv/audit не передаются.
- BLIZHNIY_DB_HOST=17e86f80f26733d39ef4b84d.twc1.net, PORT=5432,
  NAME=blizhniy_prod, USER=blizhniy_payment_reconciler, отдельный PASSWORD,
  SSL_MODE=verify-full, абсолютный CA_FILE. Нет fallback на HTTP runtime/owner.

Factory отклоняет LIVE, чужой target/role, PG* и отключение TLS. Canonical DB
adapter проверяет CA, оставляет rejectUnauthorized=true и SQL/connect timeouts;
пул ограничен двумя соединениями. Настройки/merchant копируются до использования.
Создание runtime не соединяется с БД и не вызывает provider. `--check` выполняет
только READ ONLY ACL/journal/guard preflight и закрывает пул. `--run` проходит тот
же preflight перед первым claim. Factory failure закрывает выделенные ресурсы,
повторный close не закрывает пул второй раз; наружу идут только generic errors.
Этот reconciler умеет только GET уже привязанного платежа, не provider POST.

## Что ещё требуется перед включением

Применение production0019–0024, отдельного логина и точечных grants — отдельный
согласованный шаг, не побочный эффект deploy. Подготовить private environment,
supervisor с ограниченными правами/ресурсами/restart delay и bounded shutdown,
затем настоящий `--check` на VPS. Активировать TEST callback только после этого.
Отдельно закончить admission создания платежа с текущей сессией/владельцем/
approved revision, затем провести разрешённый sandbox E2E и проверить повторный
callback/restart/историю. TEST-флаг не создаёт row-level изоляцию финансовой роли.
Остальные услуги, продления и возвраты ещё не перенесены; LIVE не допускается.

Повторный npm10 audit20.10: production0, полный по-прежнему9 (7 high/2 moderate).
Полный audit не зелёный; существующий build/dev риск и просроченный review14.10
из `dependency-security.md` остаются открытыми. Новых пакетов, lockfile-изменений,
исключений или принудительного major upgrade в этом срезе нет. Допуск массового
запуска этим отчётом не выдаётся.
