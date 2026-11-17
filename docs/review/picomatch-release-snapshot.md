# Picomatch:граница готового пакета и временный допуск

17.11.2026. Дополнение к уже согласованному [CI25](ci-validation-budget25.md).
[Точный новый patch](prebuilt-image-config-policy.patch):три файла, существующие
проверки не удаляются и не ослабляются. Защищённый кандидат ещё не применён.

## Находка остаётся настоящей и открытой

[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf),CVE-2026-112366:
Dependabot32,high. Advisory reviewed/updated17.11; affected<=4.0.7,patched:none.
Latest registry4.0.7 также затронут. Свежий npm audit:production0,полный1moderate
и0high/critical; его отставание не опровергает GitHub и не доказывает отсутствие
уязвимого кода в production.

В изолированных дочерних процессах +(*a) на30символах и финальном несовпадении
упёрся в1500мс у rootpicomatch2.3.2,Tinyglobby4.0.4 и next/dist/compiled/picomatch.
Следовательно это не только dev-риск:встроенная копия есть в Next15.5.28.
Ни alert,ни версия,ни результат scanner не маскируются. Библиотека этим пакетом
не исправляется.

## Достижимость и границы доказательства

Независимый ограниченный source-review не нашёл HTTP→glob pattern handoff.
В исходниках приложения прямых вызовов picomatch/micromatch/tinyglobby нет.
У Next runtime потребители — local/remote image helpers; остальные исследованные
прямые импорты относятся к build tracing и middleware allowDynamic validation.
Source next.config не задаёт images,assetPrefix или tracing globs; middleware
не задаёт unstable_allowDynamic. Tailwind/ESLint patterns фиксированы в репозитории.
Не найдено дополнительного installed compiled/micromatch bundle.

Это не доказательство безопасности библиотеки или всех вариантов CVE. Фиксированный
опасный шаблон тоже может быть атакуемым через совпоставляемую строку; ограничение
длиныURL не используется как защита. Нужна проверка фактически доставляемой
конфигурации, а не только исходного next.config.

## Точный защитный кандидат

Новый небольшой модуль читает JSON-строку const nextConfig из настоящего
standalone server.js без eval/исполнения. Принимает ровно одну строку и не более2МБ;
ошибки обобщённые, содержимое config не выводится. Требует assetPrefix='' и
images.localPatterns отсутствует; remotePatterns/domains — пустые массивы.
Отсутствующий, повреждённый или активированный matcher блокирует проверку.

Существующий check-prebuilt-runtime вызывает её до импорта/запуска модулей пакета.
В текущем CI перед этим уже проверяются архив/manifest и полная целостность;
после — сохраняются существующие health/WebP/PG/mail проверки. SSH ещё не доступен
этому job. PM2 запускает проверенный server.js; установленный emitter Next
присваивает эту же JSON-конфигурацию __NEXT_PRIVATE_STANDALONE_CONFIG и startServer.
Проверка действует в CI на готовом пакете, а не изменяет пользовательский интерфейс.

Кандидат4/4:позитивный default config; отрицательные missing/malformed/duplicate/
oversize/activated варианты; реальные bundled Next image helpers с атакующими
строками не вызывают makeRe ни разу; wiring в runtime gate. При удалении вызова
последний сценарий воспроизводимо падает. Независимое ревью повторило4/4 и не
нашло дефектов внутри trusted-builder/unchanged-emitter контракта.
Полный настоящий build/package/startup с новым guard ещё предстоит проверить CI;
при его отказе публикация запрещена. Все прежние проверки/тайм-ауты сохраняются.

## Предлагаемый явный временный допуск

PICOMATCH-SNAPSHOT-20261117:только эта unchanged dependency/config snapshot и один
следующий PR совместно с CI25 и данным guard. ВладелецДанил; повторный разбор не
позднее18.11.2026 20:00МСК и обязательно до следующего выпуска/изменения конфигурации.
Это не автоматическое отключение сайта в указанное время и не обещание будущего
самостоятельного исправления upstream. Любое изменение приведённых файлов,
Next/Tailwind/ESLint,glob-настроек,dependency lock,emitter или появление нового
web-controlled pattern отменяет вывод о текущей достижимости и требует нового review.

Допуск не закрывает Dependabot32 и не разрешает scanner failure,подавление high,
новые .ignore,отключение checks или произвольное обновление major. Все остальные
security/CI должны пройти; новый guard должен подтвердить фактический артефакт
до SSH. Если Trivy или другой обязательный scanner блокирует — выпуск останавливается.

Два узких допуска уже описанного CI25 для этого одного PR также остаются только
в явно согласованных границах:неподдерживаемый Dependency Review API и прежний
selector-parser moderate backport. Их срок17.11.2026 23:59МСК/merge/существенное
изменение пакета; новое решение по совокупному пакету требуется отдельно.
БД,роли,GRANT,секреты,LIVE,production-флаги и новые local-режимы не меняются.

Отдельный выбор владельца требуется поCONSTRAINTS.md:28 (исключения) и:47
(человеческий review нового guard). Предыдущие разрешения эту новую high-находку
и новый guard не покрывали. До решения merge/deploy приостановлены.

Снимок исходников SHA256:

- package.json:`24cda736fb6947613db3eb1548aa3176c2d59d41c0e2f156b5451dac5e25ee6b`
- package-lock.json:`d59f0e00225bb57e0668af384850281ddafc8901013ab648b1737979b819650f`
- next.config.ts:`64f94c6e79f5aecfce13f7b4c07bbc992df3a98e5d233a64f572b16f3ea779ef`
- tailwind.config.ts:`f7acc04e585c405c269a3fcaf66cf48bb29e57276afc46e70f863cf68908368b`
- eslint.config.mjs:`8304dadf70f5de3e2f27d9ca0540f6b367ade73ca9ed6536041c0056fa7420fe`
- src/middleware.ts:`408014be8354144ca506901c06ab3e93f7df6e731dc6aabbf4c09bcb0a3e90f5`

## Решение владельца

17.11.2026: «Одобряю guard, временный допуск и выпуск после CI; доппроверку
пропустить». Разрешены точный защитный patch и совокупный выпуск CI25 с
PICOMATCH-SNAPSHOT-20261117 и двумя уже описанными узкими допусками CI25.
Условия неизменённой snapshot/флагов и остальных зелёных CI сохраняются.

После применения:2956/2956 native без skips/cancel, fast успешно (одно прежнее
unused targetType предупреждение), оба графа обновлены. Три файла guard побайтно
совпали с рассмотренным кандидатом; шесть исходных dependency/config hashes
совпали с таблицей выше. Проверка фактического артефакта ещё ожидает CI.
