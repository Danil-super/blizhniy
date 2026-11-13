# Мобильная главная: локальная проверка загрузки 13.11.2026

Продолжение [публичной приёмки](audit-public-release-readiness.md). Исправлены
передача сжатых ответов локальным стендом и выбор размера главной картинки.
Production, российские серверы и платёжные режимы не менялись.

## Исправление условий измерения

`scripts/local-primary-proxy.mjs` подменял Accept-Encoding на identity. При
этом на рабочем сайте READ ONLY проверка уже показала gzip у HTML и CSS.
Локальный стенд передавал CSS105502B, а после сохранения браузерного заголовка
передаёт18459B gzip. Декодированные CSS и JS побайтно совпали с identity;
Vary:Accept-Encoding и public/max-age31536000/immutable сохранены.

Удалена только подмена заголовка. Упреждающие проверки origin/host/ingress,
фиксированный loopback upstream3046, cookies, тела запросов и обработчики
сохранены. Node http/pipe передаёт кодированные байты без распаковки; заголовки
Content-Encoding/Content-Length/Vary остаются согласованы. Новые native-тесты
исполняют настоящий forwarding call с gzip, identity и отсутствующим
Accept-Encoding, CSS и JSON, проверяя тело, cookies и no-store.

Это исправление ручного стенда, а не включение gzip в production: там он уже
работал. Старые локальные total transfer/FCP/LCP измерены при identity и не
равны production gzip. Размеры Script по response.text и отсутствие SDK
по-прежнему описывают код, а не сжатый сетевой трафик.

## Изменение страницы

В `HomeIntro` заменён один sizes. Прежние180vw на экране412px приводили к
выбору w1920: оптимизатор отдавал1672px, хотя для реального object-cover
с DPR1.75 достаточно примерно1119px. Теперь выбирается1200px. На320px была
обратная проблема: блок444px высотой требует около1380px при DPR1.75, а
браузер получал1080px. Для узкого высокого блока оставлен больший размер.

Кадр, object-position62%, object-cover, разметка и текст, eager/high,
качество75 и оба исходных WebP сохранены. Desktop source и его sizes не
менялись; нижние карточки остаются lazy. На320px выросло количество пикселей
и байтов ради исправления прежней нехватки чёткости. Экономия для экрана412px
не выдаётся за экономию на каждом устройстве.

## Сопоставимые замеры

Тот же Chromium/Playwright, свежие contexts и отключённый cache. Mobile:
412×823, DPR1.75, CPU×4, заданные latency150ms и1638.4kbps; desktop:
1350×940, DPR1, CPU×1, latency40ms и10240kbps. По3 прогона на каждом этапе,
без одновременных сборок, native suites и других браузерных тестов.

| Этап | Mobile LCP, медиана | Mobile FCP, медиана | Desktop LCP, медиана |
|---|---:|---:|---:|
| Исходный локальный identity |4260ms|3240ms|580ms|
| Только исправленный proxy, прежняя картинка |3292ms|852ms|364ms|
| Gzip и исправленные sizes |1928ms|872ms|360ms|

Изолированный результат изменения страницы: mobile3292→1928ms, около−41%.
Все3 итоговых mobile прогона:2088/1928/1912ms. Главная картинка137430→71731B
в CDP encodedDataLength, около−48%; desktop85004B не изменился. CLS во всех
этапах mobile0.000254, desktop0.000524; JS errors и overflow отсутствуют.
Рост/снижение FCP на десятки миллисекунд после sizes не объявляется выигрышем.

## Проверки и границы

`check-local-home-image-sizing.mjs` проверяет21 точку:320/360/390/412/639/768/
1440px при DPR1/1.75/2. Он сверяет реальный WebP и число пикселей, учитывает
object-cover и предел исходника. Начальный RED обнаружил шесть неверных
сочетаний; итоговые21 прошли. Геометрия x/y/width/height изменилась на0,
object-position совпал во всех21 точках. Это выбранная матрица, не все
возможные шрифты, viewport, масштабирование или DPR. Первый setup JPEG
возник из-за отсутствующего Accept у API-клиента проверки; запрос теперь
явно соответствует WebP-браузеру, правила приложения не ослаблялись.

Native2715/2715 с test-concurrency4, fast/build прошли; прежнее lint
предупреждение targetType осталось. Первоначальный одновременный запуск
полного suite и браузеров перегрузил ресурсы и дал тайм-ауты. Повтор выполнен
последовательно с прежними assertion/timeouts; package/workflows не менялись.
Public/axe:45 проверок15 страниц на320/768/1440px прошли без serious/critical,
JS errors и overflow; авторизация по-прежнему не скачивает старый SDK.
Core workflows:3 публикации,3 оплаченные правки,3 отмены,12 lost-reply
recoveries, phone gate, отклонение некорректных полей, снятие/восстановление,
бесплатная анкета, один оплаченный отклик и одно уведомление прошли на
постоянном57. Это симулятор; настоящих provider вызовов нет.

Закрытый read-only collector на основе `scripts/measure-home-loading.mjs`
(`~/.local/state/blizhniy/local-primary-private/measure-home-lcp-slice-20261113.mjs`)
сохраняет три этапа в home-lcp-slice-before/compressed/sized-20261113.jsonl
в том же каталоге. Самоподписанный TLS разрешён только для fixed owned
https://127.0.0.1:3045. Проверка размеров воспроизводится командой
`node --experimental-strip-types scripts/check-local-home-image-sizing.mjs`
после запуска этого принадлежащего проекту synthetic стенда.

Авторизованный UI также прошёл: сохранение организации/reload,19 платежей
и seek18 сверены с PostgreSQL, чужой owner/лишние поля/logout отклонены,
финансовые заказы не изменились.6 дополнительных responsive/axe проверок
прошли, initial SDK0 и внешних browser-запросов нет. Точные staged bytes
проверены Gitleaks, Graphify и Code Graph обновлены.

Дополнительное ревью другой моделью владелец пропустил; инженерный разбор
proxy и sizes блокирующих замечаний не нашёл.

Итоговый BUILD_ID `9jfoTkR-6roIU1xhqKAPf`.

Медиана лабораторного LCP стала ниже2500ms в указанном mobile профиле. Это
не CrUX/p75, не полевой INP и не закрытие всех требований L27. Настоящая
банковская TEST/fiscal и оставшиеся этапы аудита отдельно открыты.

Основания: [Next15 о gzip по умолчанию](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/compress),
[responsive images и art direction](https://nextjs.org/docs/15/app/api-reference/components/image).
