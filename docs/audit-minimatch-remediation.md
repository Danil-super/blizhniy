# DEP-MINIMATCH-20261101: исправление build-зависимости

Локально10.11.2026. [Официальный advisory GHSA-g3hv-75wg-m249](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249) указывает исправленную11.0.1. Ветка10.x исправленного релиза не предлагает; текущий опубликованный TypeScript ESLint также продолжает требовать10.x.

В установленном графе единственный потребитель minimatch10.2.5 — `@typescript-eslint/typescript-estree`. Его реальный вызов — `minimatch(filePath, pattern, {dot:true})` для allowDefaultProject. Он не использует удалённые в11 API makeRe/AST/regexp/matchOne. Поэтому добавлен только parent-scoped override на11.0.1, без глобального override, обновления ESLint/Next или смены TypeScript ESLint. Все nested minimatch3.1.5 и остальные locked packages сохранены. Lock изменяет одну прежнюю запись minimatch и добавляет только её matcher dependency `@isaacs/nonrecursive-glob-match`1.1.0 с registry integrity.

Это явный переход major внутри одного build-потребителя, а не объявление полной совместимости11 со всеми API10. Его область проверена непосредственно по вызывающему исходнику и `npm explain`. При расширении этого потребителя или замене его версии нужна повторная проверка совместимости. Upstream [changelog](https://github.com/isaacs/minimatch/blob/main/changelog.md) описывает удалённые API и изменения сопоставления; глобальное применение11 не выполнялось.

## Проверка

- RED на реальном модуле, разрешённом из TypeScript ESLint: шаблон с level2 превысил явно заданный budget16. Отдельный ограниченный child process предотвращает зависание/исчерпание памяти самого тестового runner.
- После frozen `npm ci --ignore-scripts` проходят3 проверки: ограничение amplification и большого попарного прохода по официальному fix, штатная glob-семантика и настоящий `@typescript-eslint/parser.parseForESLint` с projectService/allowDefaultProject для `.config.ts` вне tsconfig include. Проверяется доступный типизированный program и TS↔ESTree mapping.
- Бюджеты и сопоставление основаны на [официальном исправлении77a0f5c](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8). Версии не подменены, advisory не подавляется.
- Проверено, что остальные записи lockfile побайтно/структурно не менялись. Установка из неизменяемого lock завершилась, install scripts не запускались.
- Полный npm audit:7→1 moderate, high/critical0. Production audit0. Оставшаяся находка postcss-selector-parser относится к существующему проверенному локальному backport и сохраняется в отчёте по его версии; это не новое исключение и не обещание отсутствия других уязвимостей.

Итог:2562/2562 native,687/687 настоящих PostgreSQL/browser, frozen npm ci, floor/types/lint и production build проходят. Сохраняется единственное прежнее предупреждение targetType. Локальный HTTPS health/ready200 и HTML/Flight двух страниц кабинета совпадают с BUILD_ID `IPkCMMYcCqTUUU-wpETEk`. Production и реальные сервисы не изменялись. Изменения package/lock обратимы вместе; откат не требует БД.
