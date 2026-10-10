# Изолированный PostgreSQL staging

## Назначение и границы

Отдельная `blizhniy_staging` в существующем российском кластере Timeweb, не копия production. Только reference seed; никаких старых аккаунтов, файлов и платежей. Отдельный кластер не приобретён. Разделение БД защищает данные правами, но не изолирует CPU, диск, соединения или общий отказ кластера. Нагрузочные тесты требуют отдельного согласования бюджета ресурсов.

Владелец `blizhniy_stage_owner` — NOLOGIN. `blizhniy_stage_migrator` имеет LOGIN и может явно SET ROLE владельца **только staging**, без ADMIN/INHERIT; соединений ≤2. `blizhniy_stage_runtime` — LOGIN, соединений ≤5, без membership владельца, SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS. Начальный runtime-профиль — `USAGE app` и `SELECT` только пяти справочников. Identity, journal, media и запись тарифов закрыты; future auth/media grants вводятся отдельными проверенными инкрементами, не GRANT ALL.

Точечные membership options соответствуют [PostgreSQL 18 GRANT](https://www.postgresql.org/docs/18/sql-grant.html). Мигратор делает явный SET ROLE, чтобы таблицы и definer-функции принадлежали постоянному NOLOGIN-владельцу, а не сменяемому логину. Это не перенос операторского gen_user в HTTP-приложение.

## Операторская процедура

`scripts/provision-staging-postgres.mjs` не вызывается приложением или deploy. Нужен Node22, существующие operator CREATEDB/CREATEROLE и `BLIZHNIY_DB_*` для контрольной БД, **не** staging. TLS verify-full с CA и DNS-именем. `--plan` не подключается к сети:

```bash
node --experimental-strip-types scripts/provision-staging-postgres.mjs --plan
node --experimental-strip-types scripts/provision-staging-postgres.mjs \
  --apply 17e86f80f26733d39ef4b84d.twc1.net:blizhniy_staging \
  --credentials-file /home/danil/.config/blizhniy-staging/database.json
```

Пароль оператора читается через stdin, terminal echo временно отключается. В аргументах и output его нет. Скрипт создаёт новые случайные пароли и сохраняет их **до мутаций**: новая 0600 regular file в заранее подготовленной 0700 user-owned папке вне Git, без symlink/overwrite. Этот локальный файл — операционный секрет, не образец для копирования в репозиторий, CI или чат; его не читать в вывод инструмента. На VPS файл пока не передан.

В DDL передаётся SCRAM verifier, не открытый пароль; алгоритм сверён с [PostgreSQL scram_build_secret](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/common/scram-common.c), а совместимость доказана настоящим login PostgreSQL18. Verifier тоже чувствителен: не печатать SQL и не публиковать server logs.

Существующие роли/БД не принимаются под управление, пароли не ротируются и ничего не удаляется. Создание ролей транзакционно; CREATE DATABASE отдельно, затем существующий bootstrap с SHA256 journal и seed. Поэтому возможен частичный результат. При ошибке или потерянном ответе сначала инвентаризация, не повторять автоматически и не удалять созданную БД. Сохранённые credentials нужны для восстановления известной установки; rollback — не включать её в runtime, а не стирать неизвестные данные. Таймауты и connection limits сохраняются.

`verifyStagingRuntime` сначала проверяет доступ ко всем пяти справочникам без чтения строк (`LIMIT 0`), атрибуты роли и отсутствие EXECUTE на функциях app/blizhniy_meta, затем выполняет настоящие отрицательные SQL-пробы в откатываемых транзакциях: DDL, TEMP, tariff write, identity/journal/media access, SET ROLE owner. Отсутствие прав на запись не считается успехом без прав на необходимое чтение. Запрет EXECUTE относится к reference-only профилю; будущие Auth/media профили требуют нового контракта и тестов. Проверка не подтверждает готовность SMTP, HTTP auth, файлового хранилища, платежей, private network, backup/restore или устойчивость прав после вмешательства облачного control plane.

## Фактическое состояние 10.10.2026

- Созданы БД и три роли; bootstrap применил 0001–0007: users=0, categories=105, tariffs=7, cities=26, professions=14. Исходный `default_db` остался с 0001–0005; SHA256 совпали, users=0, categories=105, tariffs=7.
- Первоначальный login мигратора/runtime, чтение каталога и ограничение runtime прошли по verify-full TLS. Последующие независимые подключения обеих ролей получили SQLSTATE42501 **на этапе CONNECT** даже к staging. Read-only `pg_database` подтвердил исчезновение выданных CONNECT-grants: оставался только владелец. Роли и schema сохранены. Кто изменил ACL — пока не установлен; вмешательство облачного control plane — гипотеза, не доказанный факт.
- Выполнено **одно** точечное восстановление CONNECT в staging для мигратора/runtime/оператора; каталог подтвердил runtime_connect=true. Следующая независимая runtime-проверка подключилась, но завершилась SQLSTATE42501 при чтении справочников. Read-only каталог подтвердил: CONNECT=true, USAGE схемы app=false, SELECT categories/tariffs=false; соответствующие ACL содержали только владельца. Исчезли не только права подключения, но и права чтения. Рабочие DB grants этой операцией не менялись. На этом этапе потребовалась сверка настроек control plane, не цикл повторных SQL-grants. Не включать приложение на gen_user и не расширять PUBLIC ради обхода.
- В доступном каталоге plugins подходящего Timeweb connector не найдено; токен облачного API не предоставлен. Не извлекать авторизацию из браузерных cookies. Поддерживаемое управление пользователями/доступом описано в [панели Timeweb](https://timeweb.cloud/docs/dbaas/postgresql/users-and-privileges); последующую настройку в панели выполнил владелец.
- Скриншот панели показал все выбранные привилегии runtime. SQL подтвердил не только отображение: CREATEDB/CREATEROLE=true, права чтения/записи в staging и CONNECT к default_db. После настройки владельцем «только CONNECT в staging; без прав в default_db» SQL подтвердил снятие повышенных атрибутов и отказ подключения к default_db. Мигратор сохранил SET ROLE owner и подключение к staging. Панельное отображение владельца `root` не совпадает с SQL: реальные владельцы остаются stage_owner и postgres, поэтому по интерфейсной подписи нельзя объявлять смену ownership.
- Мигратором в staging точечно восстановлены USAGE app и SELECT пяти справочников. Затем аудит выявил остаточные EXECUTE-grants runtime на четыре trigger-функции, включая SECURITY DEFINER charge_media_reservation; снятие табличных прав через панель их не убрало. Это остаточное разрешение, не доказанный обход: trigger-функции не вызываются как обычные функции, а создание триггеров/DDL уже запрещено. Сняты только EXECUTE runtime на guard_auth_version(), guard_media_record(), charge_media_reservation(), guard_media_write_attempt(); другие роли не изменялись. Глобальные default privileges владельца на функции уже закрыты для PUBLIC/runtime и не менялись.
- Независимые новые соединения после исправления подтвердили чтение **ровно пяти** справочников, отсутствие табличных writes и EXECUTE app/meta, отсутствие собственных объектов и membership owner; девять отрицательных проб прошли. Настоящее подключение runtime к default_db отказано с 42501. Journal staging — семь совпадающих SHA256, users=0; categories=105/tariffs=7. Эти повторные проверки текущей сессии снимают немедленный блокер доступа, но не доказывают долговременную устойчивость или сохранение ACL после будущего сохранения панели/обслуживания кластера. L02c и весь L02 пока не закрыты.
- VPS health/ready отвечают. Новый app runtime, media root, SMTP/outbox и payment sandbox пока не установлены. Весь L02 остаётся открытым; новая DB/schema — завершённая подготовка, не готовый staging сайта.

## Воспроизводимые проверки

```bash
node --experimental-strip-types --test tests/staging-provision.test.mjs
node --experimental-strip-types --test tests/bootstrap-postgres-integration.mjs
npm test
npm run check:types
npm run lint
npm run check:floor
```

SQL integration работает только в собственном disposable PG18 Docker-контейнере: несуперпользователь-оператор, реальные логины/права, denied access к защищённой таблице другой БД, repeat refusal без смены passwords, отказ проверки при исчезновении USAGE схемы или при остаточном EXECUTE на функции. Оба последних сценария воспроизведены RED → GREEN: прежняя проверка ошибочно пропускала соответствующее состояние. Локальные 5 новых unit + 6 SQL сценариев не моделируют control plane Timeweb. Последний общий Native 1026/1026, PostgreSQL67/67, types/lint без ошибок (прежнее lint warning сохранено); инвертирование TLS-условия и нового EXECUTE-verdict поймано тестами и восстановлено. Изменений приложения/lockfile нет; предыдущая app build не подменяется новой сборкой.
