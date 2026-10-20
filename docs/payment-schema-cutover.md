# Production0019–0024: схема и проверочный запуск на VPS

20.10 владелец одобрил узкую адаптацию проверки managed ADMIN связи после тестов.
PAYMENT-PG18-ADMIN-20261020 записано в CONSTRAINTS.md; прочие проверки не меняются.
Ограниченный LOGIN и read-only CLI на VPS проверены. Затем HTTP API установлен
в284f0fe и отдельно включена только [TEST-подготовка заказа](listing-checkout-cutover.md)
с настоящим HTTPS proof. Постоянная служба, отправка платежа провайдеру,
публичная TEST-оплата и LIVE не включены.

20.10.2026 владелец одобрил применение шести миграций и создание отдельной
ограниченной роли. LIVE, списания, SSH и другие приложения не менялись.

## Фактически выполнено

- На российском VPS подготовлены только клиентские утилиты PostgreSQL18.6:
  официальные PGDG-пакеты для Ubuntu24.04/amd64 скачаны по подписанному APT index
  с pinned signing-key fingerprint и распакованы в отдельный root-only каталог.
  Системные пакеты/репозитории не менялись, сервер БД не устанавливался.
  Источник пакетов: [официальная инструкция PostgreSQL](https://www.postgresql.org/download/linux/ubuntu/).
- До DDL создан custom-format dump схем app/blizhniy_meta в root-only0700
  каталоге VPS; файл0600,151350bytes. SHA256 и manifest сохранены там же. Копия
  с ПД не скачивалась в рабочую папку, Git, staging или внешний сервис.
  pg_restore успешно разобрал весь архив без подключения к БД. Это **не**
  полноценная restore rehearsal и не независимая резервная копия/L22.
- Рабочая blizhniy_prod подключена с verify-full, проверены PG18/целевая БД и
  точный журнал18. Bootstrap атомарно применил0019–0024, теперь журнал24 и его
  hashes совпадают с проверенными исходниками; прежний префикс сохранён.
- Созданы семь финансовых таблиц, их ограничения/индексы/функции и шесть
  lock-only guards. Исторические данные не удалялись. Fingerprint эффективных
  column privileges прежней роли blizhniy_runtime на существующих таблицах
  совпал до/после схемы и выдачи новых прав.
- Роль blizhniy_payment_reconciler создана с точным column-scoped GRANT plan,
  первоначально NOLOGIN, без SUPERUSER/CREATEDB/CREATEROLE/INHERIT/REPLICATION/BYPASSRLS,
  connection limit4. SCRAM credential сохранён приватно вне Git до мутаций.
  После согласования и тестов включён LOGIN. Настоящее TLS-подключение этой
  роли прошло точный preflight; два чтения credentials/sessions отказаны.
- Прежняя роль сайта прошла существующую проверку Auth и отрицательные probes
  без изменения credentials. Health ok, публичная главная HTTP200. Сайт остаётся
  на этапе DDL оставался на release6fbcccf0604c. Последующее переключение HTTP
  на284f0fe/prepare-only/test и его отдельные40 grants описаны в cutover выше.

## Проверенный пакет на VPS

Из исходников c7ee7c444c0abdaa8b5c7cc0977d6708a31eba1c собран отдельный пакет:
26 compiled JS-модулей, пять MJS entry/helper, 24 SQL и два manifest/package файла.
57 файлов перенесены с проверкой SHA256 каждого, без TypeScript runtime/install
на сервере. Пакет находится в
`/var/www/blizhniy-releases/20261019142154-6fbcccf0604c/payment-worker-c7ee7c4-Fwqp1b`;
зависимости берутся из этого release, фактический pg8.23.1 проверен.
Не удалять родительский release, пока используется этот пакет.

В07:29:21UTC20.10 настоящий Node22 CLI `--check` завершился code0/status checked.
Одноразовая systemd255 unit `blizhniy-payment-check-fwqp1b` использовала отдельного
DynamicUser, read-only filesystem, запрет privilege escalation/capabilities,
лимиты192MiB/24tasks/50s. Не было tick/claim, merchant GET/POST или публикации.
Это runtime-проверка сборки/настроек/реального ACL, не E2E оплаты и не daemon.

Credentials передавались только по зашифрованному SSH stdin и через временный
root-only EnvironmentFile0600. После завершения этот файл и его0700 каталог
удалены; постоянные приватные credentials остаются вне Git. В пакете есть только
публичный CA, deployment manifest с hashes и несекретный check-proof.json.
Локальные приватные proofs отражают LOGIN/preflight и actual VPS CLI отдельно.

Использована семантика [systemd-run](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html)
и [EnvironmentFile](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html#EnvironmentFile=):
файл читает менеджер перед запуском под DynamicUser; --wait передаёт exit code.

## Обнаруженная граница управляемой БД

gen_user имеет CREATEROLE, но не SUPERUSER. PostgreSQL18 автоматически даёт
создателю новой роли ADMIN=true, INHERIT=false, SET=false, от имени bootstrap
superuser. Такой grant не может удалить сам CREATEROLE issuer — только суперпользователь.
Это подтверждено на отдельной синтетической PG18: creator REVOKE не удалил связь,
затем superuser REVOKE удалил; логин роли после этого работал.
Семантика описана в [Role Attributes](https://www.postgresql.org/docs/18/role-attributes.html).

Согласованный preflight допускает только эту incoming связь: gen_user non-superuser
с CREATEROLE, grantor postgres/SUPERUSER, ADMIN=true/INHERIT=false/SET=false.
Все outgoing/прочие incoming связи по-прежнему запрещены. Служебная связь даёт
администратору управление ролью, а не обработчику права администратора.

Native1605/1605 и owned PG18.6 323/323 без skips, types/build успешны,
lint0errors с прежним unused warning, floor и staged Gitleaks чисты.
Восемь опасных вариантов связи отдельно отвергнуты. Контрольная мутация запрета
SET на SQL-границе теста принимает опасную связь; обычный preflight её отвергает.
Это доказательство чувствительности теста, не ослабление production SQL.
SAST/dependency CI и настоящий merchant E2E этим не подменяются.

Полный перенос не завершён. Применённая схема не является включённой оплатой,
а сохранённый dump — доказательством восстановления. Sandbox E2E, dispatch
admission, установка/supervision, остальные услуги и прочие launch gates открыты.

## Откат на этом этапе

Для отката именно DDL/worker-этапа оставить worker/webhook отключёнными;
для текущего HTTP prepare-only сначала выполнить отдельный runbook выше.
При отзыве допуска оператор
возвращает выделенную роль в NOLOGIN. Одноразовая unit уже завершена,
EnvironmentFile удалён; этот DDL/worker-этап не требует отката release. Не удалять новые
таблицы/журнал/guards или backup ради отката:
они совместимы с прежним сайтом. Удаление0024 требует предварительного отзыва
UPDATE lock grants; проверенный down это контролирует. При неизвестном COMMIT
оператор не повторяет --apply: сначала отдельно сверяет журнал и состояние роли.
