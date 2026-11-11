# Согласование production-выпуска аудита — 11.11.2026

PR: https://github.com/Danil-super/blizhniy/pull/128.
База main: `cad32102463031dd96f0a1af168c9410ac931ff1`.
Проверенный набор кода: `bb14831f8761506ae33599caa455a2981e8318a2`,19 commits,174 файла. Разрешены только последующие изменения этого документа и отчёта о выпуске; изменение кода/манифестов/защиты требует пересмотра. Окончательный CI должен пройти на фактическом HEAD.

## Объём публикации

Весь код текущей ветки доставляется существующим prebuilt workflow. Сохраняется текущая production-конфигурация. Миграции, GRANT, новые роли, runtime-флаги и службы не устанавливаются/не включаются этим выпуском. Новый refund consumer не запускается; отдельно установленный payment worker не заменяется. LIVE и настоящие provider-операции не включаются. БД и её история не меняются deploy-скриптом.

Новые booking lifecycle, work owner actions и checkout cancellation сейчас разрешены исходниками только для локального стенда. На production с отсутствующими флагами они не включатся. Совпадение source-версии после релиза не означает равенства активированных функций с локальной конфигурацией. Их production rollout, включая целевую схему и права, остаётся отдельным этапом. Исходный schema33 web-профиль проверен статическим независимым review; metadata/API-каталоги и раздельный worker требуют эксплуатационной проверки.

Изменения защиты ранее просмотрены владельцем только для локального сохранения: docs/review/postgres-ci-gate.md, financial-catalog-transfer.md, refund-worker-role.md, refund-schema.md. Текущий запрос пользователя разрешает выпуск накопленного кода. Здесь представлены точные конечные хеши публикуемых критичных файлов; новых обходов в них нет.

| Файл | SHA256 |
|---|---|
| `.github/workflows/ci.yml` | `e98c45754c4d723a922ba8d00017a792e9f781cfd464cd426b482bfa935c62c9` |
| `scripts/payment-reconciliation-role.mjs` | `8d052257be9d59eb25423c98f7b4c429dc341156b43570aed522deeddadea1b3` |
| `scripts/financial-catalog-privileges.mjs` | `91bde4f04f60dcea274c797e4603d49489b3d91279e64ae0a365f44f144e28f9` |
| `scripts/refund-worker-role.mjs` | `c794b6a1f29659eee012dbbff29243abaed1403ac9e74c1cb72910801a402216` |
| `scripts/refund-worker-schema.mjs` | `634ef3bb0c6625df7ccd1fceddf3cf6f0622c2f9ba630f0b2f899ede7a99c23a` |
| `database/refund-schema-0054.json` | `701fb20e0f77dab0baec12b130b43a69297c50c11c8264b60f66ec8cb73873e3` |
| `scripts/build-payment-worker.mjs` | `e6b4d8e6c3ea0f15fada3ad43ef07893599530517d57088c5ef6a38e84bd3c52` |
| `scripts/build-refund-worker.mjs` | `4c719f5f6330fd4d8b52cef24347a9e865a055f4e58a5e7985458f0504d45035` |
| `package.json` | `24cda736fb6947613db3eb1548aa3176c2d59d41c0e2f156b5451dac5e25ee6b` |
| `package-lock.json` | `d59f0e00225bb57e0668af384850281ddafc8901013ab648b1737979b819650f` |

## Разовый допуск DR-UNAVAILABLE-PR128-20261111

GitHub job130537395608 завершился точной инфраструктурной ошибкой: «Dependency review is not supported on this repository. Please ensure that Dependency graph is enabled along with GitHub Advanced Security». Это не успешная проверка и не отчёт о найденной уязвимости. Платные функции не подключаются. Прежний DR-NO-INPUTS-20261102 относился только к PR127 и не переиспользуется: в новом PR изменены dependencies.

Предлагается разрешить слияние только PR128, только приведённого runtime/dependency payload (плюс docs-only отчёт) при этой недоступности API и успешных Validate app, Validate category layouts, Security checks и CodeQL на конечном HEAD. Нельзя разрешать иные ошибки/находки/новые изменения зависимостей этим допуском. Workflow Dependency Review остаётся обязательным без continue-on-error, условий пропуска и изменения порога. Допуск прекращается после этого выпуска; владелец решения — Данил.

Проверенный dependency diff: scoped override minimatch10.2.5→11.0.1 только для TypeScript ESLint, новый @isaacs/nonrecursive-glob-match1.1.0 и изменение dependency range brace-expansion у minimatch; остальные lock entries неизменны. Manifests закреплены хешами выше. Native проверяет реальный parser projectService/allowDefaultProject и ограниченный matcher. Свежий полный audit11.11: high0/critical0/moderate1; production audit0.

Оставшееся moderate-срабатывание относится к версии локального postcss-selector-parser6.1.4. Исправленный vendored код в этом PR не меняется; доказательство эквивалентности security-only upstream6.1.5 и негативные контроли — docs/audit-dependency-f20.md и scripts/check-selector-release-equivalence.mjs. Версия не переименована для скрытия scanner finding. Предлагается принять только описанное версионное срабатывание для этого выпуска; до следующего release/dependency change оно снова рассматривается. Это не допуск неизвестных high/critical или реальной неустранённой ReDoS.

## Проверки и ограничения

Последний локальный контроль точного кода: native2578/2578,13 PostgreSQL-наборов808/808 (каждый отдельным последовательным процессом), floor/types/lint/build/Gitleaks. При общей Node-команде ранее был180s timeout browser parent, без изменения лимита; локальная раздельная матрица проходит. Первый настоящий GitHub PG gate в этом выпуске ещё выполняется. Scanner/CI результаты записываются перед merge; наличие review не заменяет зелёные gates.

Независимое инженерное review не нашло нарушений web/schema33 и скрытого запуска миграций/финансовых процессов. Прямые HTTPS/SSH с этой машины пока дают тайм-аут; это не подтверждение состояния сервера. Внедрение считается проверенным только после успешного deployment/confirmation и сверки actual commit/BUILD_ID/health/readiness. Ошибка deploy/confirmation требует чтения статуса и штатного rollback, не объявления готовности.

Просроченный пересмотр PAYMENT-PG18-ADMIN-20261020 не продлевается этим выпуском: его predicate и текущая установленная служба не обновляются. Новый financial runtime и production-схема54 не допускаются. Отдельные финансовые и эксплуатационные пункты аудита остаются открыты.

Основание запроса: CONSTRAINTS.md:47 — «Изменения самого guard/workflows … обязательно проверяются человеком»; там же запрещены новые исключения без решения владельца и оценки риска. Решение владельца Данила11.11.2026: «Одобряю пакет и выпуск после остальных CI». Допуск ограничен описанными PR/payload/ошибкой; до успеха остальных проверок merge не выполняется. Дополнительную модель владелец пропустил.
