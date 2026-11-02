# F16 — CSP для HTML

Локальный инкремент от `a24f5f1`, начат 31.10.2026, приёмка продолжена 01.11.2026. Отсутствие HTML CSP воспроизведено на действительном локальном ответе, без заявления об обнаруженной XSS в пользовательском поле. API уже возвращает собственную deny-all policy; она сохранена.

## Политика и nonce

`src/middleware.ts` создаёт отдельный 192-bit nonce через Web Crypto для каждого SSR/Flight запроса. Входящие `x-nonce`, CSP и report-only policy не определяют доверенный nonce. Next получает policy в request headers и автоматически назначает nonce своим framework, bundle и inline Flight scripts. Собственный JSON-LD получает тот же nonce. Динамические загрузчики Turnstile и 2GIS берут nonce из свойства уже отрисованного script в документе, а не из URL/формы; после клиентской навигации используют nonce текущего документа.

`RootLayout` уже использовал `connection()` и request headers до этого инкремента. Нового перехода со статической генерации на SSR нет. HTML с nonce имеет private/no-store; API, `/_next/`, изображения, шрифты, assets и metadata исключены из middleware. Исключения не основаны на произвольном расширении HTML URL. Клиентские prefetch headers не отключают CSP.

Браузерная проверка выявила крайний случай Next 15: `Next-Router-Prefetch: 1` без `RSC: 1` заставлял full-document renderer работать с неполным деревом и выдавать `location is not defined`. Добавлены RED regression и узкая нормализация: только без RSC удаляются два router-prefetch hint. Настоящий Flight сохраняет заголовки, а `Purpose` и контекст авторизации не меняются. Важно: Next 15 скрывает и затем восстанавливает Flight headers вокруг middleware, поэтому одного middleware недостаточно. Локальная нормализация выполняется во входном прокси **до** Next. Аналогичное правило подготовлено в `deploy/Caddyfile.example`; live Caddy не менялся. Перед выпуском его надо перенести в действительную конфигурацию и проверить `caddy validate`/HTTP на staging. Локальная приёмка не доказывает установку этого правила на рабочем сервере.

Production по умолчанию использует `BLIZHNIY_CSP_MODE=report-only`; для применения запретов нужен явный `enforce` после наблюдения. Неизвестный режим закрывает страницу 503, режим `off` отсутствует. Локальный primary launcher явно выбирает `enforce` для ручной проверки. Report-only сообщает о нарушении, но не блокирует код; он не выдаётся за enforced защиту рабочего сайта. Push/deploy и production env не изменялись.

Script policy требует nonce и `strict-dynamic`, запрещает inline event handlers и не разрешает `unsafe-inline`/`unsafe-eval` для production JS. `unsafe-eval` существует только для development/HMR. `object-src` и `base-uri` запрещены, form-action и frame-ancestors ограничены своим сайтом. Стили сохраняют `unsafe-inline`: существующие React transforms и SDK карт используют inline styles. Это известная граница текущего инкремента, без разрешения inline JavaScript.

Ресурсы ограничены своим origin, нужными data/blob images/workers, Turnstile и доменами провайдера 2GIS. Wildcard относится к доменам 2GIS, общего `*`/`https:` разрешения нет. Отдельный HTTPS/WSS origin legacy backend добавляется только при реально выбранном legacy режиме; PostgreSQL режим игнорирует даже оставшийся старый URL. Валидный URL со slash нормализуется, credentials/path/query/fragment не допускаются. HTTP loopback разрешён только для development, сохраняя прежний локальный сценарий; production требует HTTPS. Telegram OIDC и YooKassa используют top-level navigation и серверный обмен, новых общих connect/frame разрешений для них нет.

## Отчёты без URL и персональных данных

`POST /api/csp-report` принимает недоверенные браузерные наблюдения. Проверяются Host, origin/fetch metadata и тип `application/csp-report`. Ограничения: 8 KiB, 64 чанка, 1 секунда чтения, до четырёх in-flight bodies и 240 приёмов в минуту на процесс. Эти бюджеты не расходуют auth/IP/email/global counters и не требуют БД. Они ограничивают затраты и достоверность диагностики, а не подтверждают автора отчёта. После перезапуска/при нескольких процессах бюджеты независимы.

В журнал попадают только фиксированные directive/disposition и категория inline/eval/url/other, с меткой `untrusted-browser`. Для каждой пары directive/disposition — не чаще одного события в минуту; память ограничена 36 ключами. Document/source/blocked URL, referrer, nonce/original policy, script sample, IP, cookies и личные данные не сохраняются и не выводятся. Raw JSON существует только в ограниченном чтении запроса. Невалидные UTF-8/JSON отклоняются; некооперативный body cancellation не удерживает обработчик после deadline. При переполнении — 429, при сбое audit sink — пустой 503. Это best-effort наблюдение в существующем журнале, не неизменяемый журнал безопасности.

Использован совместимый `report-uri`; современный Reporting API не подключён. `report-uri` deprecated, но пока поддерживается браузерами; при будущем подключении `report-to` нужно отдельно согласовать тот же origin/формат/приватность. `report-sample` не используется.

## Проверки

```sh
npm test
npm run lint
npm run check:types
npm run check:floor -- --base a24f5f1
npm run test:postgres:local
node --experimental-strip-types --test tests/bootstrap-postgres-integration.mjs
npm run build
# После запуска своего primary стенда:
node --experimental-strip-types scripts/check-local-html-csp.mjs
node scripts/check-local-csp-report-only.mjs
node --experimental-strip-types scripts/check-local-pending-recovery.mjs
node --experimental-strip-types scripts/check-local-normalized-avatar.mjs
```

Проверенный Node 22.23.1. Общий PG runner удаляет `.next`, поэтому окончательная сборка и запуск выполняются после него. Графы обновляются только для текущего корня. Старый CAPTCHA fixture дополнен выполнением настоящего nonce helper в том же DOM context; прежние assertions readiness/expiry/replay сохранены. Guard/workflows, зависимости и grants не менялись.

Локальная приёмка завершена 01.11.2026:

- Native 2358/2358, без skip; types/lint/floor и production build прошли. Прежнее lint-предупреждение `targetType` сохранено.
- Настоящий PostgreSQL/browser 137/137, bootstrap/ACL/payment 349/349.
- Enforce Chromium: 8 маршрутов, свежий nonce при reload, все executable SSR scripts с правильным nonce, реальная клиентская Flight-навигация и hydration, mobile menu, JSON-LD каталога и 404. Входящие nonce/CSP и prefetch hints не обходят политику. Анонимная API session по прежнему контракту отвечает 401 и сохраняет свой deny-all CSP.
- Подмена только собственного тестового HTML добавила no-nonce script и `onclick`: оба заблокированы, обычные React handlers работают, два отчёта приняты с 204. Это синтетическая проверка механизма, не доказательство уязвимости поля сайта.
- Отдельный реальный Next-процесс в report-only: тот же синтетический script выполняется и даёт report/204, hydration работает. Процесс создан с отдельным loopback port и без DB/provider credentials, затем остановлен.
- Восстановление pending аккаунта и crop/save/replace/reload/remove аватара прошли на primary стенде под enforce. В recovery fixture исправлена недетерминированная граница: два вызова clock_timestamp могли дать TTL чуть больше допустимого часа. Оба времени по-прежнему в прошлом, интервал между ними теперь 30 минут; assertions и production TTL не менялись.
- JS bundle по-прежнему отдаётся с `public, max-age=31536000, immutable`; изображению не добавлен no-store. На локальном Next у public image прежний `max-age=0`, без утверждения о production ingress cache.
- Удаление request CSP в mutation-проверке приводит к падению middleware regression. Исходник восстановлен побайтово; окончательная сборка сделана после восстановления. Graphify/Code Graph обновлены.
- Шаблон `deploy/Caddyfile.example` прошёл настоящий `caddy validate` 2.10.2 в одноразовом read-only контейнере без сети, с ограничениями памяти/процессов. Образ зафиксирован digest `sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb`. Это синтаксическая/модульная проверка шаблона, а не проверка установленного ingress. Перед выпуском правило всё ещё нужно применить и проверить на настоящей версии Caddy/staging.

Изменения остаются локальными; стенд запущен на https://127.0.0.1:3045. Реальные Turnstile, 2GIS с рабочим ключом, Telegram token exchange и merchant не вызываются этими тестами. Рабочую конфигурацию, доступность каждого провайдера и период report-only наблюдения необходимо проверить перед production enforcement; локальная приёмка не подменяет этот этап.

## Источники решения

Актуальная документация Next 15 получена через Context7: [CSP/nonces](https://nextjs.org/docs/15/app/guides/content-security-policy), [middleware](https://nextjs.org/docs/15/app/api-reference/file-conventions/middleware). Дополнительно проверены [Cloudflare Turnstile CSP](https://developers.cloudflare.com/turnstile/reference/content-security-policy/) и [MDN report-uri](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/report-uri): nonce/strict-dynamic, разрешения iframe и недоверенный характер отчётов. Ограничения внешнего MapGL подтверждаются наблюдением перед enforcement, без автоматического добавления eval или широких источников.
