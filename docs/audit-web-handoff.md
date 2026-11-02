# F17 — подготовка переключения двух web-инстанций

Основа `50b975d`, 01.11.2026. Только локальная разработка и приёмка. Действующие deploy/rollback/watchdog, PM2 ecosystem, workflows, ingress и production-БД не менялись. Новые модули не импортируются приложением или существующим развёртыванием. Пауза при действующем production deploy ещё не устранена: подготовлен и проверен отдельный механизм для последующей интеграции.

## Контракт оператора

`rolling-web-handoff.mjs` принимает две зафиксированные slot/port/build идентичности и одноразовый operation ID. До старта candidate проверяются admission, старая версия и исходный ingress snapshot. Candidate запускается один раз; проверяются health, настоящий DB-ready, HTML с PostgreSQL backend и **build identity из initial Next Flight record**, затем manifest. Наличие старого manifest само по себе не доказывает версию процесса. Parser использует JSON, не eval; изменение wire format Next закрывает probe до его явного обновления.

Ingress меняется только через закрытый Unix admin socket Caddy, один фиксированный `/id/blizhniy-web/upstreams`, ETag/If-Match и readback. Адреса — literal loopback, два допустимых порта. Нет сетевых redirects, повторов переключения или повторов POST/COMMIT/merchant. HTTP reads ограничены одним общим deadline и объёмом ответа. Все writers этого ingress должны использовать **один общий operator lease**; CAS/rechecks не защищают от другого root, который игнорирует lease и меняет конфигурацию после последнего чтения.

Перед side effect записывается intent: operator-owned каталог0700, lock/journal0600, exclusive/no-follow, fsync файла и каталога. Проверяются inode, owner, permissions, hardlinks и pathname replacement. Сериализуются только проверенные значения собственных data properties, без accessors. После intent снова читается route перед promotion и каждым drain. Изменение route не позволяет переключить active generation или остановить процесс. Это исправлено после независимого RED regression.

После switch старый процесс остаётся до postcheck. При отказе сначала повторно проверяется старая версия, затем CAS rollback/readback и graceful drain candidate. После успеха проверяется promotion и выполняется graceful drain старого процесса. Неизвестный switch/promotion/journal, конфликт либо timeout сохраняют процессы/lock для разбора; автоматического stale-lock удаления или повторного run нет. Lock освобождается только после соответствующего durable terminal result. Timeout старого drain даёт `complete-old-retained`, а не принудительный SIGKILL. Старый процесс после SIGTERM может уже закрыть listener: это сохранение незавершённых запросов, не обещание готовности к новому rollback.

Реальные process-control и active-symlink adapters пока принадлежат **только локальному fixture**. Production-интеграция потребует привязки к root-owned release/runtime, подтверждённой идентичности процессов и ресурса, а также отказа запускать новую операцию поверх неразобранного журнала. Controller сам по себе не выдаёт право управлять произвольным PID.

## Assets, память и два сервера

`handoff-assets.mjs` использует существующий descriptor-based inventory validator: только operator-owned trees без symlink/hardlink/group-write, ограниченное число/размер файлов. Совпадающие пути должны иметь одинаковый SHA256. Ingress читает сохранённые immutable trees новой и старой версий даже после завершения старого web. Папки нельзя удалять сразу после promotion: старая вкладка ещё может запросить lazy chunk. Политика срока хранения, disk budget и поддерживаемый возраст вкладки остаются частью будущей интеграции; локальная проверка не доказывает бесконечное хранение всех releases.

Схема не переносит ПД между странами: web остаётся на российском VPS, PostgreSQL — на отдельном российском сервере. Локальное доказательство использует два web-процесса и общую owned Docker PostgreSQL, без production credentials. Схемы/grants не меняются. До overlap нужно отдельно доказать совместимость двух артефактов с одной БД, session secret/cookies, limiter, media protocol/cache и единственными mail/payment/media workers. Нельзя размножать workers вместе с web. Same-build proof ниже **не доказывает** совместимость произвольных разных версий или миграций.

Web+proxy проверены внутри собственного user-systemd cgroup: MemoryMax768MiB, SwapMax0, CPUQuota200%, TasksMax128, RuntimeMaxSec180, NoNewPrivileges. БД находится вне этого cgroup как отдельный компонент. Остаток от2GiB предназначен ОС и shared workers, но их production capacity и нагрузочная устойчивость этим не измерены. Peak не является обещанием запаса при реальном трафике.

## Воспроизведение и результаты

Нужны проверенный Node22.23.1, уже собранный текущий `.next`, запущенный owned primary fixture и user-systemd. Caddy2.10.2 извлекается только из уже имеющегося pinned image, без pull и без запуска tool-контейнера:
`caddy@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb`. Бинарник переписывается в собственный закрытый каталог, чтобы не переносить image file capabilities. Admin socket0600 в каталоге0700, HTTP только127.0.0.1 на случайных высоких портах. Production конфигурация не читается; дочерние Next получают explicit local allowlist env и существующий bridge, запрещающий внешние SMTP/Telegram/merchant соединения.

```sh
node --test tests/rolling-web-handoff.test.mjs tests/handoff-operator-boundaries.test.mjs tests/handoff-probe.test.mjs tests/handoff-assets.test.mjs
node --experimental-strip-types scripts/check-local-web-handoff.mjs
npm test
npm run check:types
npm run lint
npm run check:floor -- --base 50b975d
```

Focused52/52 и полный native2410/2410 без skip. Types/lint/floor прошли; сохранено только прежнее lint-предупреждение `targetType`. Независимое ревью воспроизвело неправильное доказательство build identity и route race во время promotion intent; добавленные RED cases прошли после исправлений. Временное удаление новой promotion-проверки снова ломает regression; исходник восстановлен побайтово, focused52/52 прошли повторно. Старые assertions и guard/workflows не менялись.

Настоящие Caddy + два независимых Next15.5.28 одного артефакта:

- `complete`, `rolled-back`, `recovery-required` подтверждены реальными scoped CAS/readback. Synthetic lost acknowledgement возникает после реального switch: обе версии остаются, lock блокирует следующую операцию. Cleanup fixture начинается только после этих assertions и не является production recovery.
- 456 HTTP health requests во время старта, switch, drain и rollback: все200, ошибок0. Это локальное функциональное испытание, не SLO или нагрузочный тест.
- Уже начатый HTTP body32MiB прошёл через старый Next/Caddy полностью; старый Next оставался жив после SIGTERM, пока клиент не возобновил чтение. Текущий запрос не повторялся. Нет автоматического SIGKILL в controller; принудительная остановка разрешена только cleanup собственных изолированных test children после конца наблюдений.
- Old-only synthetic JS, настоящий Next manifest и JS chunk из HTML старой страницы отвечают200 после выхода старого процесса. SHA256 реального chunk до и после совпадает; immutable header сохранён.
- Настоящий IdentityStore session принят до и после handoff; два web увеличивают один PostgreSQL limiter counter. Отзыв сессии сразу даёт401 на обоих. Фальшивый ожидаемый build отклоняется по настоящему HTML.
- Пик web+proxy692MiB при лимите768MiB, без swap. Входящие пользовательские данные, письма и платежи не создавались; actor/limiter key/32MiB stream принадлежат fixture и убраны. Private журналы/метрики остаются в `~/.cache/blizhniy-audit-f17`, не в Git или public.

Настоящий PostgreSQL/browser137/137, bootstrap/ACL/payment349/349 и production build прошли. Окончательная двухпроцессная приёмка использует эту сборку. PostgreSQL/browser runner очищает `.next`, поэтому окончательная сборка выполнена после него, types после сборки. Graphify и Code Graph обновлены именно для текущего корня. Ручной primary стенд перезапущен на свежем build, health/ready200 и совпадение HTML build identity проверены; адрес `https://127.0.0.1:3045`.

## До включения в production

Нужен конкретный reviewed diff deploy/rollback/runtime/ingress и соответствующих защищённых expectations. Guard/workflow изменения требуют owner review по CONSTRAINTS.md47. Отдельно проверить реальную Caddy-версию, закрытый admin access для operator UID, root-owned archives, ограничение overlap на VPS2GiB, отсутствие дубликатов workers, single active symlink, reboot/recovery и rollback после разных совместимых builds. Не переключать схему destructive down-migrations. F18 действующего rollback ещё открыт; новый readiness probe лишь готов для его последующей интеграции. Никакого автоматического выпуска этим документом не разрешается.

Официальные источники, изученные через Context7: [Caddy API/CAS](https://caddyserver.com/docs/api), [reverse_proxy и streaming](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [PM2 graceful reload](https://pm2.keymetrics.io/docs/usage/signals-clean-restart/), [Node22 HTTP](https://nodejs.org/docs/latest-v22.x/api/http.html). Фактическая shutdown-обработка SIGTERM/SIGINT дополнительно проверена в установленном Next15.5.28 `start-server.js`; listen-сигнал или PM2 reload не подменяют DB readiness.
