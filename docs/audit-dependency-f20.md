# F20: эквивалентность security backport

Проверено локально 01.11.2026. Production, зависимости, lockfile, workflows, исключения lint и действующие тесты не изменялись. Это не разрешение коммерческого запуска и не утверждение об отсутствии всех уязвимостей.

## Решение по исходному замечанию

PDF-аудит F20 допускает официальный 6.1.5 **либо воспроизводимое доказательство эквивалентности** установленного backport. Выбран второй вариант. Существующая локальная 6.1.4 не переименована в patched upstream: npm audit продолжает видеть её исходную версию. Сохраняются прежние проверки трёх complexity-регрессий, их отрицательные контроли, grammar/AST, настоящие Tailwind/PostCSS и разрешение одного модуля обоими потребителями.

[Официальная 6.1.5](https://github.com/postcss/postcss-selector-parser/releases/tag/6.1.5) — security-only релиз совместимой ветки для Tailwind3, commit `d90b6e38a0c79d07b02bf0d602bc242fe94be6b9`. [Advisory](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) теперь явно указывает patched6.1.5, а не только7.1.6. Смена major Tailwind или parser для этого исправления не нужна.

Проверен опубликованный npm archive, без установки и исполнения его lifecycle hooks:

- SHA512 SRI: `sha512-TEHFzb5KRDKaOgJ4TYE+0jyJtFbjLvkdVOu0fZ2b6MTWzoqZd4Le+61aEppWkvTlYePgOX4ATL1wsAIPMLTw6Q==`.
- SHA256 archive: `051db69e7aad989abddc95fef96f19f1da68ef6890ff834d0c40a7fb48b9751d`.
- Подпись npm проверена ECDSA-SHA256 над `name@version:integrity`, публичный ключ получен с registry `/-/npm/v1/keys`. Ключ и подпись публичные, это не секреты. Подпись registry подтверждает связь registry-identity с archive; не выдаётся за отдельную SLSA/Sigstore аттестацию процесса сборки.
- Все37 файлов archive сверены с certificate `docs/selector-upstream-6.1.5.json`; хэш inventory закреплён отдельным regression-тестом. Проверка archive связывает подписанный SRI с inventory, а не предполагает такую связь по одному JSON.
- Из37 файлов34 побайтно равны локальной копии. `dist/parser.js` отличается **только двумя точными блоками комментариев**. Их восстановление даёт точный SHA256 официального parser; произвольное удаление комментариев или нормализация JavaScript не используются.
- `package.json` отличается только `6.1.4 → 6.1.5` и отсутствующим локально `scripts.prepare`. Восстановление этих двух записей также даёт точный SHA256 официального manifest. Runtime dependencies, exports и main не различаются. Третий отличающийся файл — неисполняемый changelog; его локальные байты продолжают проверяться прежним provenance-тестом.

Новый regression проверяет vendor и реально установленную копию, точный inventory и отсутствие symlink/special-file обхода. Отдельный эксперимент в собственной временной копии изменил исполняемый Sass-filter: новая проверка упала; после восстановления прошла. Повреждённый tarball отклонён по digest до распаковки. Рабочие файлы vendor при эксперименте не менялись.

Таким образом доказана эквивалентность **поставляемого исполняемого кода**, а не только прохождение небольшого примера. Собственный backport остаётся обязанностью сопровождения; перед следующим обновлением сверять новый upstream и полный audit. Это закрывает исходный критерий F20 выбранным в PDF способом, но не обнуляет version-based npm findings.

## Воспроизведение

Из корня проекта на проверенном Node22 скачать только публичный pinned archive во внешний временный каталог, без `npm install`:

```bash
selector_proof_dir="$(mktemp -d)"
curl --fail --proto '=https' --max-time 30 \
  https://registry.npmjs.org/postcss-selector-parser/-/postcss-selector-parser-6.1.5.tgz \
  -o "$selector_proof_dir/selector-6.1.5.tgz"
node scripts/check-selector-release-equivalence.mjs "$selector_proof_dir/selector-6.1.5.tgz"
node --test tests/selector-upstream-equivalence.test.mjs tests/selector-parser-backport.test.mjs tests/npm-install-policy.test.mjs
npm audit --json
npm audit --omit=dev --json
```

Оператор выбирает собственный файл назначения; архив не должен перезаписывать чужой существующий файл. Verifier не извлекает файлы на диск: после проверки точного archive digest читает через `tar -xO` только37 закреплённых имён. Нет сети, установки, application/DB/provider writes. Offline signature verification использует закреплённый публичный ключ; актуальность/revocation registry-ключа повторно проверяется при новом онлайн-разборе. Успешная подпись не доказывает отсутствие вредоносного кода; для этого также проверены official source/release, реальные байты и регрессии.

## Новый отдельный advisory minimatch

Свежий полный audit01.11.2026: **15 moderate, 0 high/critical** —15 затронутых пакетов/meta-advisory, **два исходных advisory**, не15 независимых уязвимостей. Production audit: **0**. Один исходный finding — рассмотренный parser по версии; второй — новый [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), опубликованный в GitHub database30.10.2026, после PDF-аудита. [Старый braces GHSA-vfj7-8cjw-p6xm отозван23.10.2026](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): исторические9 findings в старой части dependency-security.md не являются текущим результатом.

В lockfile шесть вложенных `minimatch3.1.5` и корневой `10.2.5`. Новое предупреждение помечает версии `<11.0.1`, но описанный опасный путь требует `optimizationLevel >= 2` и влияет на рост `globParts` в `firstPhasePreProcess`.

Реальный корневой10.2.5 содержит эту ветку; она **не названа исправленной**. Старые3.1.5 не содержат данного метода. Прямых импортов/настройки minimatch в application `src`, scripts и конфигурации проекта не найдено. Найденный корневой потребитель `@typescript-eslint/typescript-estree/dist/useProgramFromProjectService.js` передаёт `{dot:true}`, т.е. default optimization1, и требует `projectService/allowDefaultProject`, не заданные текущим ESLint config. Это ограниченное контрдоказательство текущей достижимости, не вечная гарантия безопасности dependency.

Два независимых запуска настоящего полного ESLint с инструментированием установленных семи записей:18 вызовов make старой3.1.5, корневой10.2.5 preprocess0, **aggressive/level2 calls0**. Трасса не меняет возвращаемые значения, данные/паттерны пользователя не записывает. Статический поиск дополняет, а не заменяет эту ограниченную трассу. Она не покрывает все внешние tools, bundled matchers и будущие конфигурации.

Автоматическое предложение npm откатить ESLint до4.0.0 или eslint-config-next до0.2.4 не применено. Override всех старых majors на11 не совместим по контрактам и не добавлен. Advisory остаётся **открытым отдельным пунктом DEP-MINIMATCH-20261101**, без нового исключения severe gates и без решения владельца принять остаточный риск для выпуска. Следующий технический разбор — до08.11.2026, обязательно до релиза либо сразу при изменении lock/config/glob inputs; проверить совместимый upstream fix потребителей. Текущее отсутствие HTTP-пути не превращает полный audit в нулевой.

## Локальная приёмка

Артефакты текущего запуска: `$HOME/.cache/blizhniy-audit-f20/`. Focused **22/22**, полный native **2440/2440** без skips, production build, TypeScript, lint и floor прошли. В lint только прежнее предупреждение `targetType` в `tests/checkout-prerequisites.test.cjs:31`. Независимое ревью не нашло блокеров и повторило новые5/5 тестов и verifier archive. Успешный полный suite записан в `native.tap`, focused в `focused.tap`; ранний `equivalence.tap` сохраняет промежуточный RED fingerprint-теста и не является финальной приёмкой.

Graphify обновлён code-only для правильного project root (9568 nodes / 28175 edges; `.npmrc` исключён как потенциально чувствительный), Code Graph переиндексирован. Ручной стенд запущен с существующей локальной БД: `https://127.0.0.1:3045`, HTTPS health/ready200, actual PostgreSQL-ready/HTML/build probe прошёл для текущего `.next/BUILD_ID`. Старый PID из launcher-state уже отсутствовал; посторонние процессы не останавливали, запускающий сценарий использовал прежнее owned local state без сброса данных.

PostgreSQL/browser повторно не запускались: application implementation, SQL, grants, manifests/lock и runtime не менялись. Ранее полученные137/349 проверки не выдаются за новые результаты F20. Production release и сканеры CI этой локальной работой не выполнялись.
