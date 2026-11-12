# Исправление подготовки GitHub runner: Ubuntu mirrors

Кандидат для просмотра, ещё не применён. Точный [patch](ci-apt-mirrors.patch) от базы main `0e1bc60d0b824b352695c7d92525fae4a3e31b77`: два workflow, один12-строчный CI-only helper и восемь новых тестов. Существующие тесты и guard не изменяются.

## Подтверждённая причина

PR128 слит после зелёных обязательных проверок: native2578/2578, PostgreSQL808/808, CodeQL, security, layouts, build, standalone package и production audit0. Локальный main и origin/main совпали; дерево проверенного PR совпало с merge без дополнительных исходников.

[Deployment43032131256](https://github.com/Danil-super/blizhniy/actions/runs/43032131256) дважды остановился в установке Chromium: job130561592116 и повтор130568724768 завершились до запуска PostgreSQL. В обоих журналах `Temporary failure resolving 'azure.archive.ubuntu.com'`, затем apt exit100 и ошибка Playwright. Native и прочие gates прошли. Deploy/postchecks/finalize были skipped; серверная установка не начиналась. Эти инфраструктурные отказы не считаются зелёным CI и не покрываются исключением Dependency Review.

## Изменение

Перед первым apt/browser использованием в validate, category_heroes и postchecks вызывается один helper. Он разрешает выполнение только при GITHUB_ACTIONS=true, RUNNER_OS=Linux, RUNNER_ARCH=X64 и RUNNER_ENVIRONMENT=github-hosted; иначе отказывает до sudo. Требует штатный /etc/apt/apt-mirrors.txt, затем заменяет только его содержимое двумя официальными HTTPS mirrors: archive.ubuntu.com priority1 и security.ubuntu.com priority2. Неподдерживаемая конфигурация или ошибка записи останавливают job.

Сохраняются источники пакетов, Signed-By/keyring, проверка подписей/TLS, `playwright install --with-deps chromium`, исходные13 PostgreSQL-наборов, все assertions, timeouts, scanners, обязательность gates, SSH-проверки и rollback. Нет retries/if/continue-on-error/нового исключения scanner. На VPS helper не вызывается и при штатной production-среде отказывает; БД, права, ENV и службы не меняются. Это выбор официальных зеркал на временной CI-машине, а не пропуск установки зависимостей.

Официальные основания: [конфигурация runner-images](https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh) задаёт эту mirrorlist с первым Azure; [Ubuntu apt-transport-mirror](https://manpages.ubuntu.com/manpages/noble/man1/apt-transport-mirror.1.html) определяет URI/priority; [переменные GitHub runner](https://docs.github.com/en/actions/reference/workflows-and-actions/variables) определяют ограничения среды. Context7 Playwright подтвердил назначение --with-deps; документация не заменяет фактический CI.

## Проверки кандидата

На private-копии source:23/23 focused (восемь новых, прежние PostgreSQL gate/layout/SSH workflow проверки), floor clean, lint нового теста, bash -n и staged Gitleaks без находок. Дополнительно три mutation controls обнаруживают снятие fence, HTTP mirror и отсутствие подготовки postchecks. Проверки выполняются с изолированной mirrorlist и строгой sudo-stub; /etc локальной машины и ручной сайт не изменяются. Существующий опубликованный runtime не переисполнялся; реальная установка пакетов на GitHub требует следующего CI. Инженерное ревью кандидата — без замечаний.

## Допуск выпуска

Нужно одобрение этого точного diff и публикации после всех обязательных CI. Весь runtime/dependency payload остаётся от0e1bc60, единственные executable добавления — закреплённые четыре файла ниже, плюс docs-only журнал. Production-границы прежнего [пакета](audit-production-release-20261111.md) сохраняются: schema0033/текущие ENV, без миграций/GRANT/новых служб/флагов/LIVE/замены финансового worker.

Предлагаемый разовый DR-UNAVAILABLE-APT-20261111 относится только к одному следующему PR с этим точным кандидатом и базой0e1bc60 (номер и окончательный SHA фиксируются после создания). Он разрешает только точную прежнюю ошибку `Dependency review is not supported on this repository` при неизменных manifests/lock и зелёных Validate app, layouts, security и CodeQL на конечном HEAD. Другие ошибки не допускаются. Исключение PR128 не переиспользуется, workflow Dependency Review остаётся включённым. Допуск прекращается после этого единственного выпуска; владелец Данил. Предлагается сохранить допуск прежнего описанного version-based moderate-срабатывания selector-parser backport только для этого продолжения выпуска; до следующего release/dependency change оно вновь рассматривается. Новых зависимостей или scanner exceptions кандидат не добавляет.

После одобрения: применить точный patch, повторить проверки, новый PR/окончательный CI, слияние и обычный deployment с проверками commit/BUILD_ID/health/ready и host confirmation. Пока установка не подтверждена, production не называется обновлённым.

| Файл/артефакт | SHA256 |
|---|---|
| `.github/workflows/ci.yml` | `9b264fe3eac9b82492d32b76841b1b1699756dc1dbb3897cd56f0648f57d6ff3` |
| `.github/workflows/deploy.yml` | `5c67a7e1313bd68b3a1ba3fa47cbcd17993bfb0f6de803ec0d8e7ec830945d27` |
| `scripts/prepare-ci-apt-mirrors.sh` | `8d0685d907a06d01c078ff55aca36417dc7697af82f3325efb1ee28a019fc89f` |
| `tests/ci-apt-mirrors.test.mjs` | `70e8412dbe2da9f8aea6b761b0328c4d94bcfb7107d80914ec712070457d76d4` |
| `ci-apt-mirrors.patch` | `f314795f4d5eb6af19da9a8deccd6d52057e3f50b214ede4642b474d3ba30183` |

CONSTRAINTS.md:47: «Изменения самого guard/workflows … обязательно проверяются человеком». Прежние согласования не охватывают новые байты workflow; до решения владельца кандидат не применяется и не отправляется.

Владелец Данил11.11.2026: «Одобряю точный diff и выпуск после CI». Решение относится к описанному дополнению и единственному следующему PR; дополнительная модель не выбрана, инженерное ревью выполнено. После публикации номер/конечный SHA и результаты фиксируются в журнале выпуска.
