# F18 — готовность восстановленного release

Основа `e1bd1f9`, только локальная работа. Не менять workflow, guard, финансовые настройки, схемы/права БД и рабочие серверы. Не ослаблять прежние assertions. Production deployment не выполняется.

Воспроизвести два пути: отдельный `rollback-release.sh` объявляет успех по health200 без БД; automatic `rollback()` в `deploy-release.sh` сохраняет процесс без повторной готовности и может игнорировать failed start в conditional context. Новый общий helper должен читать ожидаемый BUILD_ID из доверенного предыдущего release до изменения процесса, затем проверять восстановленный web на literal loopback: health, настоящий DB-ready, PostgreSQL HTML с той же build identity и manifest. Один общий deadline45s, ограниченные GET и никаких повторов мутаций.

Ожидаемый BUILD_ID читать через один no-follow/nonblock descriptor с owner/permissions/regular/nlink/size проверками. Helper берётся рядом с выполняющимся новым script; старый release не обязан содержать новый helper. Внешний release lock остаётся ответственностью действующего watchdog/caller. Symlink должен всё ещё указывать на восстановленный release перед сохранением PM2 state. Не выполнять автоматическое переключение обратно при неготовности и никаких DB down-migrations.

Сначала независимые RED shell/helper проверки, затем реализация, отрицательные/positive native, настоящий local primary GET probe. Старый watchdog orchestration fixture дополнить новыми helper inputs без удаления assertions. Общий native/types/lint/floor и подходящие shell/PG/build проверки. Реальное local HTTP readiness доказательство не выдаётся за staging PostgreSQL outage/reboot drill. Обновить графы, документацию и локальные коммиты; ручной стенд оставить работающим.
