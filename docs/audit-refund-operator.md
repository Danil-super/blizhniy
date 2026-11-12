# F02: отдельная роль и пакет оператора возвратов — 12.11.2026

Основаd4207a3: владелец одобрил прежний точный54 diff только локально, он сохранён отдельным commit. Этот документ описывает следующий локальный кандидат55. Точный candidate/guard одобрен владельцем12.11 только для локального сохранения; текущий diff не включает установку на ручной или рабочий сайт, push/deploy и обращения к настоящему провайдеру.

## Полномочия и границы доверия

`blizhniy_refund_operator` — самостоятельный NOLOGIN SQL-план с точными колонками, двумя EXECUTE и без членств/административных признаков. Он читает поля текущих пользователей/сессий, нужные существующей проверке live admin, и канонические финансовые источники. INSERT разрешён только для входных полей approval, recovery audit, ссылки/наблюдения доказанного возврата и итогового эффекта размещения/компенсации. Нет записи reservation/request/anchor/attempt/candidate, выдачи заданий, сброса очередей, изменения оплаты/публикации напрямую или удаления истории. Пароль, LOGIN и применение прав отсутствуют в плане.

Роль и вызывающий её процесс являются доверенной финансовой властью: хеши сессий и исходный request_body с возможным чеком доступны этому процессу. Это не SQL-RLS изоляция от скомпрометированных операторских credentials. Полномочия записи journal/effect подразумевают доверенный код, который предварительно проверяет GET провайдера. В журналы/интерфейс эти исходные сведения не выводятся. Нового authentication flow, внешней интеграции и хранения ПД не добавляется.

Бизнес-API переиспользуются: PostgresRefundApprovalStore.approve/readForAdmin требует текущего подтверждённого администратора, expected actor и причину; createPrimaryRefundRecovery допускает только GET уже предпринятого возврата с прежними source/key/window/cap. Сессия повторно проверяется до каждой транзакционной записи и после ожиданий. Сам approval не отправляет деньги. Recovery подтверждает существующий результат и не создаёт новый POST или send window.

## Блокировки и схема55

Для SELECT FOR UPDATE PostgreSQL требует UPDATE хотя бы одной колонки. Три точных UPDATE(id) grants закрыты новой0055: ALWAYS BEFORE UPDATE OF id отклоняет любое изменение, включая id=id, от current_user или session_user оператора. Остальные UPDATE остаются запрещены ACL; прежние финансовые SECURITY DEFINER изменения статуса работают. Оператор может обновлять только last_seen_at существующей сессии в штатной live-session транзакции.

Read-only admission проверяет собственную роль/login, PG18, БД, лимит4, read-only/origin, отсутствие повышенных флагов и любых memberships, точные эффективные column/EXECUTE ACL без grant options, общие namespace/parameter/system ACL, полный журнал55/SHA256 и всю app-схему. Три новых guard проверяются отдельно по enabled/body/колонкам/security/search_path. Managed-исключение прежнего reconciler не переносится на оператора или refund worker.

Эталон0055 получен свежим replay0001–0054 с совпадением исходного эталона54, затем0055. Меняются только одна function и три trigger fingerprints. Дополнительный тест повторяет все55 исходников под другим владельцем и сравнивает полную структуру;54 baseline и прежние54 assertions сохранены.

Проверки обоих worker теперь могут принять ровно54 или55 с соответствующим полным fingerprint. Права workers неизменны. Offline builders по умолчанию остаются54; явный schema55 добавляет проверенные metadata55 и сохраняет metadata54. Старый54 package без новой миграции/fingerprint не может автоматически принять55. Несоответствие journal/schema, неизвестная56, неверный hash или повреждённый0055 отклоняются. Изменение владельцем БД после admission остаётся границей доверия.

## Отдельный offline package

buildRefundOperator собирает существующие approval/read/recovery, PostgreSQL и bounded TEST merchant probe без source TS/aliases. Он проверяет копируемые байты55 до создания частного destination, сохраняет оба fingerprint и не перезаписывает существующую папку. Payment/refund sending consumers и sender не компилируются. Импорт не читает dotenv, не открывает сеть/БД и не запускает службу. Нет HTTP listener, CLI операционных действий, системной установки, GRANT executor или automatic startup.

## Проверенное поведение

На owned disposable PostgreSQL18.6 исходный и скопированный operator guard работают под реальной точной ролью. Compiled approval/read проверены для объявления, вакансии и заказа; compiled GET recovery восстанавливает прерванную worker-сверку каждого из них и компенсацию непросмотренного отклика. Один POST остаётся выполненным worker, один эффект/уведомление — неизменяемым. Повтор recovery с тем же action не создаёт новых отправок/ключей/сроков. История/статус отклика сохраняются.

Проверены ordinary/blocked/stale/wrong actor, отзыв admin между GET и записью, неопределённый финальный COMMIT с readback без HTTP, session/PII/financial/send/queue authority denials, дополнительные/missing/grantable ACL и системные права. Настоящие current_user/session_user/definer/no-op ID writes отвергаются. Все три роли и copied worker packages принимают55, а усечённый journal/unknown56/изменённые new guard/fingerprint отказывают. Глобальный fetch запрещён в новом fixture, provider явный fake; реальные запросы не выполнялись.

Целевой PostgreSQL86/86, native2605/2605 и все13 обязательных PostgreSQL-наборов829/829 за322.8s прошли без skips. RED отсутствующего модуля роли воспроизведён. Причинный контроль ID подтвердил: отключение нового guard разрешает id=id и отвергается admission, восстановление возвращает запрет и успешный допуск. Floor/types/lint прошли (прежний targetType warning), staged Gitleaks — без находок. Graphify10713/31242 и Code Graph2174/6415 обновлены для текущего корня. Сборка приложения прошла; новые guards одобрены владельцем12.11 для локального сохранения.

## Что остаётся

Операторский runtime/transport/интерфейс админки, установка на ручной стенд, общая эксплуатационная композиция служб и настоящая TEST/fiscal приёмка ещё открыты. Этот кандидат предоставляет ограниченный программный пакет и план прав, а не включённую пользовательскую функцию возврата. Production/schema33 и ручной39 не менялись.

Основание блокировок получено через Context7 PostgreSQL18: [SELECT privileges](https://www.postgresql.org/docs/18/sql-select.html), [UPDATE OF triggers](https://www.postgresql.org/docs/18/sql-createtrigger.html), [current_user/session_user](https://www.postgresql.org/docs/18/functions-info.html).
