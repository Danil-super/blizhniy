# Безопасность, SEO и локальная производительность — 17.11.2026

Работа выполнена локально по S01/S02 и эксплуатационному этапу аудита.
Production, оба российских сервера, БД/ACL, LIVE, lockfile и зависимости не менялись.
Исходники итоговой сборки: `0ed7bb780b13abf48bf18ca99c0cd338791bcbdd`.
Ярмарка и2ГИС остаются отложенными. Это не допуск широкого запуска.

## Два исправления

**Неизвестные API.** ZAP обнаружил HTML404 без CSP на `/api`: middleware
исключает API, но несуществующий endpoint получал обычный HTML Next.
Новый optional catch-all возвращает только JSON404, `no-store`, `nosniff`,
`no-referrer` и `default-src 'none'`. HEAD не содержит тела. Конкретные маршруты
сохраняют приоритет. После сборки прошли28 проверок четырёх неизвестных путей
и семи методов, а также health/ready и прежние405 профиля/webhook. Сначала
реальный HTTPS-тест воспроизвёл HTML вместо JSON; затем прошёл на новой сборке.
Два native-теста защищают контракт; мутация Cache-Control вызвала отказ.
Исправление: `fd9821d`.

**Анимации и CSP.** Полный Lottie содержал `eval`; `location.json` содержит30
выражений, несовместимых с nonce-only политикой. Оба SVG-компонента используют
уже установленный `lottie_light`, без expressions/effects и динамического кода.
JSON не переписывался: три вида выражений дают уже сохранённые цвета и ширину
штриха (`value /2 *2`). Отдельная проверка сопоставляет цвета/статические
контроллеры и сохранённые keyframes, запрещает потерю rendered effects;
у `eyes.json` нет выражений/эффектов. В source плеера нет eval/Function calls,
в собранных клиентских chunks нет `eval(`. Возврат полного плеера ломает тест.
Старая fixture поменяла только имя импортируемого модуля; assertions сохранены.
Исправление: `0ed7bb7`. Визуальное совпадение в браузере пока не подтверждено.

| Собранный пакет анимаций | До | После |
|---|---|---|
| JS, байты | 305837 | 167943 |
| gzip, байты | 76268 | 46274 |
| `eval(` | Есть | Нет |

Измерены фактические байты production build и gzip с одинаковыми настройками,
а не время отрисовки. Снижение gzip39.3%; LCP/INP из этого не выводятся.

## Динамический ZAP и разбор предупреждений

Два anonymous baseline на реальном локальном HTTPS-приложении: один и тот же
образ `ghcr.io/zaproxy/zaproxy@sha256:9624669db72f54d86c4b46a7064518bd9bf79d8c61a4c31befa9923489f328af`,
обычный минутный spider, passive scan, без active/Ajax и подавлений.
POST форм, импорт robots/sitemap отключены; глубина3. В обоих JSON отчётах
единственный site — loopback3045. Это ограниченный публичный обход, не
авторизованный аудит всех функций. Штатный лимит ZAP на повторения alerts сохранён.

Контейнер работает nonroot, получает только отдельный setgid-каталог отчётов
и дополнительную группу хоста. Checkout и закрытые настройки не монтируются.
До исправлений отчёты HTML/JSON/MD:121935/48537/42032байта; после:
115918/45970/39421байт. В обоих случаях scanner2, gate1. Настоящие WARN
не превращались в success. После исправлений отсутствуют10038 и10110.

| Оставшаяся группа | Разбор и следующий шаг |
|---|---|
| 10055: style-src unsafe-inline, Medium | Действующий допуск inline CSS, включая SSR styles. Не считать устранённым; перенос стилей/nonce требует проверки аватара, фото, анимаций и адаптивности в браузере |
| 10055: report-uri notice, Low | Существующий collector принимает прежний формат CSP. Новая Reporting API требует отдельной обработки/проверки; старый collector не удалён ради предупреждения |
| 90004: COOP/COEP/CORP, три Low-группы | Это hardening, не доказанная утечка. Строгая изоляция меняет popup/внешние ресурсы; нужны настоящие Telegram/Turnstile/payment-переходы. Политики не включены вслепую |
| 10044: большой redirect, Low | Публичный `/obyavleniya/prodam` → `/obyavleniya?kind=prodam` включает HTML layout Next. Сам размер не доказывает раскрытие данных; текущая проверка anonymous, авторизованный вариант ещё нужен |
| 10035: HSTS, Low | Примеры — photo API, перехваченные локальным proxy до Next headers. Нельзя приписать это production; нужен отдельный production smoke этих URL. HSTS обычных HTML проверен |
| Informational | Cache-control, cookie identification, modern app. `no-store` у nonce HTML и immutable у хешированных assets ожидаемы; это не разрешение кэшировать приватные данные |

Остаточные1 Medium и6 Low групп не исключены из gate и не согласованы как
новый release waiver. Исправление каталога GitHub workflow остаётся отдельным
[точным кандидатом для review](review/zap-report-directory.md).
`git apply --check` и существующие тесты gate проходят; workflow не применён.

## Фактические HTTP и SEO

- На шести маршрутах (главная, вход, кабинет, создание, поиск,404) проверены
  enforcing CSP, случайный nonce каждого ответа и совпадение nonce всех
  исполняемых scripts. Подставленные клиентом CSP/nonce и document-prefetch
  не обходят политику. Проверены HSTS, nosniff, SAMEORIGIN и отсутствие X-Powered-By.
- HTML не кэшируется; у проверенного хешированного JS `max-age=31536000, immutable`.
  Его identity173025байт/gzip54364байта дают одинаковые decoded bytes.
  Запрос только br получил identity: Brotli на этом пути не доказан.
- Повторно прошёл существующий HTTP SEO-набор:237 URL sitemap,106 публичных
  detail-страниц с canonical,2 редиректа,4 вида объявлений,3 private noindex и404.

## Зависимости и регрессия

Свежий полный `npm audit`:0 high/critical,1 прежний moderate по версии
postcss-selector-parser; production audit0. Проверки upstream-equivalence,
complexity backport и minimatch прошли вместе с CSP:38 целевых проверок.
Нового исключения или изменения package/lock/vendor нет.

Итог:2866 native-тестов без отказов/отмен/пропусков, fast, production build,
Gitleaks точных diff и13 целевых UI/CSP тестов прошли. Первый полный запуск
ошибочно использовал системный Node22.22.1 без TypeScript support; он сохранён
как неуспешный. Итоговый запуск выполнен verified Node22.23.1, без изменений
assertions или пропусков. Прежнее lint-предупреждение targetType сохранено.
Code Graph2391/6390; Graphify11763/34670 обновлены в правильном корне.

## Предварительная нагрузка на итоговую сборку

После завершения ZAP/build/tests выполнен closed-loop прогон100 виртуальных
посетителей,180 секунд, пауза5 секунд после каждого ответа, начала распределены
по первым5 секундам. Каждый посетитель имеет не более одного незавершённого
запроса. Отдельный синтетический аккаунт вошёл обычным HTTPS API и раз в5 секунд
читал профиль. Проверяются завершение ответа,200, наличие h1, отсутствие error-page;
приватное чтение проверяет структуру, без записи тела/сессии в агрегаты.

| Маршрут | Ответы | p95, мс | Ошибки |
|---|---|---|---|
| `/` | 599 | 16.59 | 0 |
| `/obyavleniya` | 598 | 22.05 | 0 |
| `/rabota` | 598 | 22.63 | 0 |
| `/rabota/vakansii` | 600 | 20.32 | 0 |
| `/rabota/zakazy` | 598 | 16.95 | 0 |
| `/poisk?q=ремонт` | 598 | 29.26 | 0 |
| Профиль по авторизованному API | 36 | 36.76 | 0 |

Итого3591 публичный ответ и36 чтений профиля; все p95 ниже текущего read800ms
в этих условиях. Время включает полный несжатый HTML; локальный CA проверяется,
таймаут5 секунд и предел тела2MiB сохранены. Проверка профиля имеет предел256KiB.
Результат не равен100 RPS: это примерно20 запросов/с с паузами. Клиент/Next/БД
на одной рабочей машине, данных мало; нет JS/изображений/рендеринга, WAN и лимитов
VPS. Записи, реальные доставки, деньги и30-минутный mixed staging soak не проверены.
Утечка памяти, production capacity и полевые CWV этим измерением не доказаны.

После замера финальный HTTPS smoke прошёл: четыре публичные страницы200 с
итоговым BUILD_ID, закрытый заказ404, выбранный отклик доступен владельцу,
отменённая оплата409, оба эффекта возврата прежней аренды сохранены.

## Границы и следующие действия

CUA снова вернул `The browser access host is unavailable`: визуальная приёмка,
полевые CWV, настоящая CAPTCHA/письма/Telegram и TEST ЮKassa этим этапом не закрыты.
S01 production остаётся report-only. Нужны точный review workflow S02, настоящий
браузерный прогон и отдельный production-пакет новых режимов; прежние согласования
не являются разрешением активировать все локальные флаги.

Закрытые scripts, исходные отчёты, неуспешные/успешные журналы и SHA256 manifest
сохранены вне Git в `~/.local/state/blizhniy/local-primary-private/launch-hardening-20261117/`.
Исходные ZAP-каталоги `launch-security-d4ugtyx4` и `launch-security-e9632oiv`
сохранены там же в private runtime-root; не публиковать их cookies/полные ответы.

Источники подхода: [Next15 route handlers](https://github.com/vercel/next.js/blob/v15.5.28/docs/01-app/03-api-reference/03-file-conventions/route.mdx),
[Lottie Light](https://github.com/airbnb/lottie-web/wiki/Lottie-Light),
[ZAP baseline](https://www.zaproxy.org/docs/docker/baseline-scan/).
Inline CSS требует собственного разрешения CSP
([style-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src));
COOP влияет на OAuth/payment popups
([COOP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Opener-Policy)),
а COEP ограничивает сторонние ресурсы
([COEP](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)).
