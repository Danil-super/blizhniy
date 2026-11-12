# Дополнение PR129: Chromium с обязательным запуском

Кандидат ещё не применён. Точный [patch](ci-browser-preflight.patch) от HEAD `50588dae861ec2fc3287612ce4656cc01e06bf33`; PR [129](https://github.com/Danil-super/blizhniy/pull/129), база main `0e1bc60d0b824b352695c7d92525fae4a3e31b77`.

## Что установлено по настоящему CI

[CI43038801041](https://github.com/Danil-super/blizhniy/actions/runs/43038801041) и повтор подтвердили DNS-отказ archive.ubuntu.com/security.ubuntu.com при apt-установке девяти дополнительных font/Xfont пакетов. Переключение зеркал не решило проблему. Последняя layout-задача130597762481 отказала при установке; validate130597763588 достиг20min во время apt, до PostgreSQL. Все обязательные gates остаются обязательными; неуспешные/отменённые jobs не засчитываются.

В журналах Ubuntu24.04 и26.04 библиотеки Chromium (libasound, libatk, libcairo, libcups, libdbus, libdrm/libgbm, libglib, libnspr/libnss, libpango, X11/XCB и др.), libfontconfig/libfreetype, fonts-liberation и fonts-noto-color-emoji уже установлены. APT пытался дополнительно скачать fonts-freefont-ttf, fonts-ipafont-gothic, fonts-tlwg-loma-otf, fonts-unifont, fonts-wqy-zenhei и четыре xfonts-пакета. Это наблюдение о текущих runner, а не обещание для будущих образов.

## Предложение и границы

Во всех трёх существующих местах browser setup используется один9-строчный helper: `npx playwright install chromium`, затем отдельный обязательный Node-процесс реально запускает headless Chromium и дожидается его закрытия. Ошибка скачивания, запуска, отсутствующих библиотек или закрытия останавливает job. Системные apt-пакеты больше не переустанавливаются на каждой CI-машине; работоспособность установленного браузера проверяется исполнением.

В установленном Playwright1.61 CLI install превращает host validation в warning (`coreBundle.js:67953`), поэтому одного install недостаточно. Добавленный launch сам проверяет runtime и не перехватывает ошибку. Нет PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS, ignore-certificate, continue-on-error или пропусков тестов. Стандартный способ отдельной [установки Chromium](https://playwright.dev/docs/browsers) сохранён; библиотеки будущего runner при нехватке будут блокировать CI. Поведение, зависящее от дополнительных системных шрифтов, до реальных layout/browser прогонов на GitHub не подтверждено.

Неуспешный mirror helper и восемь его тестов из ещё не слитого PR129 заменяются новым helper и семью проверками установки/реального JS preflight/ошибок/трёх callers. Эти старые кандидатные файлы отсутствуют в main. Все прежние business/browser/SQL suites main,13 PostgreSQL-наборов, assertions, deadlines, scanners, SSH trust, package integrity и rollback сохраняются. Ничего не устанавливается/не меняется на VPS или в БД; production-флаги/службы/LIVE сохраняют прежнее состояние.

Одно существующее ожидание argv отражает install без --with-deps и дополнительный Node preflight. Guard получает только одну точную before/after пару в одном файле с прежними проверками единичного количества. NODE_EXIT=17 действует только на --test, сохраняя прежнюю проверку отказа PG-набора; отдельный PREFLIGHT_EXIT=23 проверяет отказ нового preflight. Никакие существующие assertions не удаляются.

## Проверка кандидата

46/46 focused прошли в private worktree с кириллицей и пробелами: семь новых, прежние gate/layout/SSH и24 guard-проверки. Отдельный настоящий локальный helper скачивания/запуска/закрытия Chromium прошёл exit0. Все13 позиций отказа PG проверены после успешного preflight: exit17, никакой следующей suite. Пять проверок новой guard-пары разрешают только exact и отвергают иной путь, изменённую replacement, дубликат before и отсутствие after. Mutation controls обнаруживают подавление install/close ошибки и отсутствие реального launch. Lint, bash syntax, PR-base floor и staged Gitleaks проходят. Код приложения/зависимостей не меняется, повторный локальный DB-прогон этим кандидатом не заявляется.

Инженерное review нашло и проверило исправления двух проблем: fileURLToPath для местного пути и разделение Node failure injection, чтобы оно не теряло PG-покрытие. Reviewer самостоятельно повторил9 affected tests в пути с кириллицей/пробелами; других замечаний нет. Новому HEAD ещё предстоят полный native/PG/layout/build/security/CodeQL и реальный deployment/confirmation.

## Обновление допуска выпуска

Нужно решение владельца об этом точном patch и выпуске после всех обязательных CI. Предлагается DR-UNAVAILABLE-PR129-PREFLIGHT-20261111 только для PR129, базы0e1bc60 и закреплённых ниже байтов (плюс docs-only отчёт). Прежний DR-UNAVAILABLE-APT-20261111 не расширяется автоматически и заменяется только новым решением. Разрешается исключительно прежняя ошибка Dependency Review API «Dependency review is not supported on this repository» при неизменных package.json/lock и успешных Validate app, Validate category layouts, Security checks и CodeQL на окончательном SHA. Остальные ошибки не допускаются; сам Dependency Review workflow остаётся включённым. Допуск прекращается после одного этого выпуска; владелец Данил. Прежний описанный version-based moderate selector-parser backport предлагается сохранить только для этого продолжения выпуска; до следующего release/dependency change — новый review.

Production-профиль исходного согласованного выпуска сохраняется: существующие ENV/schema0033, без миграций/GRANT/активации новых локальных режимов, финансовых служб, замены установленного worker или LIVE. Совпадение source не означает включение этих режимов. До успешной установки и сверки commit/BUILD_ID/health/ready/postchecks/host confirmation сайт не называется обновлённым.

| Файл/артефакт | SHA256 |
|---|---|
| `.github/workflows/ci.yml` | `24425c1c7c57eb9a7e3d526796f40fbf942daf6361eb3769b604982d191c8c1f` |
| `.github/workflows/deploy.yml` | `1bcf2e8c3eeacee59a8915085797bb09437e3a2a7ba55cc316845127d46c4d6e` |
| `scripts/check-quality-floor.mjs` | `2eda7bb42e24122ecbeddabb5d23f94116ebb816355da30b690f15fb384acf5b` |
| `scripts/prepare-ci-browser.sh` | `4c2d525c50f8e8683195f9f5df4720ee7220cfcf41493faf4add9cfd0f61c3a1` |
| `tests/postgres-ci-gate.test.mjs` | `9a9b927bed55acda8ef26703dcd854090259644584775fee72d355ad87c50da7` |
| `tests/ci-browser-preflight.test.mjs` | `3a90525c6f0e4f8310fca535d13297feb512700c6ecff5dfbfa243f248aaa89f` |
| `ci-browser-preflight.patch` | `f23a86e209143797724d59aa513a8b9f3c11e246daca60984def90ecb0fd7dcf` |

CONSTRAINTS.md:47: «Изменения самого guard/workflows … обязательно проверяются человеком». Предыдущий одобренный diff содержит другие байты и не разрешает эту замену. До решения владельца кандидат остаётся отдельно, без применения/push.

Владелец Данил11.11.2026: «Одобряю замену и выпуск после CI». Одобрен только описанный точный patch и ограниченный выпуск PR129 после всех остальных обязательных проверок. Дополнительная модель не выбрана; независимое инженерное ревью выполнено.
