# Зависимости и граница установки

Проверено 08.10.2026. Повторный разбор открытых advisory: **14.10.2026**, либо раньше при появлении исправлений, изменении сборочного контура или входных данных. Владелец решения по остаточному риску — сопровождающий проекта. Эти изменения не являются разрешением коммерческого запуска или подтверждением безопасности всего приложения.

## Что изменено

Корень проекта использует npm и единственный `package-lock.json`; CI использует Node.js 22 и `npm ci`. Major-версии Next.js/ESLint/Tailwind и существующие overrides не изменены. В `package.json` минимальная версия Next.js и соответствующего `eslint-config-next` поднята с `^15.5.24` до `^15.5.27`. Отдельный совместимый backport добавляет прямую dev-зависимость `postcss-selector-parser: file:vendor/postcss-selector-parser`, без override; остальные диапазоны сохранены. Обновления:

| Зависимость | Было → стало | Основание |
| --- | --- | --- |
| Browserslist | 4.28.2 → 4.29.3 | Исправления ограничения кэша и обработки custom statistics доступны с 4.28.7; текущая 4.x включает последующие исправления. |
| baseline-browser-mapping | 2.10.32 → 2.11.27 | Начиная с 2.11.0 неверные параметры больше не вызывают `process.exit()`. |
| brace-expansion | 1.1.18 → 1.1.21; 5.0.9 → 5.0.12 | Совместимые ветки исправляют рекурсию, неконтролируемое расширение и квадратичную обработку диапазонов. Это **другой пакет**, не `braces` ниже. |
| postcss-selector-parser | 6.1.2 → опубликованная 6.1.4 → локальная 6.1.4 с backport | Обновление registry-пакета исправило сериализацию, но не квадратичную обработку. Затем в локальную копию перенесены только три защитных изменения официального исправления; версия не маскируется под 7.1.6. |
| Next.js и eslint-config-next | 15.5.24 → 15.5.27 | Официальное security-обновление ветки 15.5; связанные `@next/env`, `@next/eslint-plugin-next` и восемь платформенных SWC-пакетов обновлены до той же версии. |

Источники Browserslist: [ограничение кэша](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [custom statistics](https://github.com/advisories/GHSA-73wf-gq98-2v4g), [4.28.7](https://github.com/browserslist/browserslist/releases/tag/4.28.7), [4.29.3](https://github.com/browserslist/browserslist/releases/tag/4.29.3). Источники baseline: [advisory](https://github.com/advisories/GHSA-w5vr-8v7q-w6rv), [2.11.0](https://github.com/web-platform-dx/baseline-browser-mapping/releases/tag/v2.11.0), [2.11.27](https://github.com/web-platform-dx/baseline-browser-mapping/releases/tag/v2.11.27).

Источники brace-expansion: [рекурсия](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p), [расширение](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [обработка диапазонов](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr). Источники парсера: [рекурсивная сериализация](https://github.com/advisories/GHSA-w9m9-85wc-3x92), [6.1.3](https://github.com/postcss/postcss-selector-parser/releases/tag/6.1.3), [6.1.4](https://github.com/postcss/postcss-selector-parser/releases/tag/6.1.4).

Обновление Browserslist также обновляет совместимые browser-data leaf-зависимости: `caniuse-lite` 1.0.30001815, `electron-to-chromium` 1.5.449, `node-releases` 2.0.57 и `update-browserslist-db` 1.3.3. `caniuse-lite` используется и production-графом, поэтому не все изменения lockfile помечены `dev`. `node-releases` требует Node.js ≥18, что совместимо с Node.js 22 проекта. Отдельное обновление Next.js меняет только 12 пакетов его семейства и объявления корневого пакета в lockfile, без добавления или удаления зависимостей. Optional-диапазон Sharp в Next.js поднят с `^0.34.3 || ^0.35.3` до `^0.34.3 || ^0.35.4`; существующий override и версия Sharp 0.35.5 сохранены.

Первый этап обновления leaf-зависимостей снизил полный `npm audit` с **11 пакетов (9 high, 2 moderate) до 9 пакетов (7 high, 2 moderate)**. Свежая проверка 08.10.2026 обнаружила ещё два advisory установленного Next.js 15.5.24: полный audit стал **10 пакетов (7 high, 3 moderate)**, production audit — **1 moderate-пакет**. После обновления Next.js до 15.5.27 полный audit вновь сообщил **9 пакетов (7 high, 2 moderate)**, а `npm audit --omit=dev` — **0**. После чистого npm ci с selector-backport свежие результаты **такие же: полный 9 (7 high, 2 moderate), production 0**. Это число пакетов, включая транзитивные meta-advisory, а не число независимых уязвимостей. Локальный backport проверяется исходниками и регрессиями: audit всё ещё отмечает неизменённую 6.1.4 и не анализирует перенос patch. Открытый `braces` требует отдельного исправления. Production gate и Dependency Review в CI не ослаблены. Отсутствие известных advisory не доказывает отсутствие вредоносного кода или новых уязвимостей.

### Next.js 15.5.27: граница проверки

[Официальный релиз 15.5.27](https://github.com/vercel/next.js/releases/tag/v15.5.27) включает исправления [GHSA-4jqv-mc3x-m676](https://github.com/vercel/next.js/security/advisories/GHSA-4jqv-mc3x-m676) и [GHSA-mcj8-r9mp-w47p](https://github.com/vercel/next.js/security/advisories/GHSA-mcj8-r9mp-w47p), а также отдельное исправление metadata image routes. Публикация и точные версии проверены в официальном npm registry; lockfile содержит HTTPS-адреса и integrity для всех обновлённых пакетов.

Первый cache-poisoning advisory требует Pages Router и SSG/ISR; второй — корневой catch-all вместе с SSG/ISR. В проверенной конфигурации приложение использует `src/app`, каталогов `pages`/`src/pages` и корневого catch-all нет. Это контрдоказательство достижимости этих конкретных сценариев в текущем приложении; эксплуатация HTTP-пути проекта не заявляется. Обновление сохраняет поддерживаемую ветку 15.5 и устраняет известные затронутые версии из production-графа.

Проверка исправления использует реальный установленный модуль `next/dist/server/lib/match-next-data-pathname` и [официальный patch чувствительности служебного маршрута к регистру](https://github.com/vercel/next.js/commit/785f4c2397f25690edf02b5a9f1cd7deaa1abb6d): штатный `/_next/data/build-id/index.json` распознаётся на обеих версиях, три варианта регистра отклоняются только на 15.5.27. Результат — RED на 15.5.24 и GREEN на 15.5.27; это ограниченная regression-проверка upstream matcher, а не воспроизведение HTTP-эксплуатации проекта. В отдельном worktree на Node.js 22.23.1 пройдены **583/583 теста без пропусков**, реальная `next build` (**58/58 страниц**), `npm run lint` и отдельный `tsc --noEmit --incremental false`. Lint сохраняет прежнее предупреждение о неиспользуемой переменной в `tests/checkout-prerequisites.test.cjs`. Установка выполнена с `ignore-scripts=true`, native Sharp 0.35.5 успешно кодирует PNG без lifecycle hooks; install policy и CI не изменены.

## Build/dev advisory: исправление, достижимость и ограничения

### `braces` 3.0.3 — HIGH, GHSA-vfj7-8cjw-p6xm

[Первичный advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) указывает затронутые версии ≤3.0.3 и **отсутствие исправленного релиза**. Глубоко вложенная brace-структура может исчерпать стек при рекурсивной обработке AST. Обновление `brace-expansion` не исправляет этот пакет.

Реальный путь сборки: `tailwind.config.ts` → `tailwindcss/lib/lib/content.js` → `fast-glob` → `micromatch.braces(..., {expand: true})` → `braces`. В текущем конфиге content задан репозиторием: `./src/**/*.{js,ts,jsx,tsx,mdx}`. Инструментированный запуск настоящего Tailwind с этим конфигом и текущими исходниками подтвердил вызов `braces`. В dev/watch существует дополнительный путь `chokidar` → `braces.expand()`.

`eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` также попадает в meta-advisory. Его glob-вызов в `get-root-dirs.js` условен: нужен `settings.next.rootDir`; текущий `eslint.config.mjs` не задаёт этот параметр. Это контрдоказательство для одного lint-пути, но не исключение реального Tailwind-пути.

Непосредственного импорта этих парсеров из HTTP/application-кода `src` или `scripts` не найдено. В проверенной конфигурации вход — исходники/имена файлов и настройки сборки, а не параметр публичного HTTP-запроса. Однако автор недоверенного PR или иной участник, способный влиять на сборочные входы, остаётся потенциальным источником DoS. Сборка с ограниченным временем CI и без production-секретов уменьшает последствия, **не устраняет уязвимость**.

Безопасное совместимое обновление сейчас недоступно. Предложения npm перейти на Tailwind 4 или изменить major `eslint-config-next` не применены автоматически. Нужен отдельный проверенный upstream fix/backport либо согласованное обновление/замена потребителей; до этого advisory остаётся открытым.

### `postcss-selector-parser` 6.1.4 — локальный backport GHSA-rj75-hqrm-r3gf

[Первичный advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) классифицирует квадратичную обработку плоских селекторов как **moderate** (CVSS 5.9), затрагивает версии <7.1.6 и исправлен в 7.1.6. Защита глубины AST сама по себе не предотвращает этот сценарий. Не следует путать его с исправленной LOW-уязвимостью сериализации AST.

Реальный путь: `postcss.config.mjs` → Tailwind/PostCSS → `tailwindcss/lib/util/prefixSelector.js`, `expandApplyAtRules.js` и другие преобразования селекторов → `postcss-selector-parser`; `postcss-nested/index.js` также вызывает парсер. Инструментированный запуск настоящего Tailwind подтвердил вызовы парсера на текущих исходниках.

Tailwind 3.4.19 требует `postcss-selector-parser ^6.1.2`, а `postcss-nested` 6.2.0 — `^6.1.1`. Исправленная 7.1.6 находится **вне обоих диапазонов**. Принудительный major override не добавлен: v7 меняет также итерацию AST, используемую Tailwind. Опубликованная 6.1.4 сама по себе не исправляет данный CPU-DoS.

Из [официального исправления 62b1917](https://github.com/postcss/postcss-selector-parser/commit/62b191792df0a0bc56062e5a875bc74aae2a51cd) перенесены только три изменения `Set` в `dist/parser.js`: устранение квадратичной дедупликации и проверка принадлежности индексов интерполяции, классов и ID через Set. Итерация Container и другие изменения v7 не переносились. Основой служит опубликованный MIT-пакет 6.1.4, проверенный по registry SHA512 integrity и SHA256 tarball. Из 37 опубликованных файлов **35 побайтно неизменны**; исключения — эти три изменения parser и удаление единственного `scripts.prepare` в его manifest. Точные исходные/локальные хэши и основание исключений записаны в `vendor/postcss-selector-parser/SECURITY-PROVENANCE.json`.

Версия остаётся `6.1.4`; это проектный backport, не новый upstream-релиз. npm 9.2.0 с существующим `install-links=true` копирует локальный каталог в обычную `node_modules`-зависимость ([семантика install-links](https://docs.npmjs.com/cli/v9/commands/npm-ci/#install-links)). Сгенерированный npm lock меняет только корневое объявление и существующую запись парсера на `resolved: file:vendor/postcss-selector-parser`; нет новых nested/registry-копий. После чистого `npm ci` реальный `createRequire` из обоих потребителей разрешает один и тот же модуль, все 37 установленных файлов совпадают с локальными. Manifest и lock при `npm ci` не меняются. В этом графе полный `npm audit` **по-прежнему сообщает** advisory парсера и meta-advisory `postcss-nested` по версии 6.1.4. Audit не проверяет локальные изменения исходника; в других графах `file:`-источник может вовсе отсутствовать в отчёте, и такое исчезновение тоже не доказывает исправление. Никакая версия не подменена для сокрытия advisory.

До patch реальная установленная registry-версия провалила три адаптированных [upstream complexity-теста](https://github.com/postcss/postcss-selector-parser/blob/62b191792df0a0bc56062e5a875bc74aae2a51cd/src/__tests__/complexity.mjs): для 60 000 атомов `.a`, `#a`, `#{a}` отношение к штатному контролю было **28.21 / 12.06 / 16.38**, при трёх прошедших grammar-контролях. После patch те же healthy-проверки требуют отношение **<2**. Три отдельные проверки одиночных rollback в памяти ожидают деградацию **≥2** и проходят как отрицательные контроли; это не assertion-killed мутанты. Дополнительно реальный rollback дедупликации на диске уронил **неизменённую healthy-проверку с exit 1**, отношение **15.88**; нормальные AST-контроли работали. После обратного patch SHA256 установленного parser снова точно совпал с локальным: `fbc108e74e76772305736f3e33e22aa51d31abd1884ac9d66f14a59eb4e699a3`.

Регрессии также проверяют ведущие class/ID, 20 000 узлов AST, escapes, attributes, combinators, pseudos и Sass, реальные Tailwind prefix/variant/`@apply` и postcss-nested. Каждый benchmark ограничен отдельным процессом до 25 секунд; используются три замера и контроль на той же машине, а не произвольный wall-clock порог. Узкое исключение `--ignore-pattern 'vendor/postcss-selector-parser/**'` в lint сохраняет байты скомпилированного лицензированного upstream-кода; весь собственный код и новый тест остаются в lint. Хэши, review трёх hunks и runtime-регрессии заменяют только неприменимые app-style правила, не проверки безопасности.

После frozen npm ci на Node.js 22.23.1/npm 9.2.0 пройдены **13/13 selector-проверок**, полный native suite **611/611 без пропусков**, реальная Next.js 15.5.27 сборка **58/58 страниц**, отдельный `tsc --noEmit --incremental false` и lint (**0 ошибок, 1 прежнее предупреждение** в `tests/checkout-prerequisites.test.cjs:30`). Это локальная проверка без live app/provider/production-вызовов; не проверка платёжного провайдера или всех deployment-платформ. Свежие production/full audit приведены выше, полный audit не объявляется зелёным.

Проверенный вход — CSS/генерируемые классы из исходников сборки. Прямой request → selector parser путь не обнаружен; эксплуатация HTTP-пути не заявляется. Backport устраняет проверенный механизм квадратичной обработки в текущем dependency-графе, но не подтверждает безопасность всех CSS-входов или всего парсера. Будущий импорт внешних стилей/генерация CSS из пользовательского ввода, новая копия парсера, обновление npm/потребителей либо замена vendor требуют повторить проверку достижимости, provenance, runtime-разрешения и регрессий.

## Политика установки

Проектная `.npmrc` задаёт `ignore-scripts=true`; для текущих registry-зависимостей и root проверена блокировка `preinstall`/`install`/`postinstall`. Согласно [официальной документации npm 9](https://docs.npmjs.com/cli/v9/using-npm/config/#ignore-scripts), явные `npm run build`, `npm run dev`, `npm run lint` и другие выбранные команды выполняют предназначенный script, но не автоматические pre/post-hooks. Та же семантика документирована для [npm 10](https://docs.npmjs.com/cli/v10/using-npm/config/#ignore-scripts). Однако реальная проверка ниже обнаружила исключение локального directory `prepare`: нельзя обобщать эту границу на любой источник пакетов.

Первое приобретение реального `file:vendor/postcss-selector-parser` на npm 9.2.0/pacote 15.0.7 **попыталось выполнить `prepare`, несмотря на `ignore-scripts=true`, и завершилось exit 127**: `del-cli` отсутствовал. Опубликованный пакет уже содержит `dist`, а `src` для rebuild отсутствует. Непосредственно проверенный `_prepareDir` установленного pacote вызывает `prepare` без проверки ignoreScripts. Единственное согласованное изменение metadata — удаление этого `scripts.prepare`; остальные scripts/dependencies/version/license не изменены, lifecycle не включался и build-инструменты пакета не устанавливались. После удаления реальная установка и frozen `npm ci --ignore-scripts --offline` проходят, 37 файлов сохраняются, npm CI log не содержит lifecycle run. Синтетическая tarball-проверка `postinstall` **не проверяла** directory `prepare` и не была доказательством этой более широкой гарантии.

Это default-deny граница **установки**, не sandbox и не защита от дефектов compiler: явная сборка всё равно выполняет установленный код. CLI/env могут переопределить настройку; установка вне корня проекта не защищена этой `.npmrc`. Не устанавливайте реальные зависимости с глобальным `--ignore-scripts=false`. Если будущий пакет требует install-hook, сначала проверить точную версию, тип источника и код hook в отдельном контуре и согласовать узкое решение, не отключая политику для всего графа. При обновлении npm проверить семантику и повторить регрессионные тесты.

`tests/npm-install-policy.test.mjs` устанавливает только локальный синтетический tarball в собственный временный каталог, offline, с пустыми user/global npm-конфигами. Реальная установка доказывает блокировку `preinstall`/`install`/`postinstall` у root и dependency; явный `npm run build` работает без `prebuild`/`postbuild`. Отрицательный контроль разрешает lifecycle **только у этого безопасного fixture**, чтобы доказать, что hooks действительно могли бы исполниться.

Чистый `npm ci` с проектной политикой проверен на Node.js 22/npm 9.2.0. Sharp 0.35.5 загружает установленный optional prebuilt-бинарник и выполняет синтетическое PNG-кодирование без install-hook. Это проверка текущей Linux-архитектуры, не гарантия для иных OS/архитектур. Полная сборка и регрессионные тесты обязательны после изменений lockfile; для CI не требуется включать lifecycle-скрипты.

Команды повторной проверки (в изолированном окружении без реальных ключей):

```bash
npm ci
node --experimental-strip-types --test tests/*.test.mjs tests/*.test.cjs scripts/test-*.mjs
npm run lint
npm run build
npm audit --omit=dev
npm audit # ненулевой: braces открыт; selector backport всё ещё отмечается по версии 6.1.4
```

Не применять `npm audit fix --force` и не подменять полный audit production-only результатом. На следующем разборе проверить новые релизы/advisory, реальные входы CSS/glob и совместимость исправлений; подтверждение нулевого production audit не закрывает риски build/dev-графа.
