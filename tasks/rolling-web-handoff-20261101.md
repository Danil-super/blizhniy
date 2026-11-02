# F17 — локальный прототип переключения двух web-инстанций

Основа `50b975d`. Только локальная подготовка; действующие deploy-release/rollback/watchdog, PM2 ecosystem, workflow и рабочий ingress не менять. Их интеграция затронет protected expectations/guard и потребует отдельного конкретного review. Не выдавать прототип за установленное production обновление без пауз.

## Контракт

- Сначала проверить совместимость/ресурсный бюджет и живую старую версию. Запустить ровно одну candidate, проверить HTTP health, настоящий ready, HTML и build assets до смены маршрута. Почтовые/payment/media workers не дублировать; старый shared worker/protocol и схема должны быть совместимы с обоими web-процессами.
- Caddy управляется только закрытым Unix admin socket. Меняется один заранее заданный reverse-proxy upstream, через ETag/If-Match. Отклонённая/конкурентная смена не даёт права перезаписывать чужую конфигурацию. Не включать retry POST/COMMIT/merchant действий.
- Перед каждым изменением сохраняется intent в закрытый fsync-журнал под эксклюзивным lock. При неизвестном результате, ошибке journal или конфликте сохранять обе инстанции и lock, без слепого повторения/убийства процесса. Новый run поверх неразобранного lock запрещён, автоматического stale-lock cleanup нет.
- После switch старый web остаётся жив до postcheck/подтверждения. При отказе postcheck старый сначала повторно проверяется, затем ingress возвращается через CAS; candidate не уничтожается до безопасного drain. Старую версию останавливать только после проверенной promotion и подтверждения. Graceful SIGTERM/SIGINT, без автоматического SIGKILL; timeout требует вмешательства, а не обрыва запросов.
- Не удалять старые immutable JS/assets после handoff: обеспечить их чтение из сохранённых trusted release trees, без записи web-пользователем. Доказать синтетическим late asset и реальным Next bundle. Активную ссылку и single workers переключать только при совместимом контракте; схема/roles/payment flags не изменяются.
- Проверить реальным Caddy и двумя независимыми Next-процессами один и тот же текущий build (same-build handoff). Общие PostgreSQL session/limiter должны оставаться общими. Это не доказательство совместимости произвольных разных релизов/миграций.
- Измерить web+proxy внутри собственного cgroup с лимитом 768 MiB, оставляя остальной бюджет 2 GiB для ОС/shared workers. Не заявлять доказанную capacity 2 GiB VPS под production нагрузкой без staging/load проверки.

## Реализация и доказательства

Новые изолированные script-модули: одноразовый controller с adapter boundaries, CAS Caddy adapter, bounded read-only probe, закрытый journal/lock. Реальные local adapters и fixture реализуются в отдельном check script, не импортируются приложением. RED на stop-before-start/порядке действий и module contracts, native adversarial cases: unready candidate, overlap refusal, wrong build, conflict, unknown switch/promotion/journal, rollback readiness, drain timeout, повторный run. Local HTTP поток во время handoff/rollback, длинный synthetic request завершается без replay, late old asset доступен; actual primary session на обеих инстанциях. Нет настоящих писем/Telegram/merchant requests.

После focused RED/GREEN — native/types/lint/floor/build и подходящие PG проверки; графы именно текущего корня. Сохранить локальные коммиты, ручной стенд оставить работающим. Отдельно зафиксировать последующий production diff/ограничения, не изменяя guard/workflows без review владельца.

## Локальный результат

Выполнен прототип и actual same-build proof: focused52/52, native2410/2410, PostgreSQL/browser137/137, bootstrap349/349, types/lint/floor/build. Реальные Caddy/2Next:456 успешных health,32MiB drain, прежние assets/JS chunk, shared session/revocation/limiter, rollback и unknown-lock. Пик692MiB в cap768MiB. Независимые найденные ошибки исправлены через RED/GREEN; mutation защиты promotion обнаружена. Графы обновлены, ручной стенд перезапущен и проверен. Подробности `docs/audit-web-handoff.md`; production интеграция здесь намеренно не активируется.
