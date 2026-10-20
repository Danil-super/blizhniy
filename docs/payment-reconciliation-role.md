# Ограниченная роль обработчика оплаты

Локальный срез L17: план отдельной роли и настоящий read-only preflight для
[сервиса сверки](payment-reconciliation-service.md). Не установлен на VPS;
production schema/grants, роли аккаунтов, SSH и режим оплаты не менялись.
Реальные запросы в магазин не выполнялись. Внешнее финансовое ревью отложено
владельцем, а не заменено этими проверками. Полный перенос ещё не завершён.

## Почему отдельная роль и блокирующие триггеры

Обычный HTTP runtime не должен уметь назначать оплату и публикацию. Для
verification+fulfillment выделена роль `blizhniy_payment_reconciler`, без
SUPERUSER/CREATEDB/CREATEROLE/INHERIT/REPLICATION/BYPASSRLS, с лимитом4 соединения,
без входящих и исходящих memberships и без grant options. План создаёт её
**NOLOGIN**; пароля, автоматического принятия существующей роли или executor нет.
Настройка защищённого LOGIN и применение production-плана остаются отдельным
согласованным действием, не побочным эффектом импорта или деплоя сайта.

Для SELECT FOR UPDATE/SHARE PostgreSQL требует UPDATE хотя бы одного столбца:
[официальные права SELECT](https://www.postgresql.org/docs/18/sql-select.html).
Поэтому прежнее тестовое UPDATE(id) нельзя просто скопировать в production:
оно позволило бы менять ключи пользователей/справочников, где такого запрета нет.

Миграция0024 добавляет SECURITY INVOKER функцию с пустым search_path и шесть
BEFORE UPDATE FOR EACH ROW триггеров `reconciliation_lock_only`: users,
payment_checkout_intents, categories, cities, media_objects, listing_moderation.
Для current_user **или** session_user выделенного worker они отвергают любой
UPDATE, включая id=id. Чистый SELECT с row lock их не вызывает. Все шесть включены
ALWAYS, функция не выдана PUBLIC. Механика включения:
[ALTER TABLE / triggers](https://www.postgresql.org/docs/18/sql-altertable.html).

Для остальных ролей функция возвращает NEW без изменения. Реальный обычный
runtime в fixture всё ещё создаёт синтетический аккаунт, меняет password_hash
и получает auth_version+1; собственная проверочная транзакция откатывается.
Схема пользователей, сессии и правила выдачи администраторов не переписываются.

## Канонический план полномочий

`getPaymentReconciliationRolePlan(database)` в
`scripts/payment-reconciliation-role.mjs` возвращает createRole, GRANT statements
и ожидаемые24 пары name/sha256. Имя БД строго ограничено; идентификаторы объектов,
роль и списки колонок статические. Новых прав нет у `blizhniy_runtime`.

| Область | Разрешено worker |
|---|---|
| Очередь | Чтение нужных полей; UPDATE только state/attempts/claim/lease/next/code; без INSERT/DELETE |
| Финансы | Исходная immutable привязка/тело запроса, link, status; INSERT/UPDATE результата сверки; INSERT receipt исполнения; UPDATE order.status |
| Публикация | Чтение полей канонической проверки формы/фото/модерации; UPDATE только status/is_paid/published_at/expires_at/updated_at объявления |
| Аккаунт и справочники | Минимальное чтение id/blocked/verified и полей формы; UPDATE(id) только для row lock под активными запрещающими триггерами |
| Журнал схемы | Только SELECT name/sha256 |

Полный перечень колонок задаётся одним policy-объектом в коде. Чтения email,
password_hash, sessions, token tables, произвольных профилей и дополнительных
полей media нет. Не выдаются INSERT новых intent/order/provider-link, DDL,
DELETE/TRUNCATE/TRIGGER/MAINTAIN, sequence rights и EXECUTE пользовательских функций.
Изменение суммы/получателя/target/receipt history не разрешено.

Это **доверенная финансовая роль**, а не RLS-ограниченный пользователь: она
может писать финансовый статус и разрешённые поля публикации. Компрометация
worker не становится безопасной только из-за этого ACL. Merchant/TEST binding
проверяется кодом store/GET-reader; этот план не создаёт database row isolation
между магазинами или TEST/LIVE. Исходное тело платежа может содержать email чека,
нужный строгому validator; оно не идёт в audit. Для worker по-прежнему обязательны
изоляция процесса/секретов, TEST-only factory и проверенный transport.

## Проверка перед claim

`verifyPaymentReconciliationDatabase(db,{database})` ничего не выдаёт и не
исправляет. Выполняет одну READ ONLY транзакцию, локально ставит search_path в
pg_catalog, затем проверяет:

- Реальный session_user/current_user, целевую БД, PostgreSQL18, LOGIN/лимит4,
  запрещённые атрибуты, отсутствие memberships и права менять replication role.
- Точное совпадение24 записей журнала с текущими исходниками, нужный schema USAGE,
  отсутствие CREATE/делегирования/неожиданного доступа к чужим схемам.
- Фактические права **каждой** пользовательской колонки на SELECT/INSERT/UPDATE/
  REFERENCES, включая PUBLIC и grant options, ровно по policy. Запрос ограничен
  10001 строкой; лишние/недостающие права приводят к отказу.
- Отсутствие опасных table/sequence прав и EXECUTE любых non-system функций.
- Наличие шести безусловных ALWAYS row/BEFORE/UPDATE guards с точной функцией,
  телом из0024, SECURITY INVOKER, plpgsql и пустым search_path.

Любое исключение превращается только в `Payment reconciliation database
preflight failed`, без текста SQL/TLS, PII, cause или автоматического retry.
Сведения о правах берутся через
[функции PostgreSQL18](https://www.postgresql.org/docs/18/functions-info.html).
Это одноразовая startup-проверка, не непрерывный контроль изменений прав и не
полная forensic-сверка всех существующих ограничений/функций БД. Нужны доверенный
оператор, проверенные миграции и ограничения доступа к ним. Host/TLS/секреты
и настоящий merchant проверяются будущей production factory, не этим ACL probe.

## Миграция, откат и доказательства

0024 только через `includePaymentReconciliationRole:true`; предыдущие23 hash
не меняются. Нет нового apply CLI/startup/deploy hook. Up не создаёт ролей и
не выдаёт grants. Down отказывается удалять guards, пока выделенная роль имеет
UPDATE хоть одного столбца защищённых таблиц. Откат требует остановить admission
worker и сначала отозвать эти lock grants; таблицы и финансовая история остаются.

На owned PostgreSQL18 проверены up/down/reapply, точные права настоящего логина,
отказ при недостаточных/избыточных правах, grant option, memberships в обе стороны,
replication override, выключенном/изменённом guard и подменённом hash журнала.
Реальный выделенный логин может блокировать все шесть видов строк, но UPDATE
ключей, чтение credentials, создание платежей, DDL и удаление истории отвергаются.

Композиция preflight→service check→run→pending GET→retry→captured GET→publication
с ready-фото проходит под этой ролью, не owner. Пулы check/run закрываются;
повторный tick idle, receipt и срок не меняются. Provider transport синтетический.
Отдельный unit RED получен до реализации, проверочная инверсия target-validation
тоже ломает тест; исходный код восстановлен.

Контрольная точка20.10: native1600/1600, PostgreSQL319/319 без пропусков,
production build и явный tsc после сборки успешны. Lint:0 ошибок, только прежнее
предупреждение `tests/checkout-prerequisites.test.cjs:30`. Floor проходит.
Эти локальные проверки не объявляются пройденными SAST/dependency CI или
приёмкой изолированного настоящего магазина.

Следующее: production factory с привязкой TLS/БД/TEST merchant и безопасной
упаковкой TS-графа, supervisor/мониторинг, dispatch admission и реальный
изолированный sandbox E2E. До отложенного внешнего ревью и отдельного разрешения
на DDL/grants/включение этот локальный план не применяется к рабочей БД.
