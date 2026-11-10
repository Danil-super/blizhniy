# Что осталось после аудита

Состояние на10.11.2026. Предыдущий выпуск объединён в main и установлен как `cad32102463031dd96f0a1af168c9410ac931ff1`; production-схема0033 и совместимый TEST-guard проверены. Новые исправления F05, F02 и F06 выполняются только локально в `fix/local-audit-booking-lifecycle-20261103`. Наличие исходников возвратов не означает их активацию. Канонический подробный журнал — `tasks/audit-20261029.md`.

## Незавершённые функции и финансовые сценарии

| Пункт | Что ещё требуется | Проверяемый результат |
|---|---|---|
| F01 | Закончить оплату/исполнение всех предусмотренных платных услуг и сверить local/production composition. Не вводить новые платежи за бесплатные сценарии | Изолированный TEST: возврат из провайдера/закрытие вкладки, webhook/polling, повторы/late events/unknown; услуга исполнена один раз. Рабочий account TEST ничего не публикует |
| F02 | Operator recovery blocked/UNKNOWN, очередь/уведомления возвратов размещений, service/role preflight и TEST/fiscal эксплуатационная приёмка | Private TEST компенсации0048, очередь0049 и автоматический intake0050 проверены вместе через worker.sweep(). Raw cursor25/10, locked policy0043/45, lease/CAS и один финансовый effect/notification. Периодический consumer/финансовые схемы/права ручного и рабочего сайтов не включены. docs/audit-application-compensation-discovery.md |
| F03 | Восстановить прежние оплаченные расхождения версий; закончить операторское/автоматическое освобождение забытых подготовок и rollout безопасной отмены | Авторитетная сверка + операторский recovery/возврат; unknown не освобождается по возрасту, immutable binding и active-order unique остаются. Новые изменения полей/фото при checkout уже заблокированы локально;0046 также защищает цель оплачиваемого отклика и выбор исполнителя до доставки/достоверного отказа оплаты (docs/audit-response-checkout-fence.md).0047 добавляет владельцу локальную отмену до anchor, четыре типа и защищённый readback; actual TEST merchant/production остаются выключены (docs/audit-checkout-cancellation.md) |
| F04 | Исполнение удаления аккаунта и политика хранения связанных данных | Реальное удаление/анонимизация по правилам, включая финансовую/контактную историю, файлы и резервные копии. Приём и админская обработка запроса0033 уже установлены в production |
| F05 | Локальная часть проверена; остаётся отдельный production rollout и эксплуатационная приёмка | 6часов/3pending, отмена обеими сторонами до начала, immutable start/host, журнал/уведомления, эффективный expiry и bounded sweeper. Native2530/2530, PG17/17, browser8/8 отдельно и настоящий local compiled HTTP→SQL→browser прошли. Подробности — `docs/audit-booking-lifecycle.md` |
| F06 | Новые оплаченные периоды и lifecycle остальных сервисных размещений | Снятие/восстановление/мягкое удаление вакансий и заказов0044 работают на локальном стенде; UI/HTTP/SQL проверены. Срок и история сохраняются. Новый оплаченный период и другие виды остаются открытыми |
| F08 | Освобождение квоты и удаление лишних фото | Reference-aware cleanup, owner limits, fencing и reconcile; живые ссылки, snapshots и активные покупки сохраняются |

Для F02 подтверждены публичные правила Профи.ру о непросмотренном отклике; собственный wallet, абонементы и внутренний чат не добавляются. Владелец согласовал только полный возврат размещения по решению администратора с причиной; успешный возврат прекращает размещение. За непросмотренный отклик предусмотрена компенсация также при снятии/удалении заказа самим заказчиком. Частичные возвраты не добавляются. Private TEST исполнение0048, очередь0049 и автоматическое обнаружение оснований0050 проверены локально. Operator recovery, placement refund queue и эксплуатационное включение остаются открыты. Сейчас от владельца не требуется действие для продолжения локальной технической работы.

## Интеграция и приёмка выпуска

| Пункт | Что ещё требуется |
|---|---|
| F16 | Проверить production ingress/nonce/reporting и совместимость внешних провайдеров до включения enforce CSP |
| F17 | Подключить локальный handoff к реальному процессу выпуска; проверить разные сборки, общие сессии/лимиты, единственные workers, старые assets и ресурсный запас |
| F18 | Усиление rollback установлено с cad3210; остаётся реальная приёмка outage/reboot/cross-build восстановления |
| QA01 | Локально добавлен обязательный PG18 gate в существующий validate перед build/package,13 наборов687/687. Точный diff одобрен владельцем10.11; публикация и настоящий GitHub runner ещё не проверены. docs/review/postgres-ci-gate.md |
| DEP-MINIMATCH-20261101 | Локально исправлен scoped override minimatch11.0.1 только для TypeScript ESLint; RED/GREEN и настоящий parser projectService проверены. Полный audit7→1 moderate, production0. Публикация и CI на GitHub ещё не выполнялись; подробности docs/audit-minimatch-remediation.md |
| Общая приёмка | Проверки двух российских серверов, TEST-провайдера/SMTP/Telegram, нагрузки и mobile CWV/accessibility, restore PostgreSQL+media, алертов/перезагрузки и наблюдаемой беты |

Локально исправлены и проверены F07,F09–F15,F19–F21. У F16–F18 есть локальная реализация/доказательства, но незавершён production этап. F03 и F02 закрываются частями, полностью завершёнными не объявлены.

Ранее02.11: полный состав0001–0037 и исправление PBR01 в payment worker (`docs/audit-refund-composition.md`). Новый PG14/14, native2470/2470, RED/GREEN/mutation, review/types/lint/floor/build прошли. Повторные ticks после блокировки не делают GET и не меняют capture/receipt. Схема/права production worker ещё не включены; ручной стенд сохраняет35. Локальный сайт пересобран и запущен на `https://127.0.0.1:3045`, HTTPS ready200 и фактический HTML/Flight BUILD_ID проверены. Следующий этап — самостоятельный provider admission и отправка, привязка refund ID/сверка/применение услуги. LIVE и настоящие операции выключены.

Ранее02.11: read-only inspection перед полным TEST-возвратом (`docs/audit-refund-inspection.md`). Два strict payment GET вокруг полной canceled-only истории используют один35s/3attempt budget; неполная история/ненулевой возврат/pending или смена refundable приводят к отказу, не к новому ключу.22 новых native, всего2492/2492, RED/GREEN/mutation/review/types/lint/floor/build прошли. Это наблюдение, не финансовое разрешение или гарантия остатка: actual dispatch/исходы/услуга ещё открыты. Новый reader не подключён к приложению; production и ручная схема35 не менялись. Локальный сайт запущен: HTTPS ready200 и фактический HTML/Flight BUILD_ID `_TOkrF_C3a8TX3YfICkVr` проверены.

Ранее02.11: GET-verified журнал0038 (`docs/audit-refund-journal.md`). Неизменяемая привязка provider refund ID, append-only pending→terminal, восстановление после COMMIT/lost ACK, сверка metadata и исходного capture. Дополнительный RED выявил и устранил принятие противоречивого provider capture. PostgreSQL20/20 на полном составе0001–0038, native2498/2498, mutation/review/types/lint/floor/build прошли. Новый store не подключён к HTTP/worker; ручной стенд35, production и реальные деньги не менялись. F02 остаётся открытым: actual dispatch/unknown outcome, допуск/чек, очередь/применение услуги и компенсации откликов.

Свежая локальная сборка запущена на `https://127.0.0.1:3045`: HTTPS ready200 и HTML/Flight BUILD_ID `xApz4EOllQNuNuNnsoDE-` проверены.

Ранее02.11: private TEST dispatcher0039 (`docs/audit-refund-dispatch.md`). Durable UNKNOWN attempts, неизменяемый candidate, retries прежнего key/body в исходном окне, лимит12 и global identity0038/39. Восстановление известного ID — GET-only. Дополнительный RED закрыл противоречивый stored/provider capture до первого POST. PG19/19 полного состава0001–0039, native2519/2519, mutation/review/types/lint/floor/build прошли. Все provider HTTP — локальные подмены. Допуск callback обязателен, но policy/фискальный сценарий ещё не реализованы; HTTP/worker/GRANT activation и реальные возвраты выключены.

Локальный сайт перезапущен: HTTPS ready200 и фактический HTML/Flight BUILD_ID `tUPdQMQeEOjV4vI_X4Yhz` подтверждены на `https://127.0.0.1:3045`.

Последний инкремент02.11: effect0040 и processor (`docs/audit-refund-effects.md`). Только GET-succeeded завершает исходный период; исторические capture/receipt/body, новая публикация и markers сохранены. Minimal SQL role не получает общей финансовой UPDATE authority. Replay/rollback/COMMIT ACK и полный fake inspection→POST→GET→effect проверены. PG34/34 полного0001–0040, native2522/2522, RED/GREEN/mutation/review/types/lint/floor/build прошли. Исходники и права production не меняются, manual schema35; activation/финансовая политика/чек/компенсации откликов остаются открыты.

Свежий локальный запуск подтверждён: HTTPS ready200, HTML/Flight BUILD_ID `gkxYl3Eq4I_hcjkDMI-Iu`, адрес `https://127.0.0.1:3045`.

Локально10.11: private TEST approval0042 и composition с существующим processor. Полный native2532/2532, focused17/17 с реальным PG18.6; session-expiry mutation обнаружена. HTTP/очередь и права не активированы, ручной стенд остаётся0001–0035+0041. См. `docs/audit-refund-approval.md`.

Локально10.11: добавлена и проверена чистая политика компенсаций откликов (`docs/audit-application-compensation-policy.md`):120 часов от доставки, выбор другого/снятие заказчиком до раскрытия, сохранение уже возникшего основания при позднем просмотре, блокировка legacy_unknown. Это классификация, не финансовое разрешение: следующий этап — атомарный уникальный case и очередь/исполнение/уведомления.

Последняя проверка10.11: native2540/2540, focused-policy8/8, floor/types/lint/build/Gitleaks прошли; Graphify/Code Graph обновлены. Ручной стенд запущен, health/ready200 и совпадение HTML/Flight с BUILD_ID `reCRbpzlsAAinBs0Y1Zya` проверены. Production не менялся.

Локально10.11:0043 сохраняет неизменяемый case компенсации по исходной TEST-оплате и достоверный первый выбор исполнителя. Перечитывание под row-lock, прямой SQL guard, NOWAIT, повтор/COMMIT recovery и прежний read/decide с уведомлениями проверены. Снятие/удаление заказчиком требует журнала F06 и пока не подменяется статусом карточки. Финансовая отправка/очередь/GET-сверка компенсаций и её уведомления ещё не активированы. См. `docs/audit-application-compensation-cases.md`.

Контроль0043: PostgreSQL18/18, native2540/2540 без пропусков, mutation/review/floor/types/lint/build прошли. Локальный сайт запущен, health/ready200, HTML/Flight BUILD_ID `Cnajn5BPwuz8L-rl-j0U7` сверён. Production и его права не менялись.

Локально10.11:0044 установлена в ручной стенд0001–0035+0041+0044, добавлены только SELECT/INSERT журнала, финансовые ACL не менялись. Desktop/mobile compiled HTTP→SQL→browser lifecycle прошёл, публичные200→404→200→404, исходный период сохранён. Native2546/2546, PG32/32, RED/GREEN/mutation/review/types/lint/floor/build. Источник0045 для компенсации при снятии/удалении заказчиком проверен изолированно и пока не включён вручную; денежная очередь/сверка/уведомления открыты. `docs/audit-work-owner-actions.md`.

Отдельное продолжение F03: тот же captured-but-undelivered отклик нужно защитить при обычном редактировании заказа и выборе исполнителя. В0044 добавлен fence именно для снятия/восстановления/удаления; это не закрывает все прежние пути изменения target revision.

Локально10.11: F03/0046 закрывает изменение полей/фото цели и выбор исполнителя при created/pending либо captured-undelivered отклике. 45/45 PG18.6 (13 новых, включая sparse38),20/20 фактических сквозных сценариев и2550/2550 native; mutation обнаружена, review/floor/types/lint/build прошли. Узкие исключения исходного размещения/полного возврата проверены. Табличные/финансовые права неизменны. Ручная БД0001–0035+0041+0044+0046,38 записей; возвраты/компенсационные очереди не активированы. Исторический recovery и безопасная отмена подготовки F03 остаются открыты. Подробности: docs/audit-response-checkout-fence.md.

Свежий локальный запуск проверен: HTTPS health/ready200, фактический HTML/Flight кабинета заказов и откликов совпадает с BUILD_ID `BpzkNsriOnGA0oeX4F80P`; адрес `https://127.0.0.1:3045`. Graphify10353/30146 и Code Graph2101/6221 обновлены, staged Gitleaks — без находок.

Локально10.11: F03/0047 — отмена владельцем только undispatched TEST local-fixture-shop. Immutable journal→created/failed, shared intent lock с dispatch, anchor/UNKNOWN не освобождаются. HTTP/UI четырёх типов, readback после потери ответа/focus, редактирование и новая подготовка проверены настоящим compiled browser/SQL. Native2557/2557, PG26/26 (13 новых), прежний payment runner20/20; RED/mutation и review/floor/types/lint/build прошли. Ручная схема39 записей, только SELECT/INSERT(payment_id) нового журнала; старые финансовые ACL неизменны. Production/реальные деньги/компенсационные очереди не включались. Исторический recovery и автоматическая/операторская обработка забытых подготовок открыты. docs/audit-checkout-cancellation.md.

Свежий локальный запуск проверен: HTTPS health/ready200; HTML/Flight кабинета и страницы оплаты содержит BUILD_ID `IRodMtqDHCsG3p4JAqf4T`, совпадающий с `.next/BUILD_ID`. Адрес `https://127.0.0.1:3045`. Graphify10450/30426 и Code Graph2118/6270 обновлены; staged Gitleaks — без находок.


## Локальный инкремент DEP-MINIMATCH и QA01 — 10.11.2026

Основа603641a. Scoped override minimatch11.0.1 только у TypeScript ESLint устраняет GHSA-g3hv-75wg-m249. Остальные lock entries сохранены, кроме новой зависимости исправленного matcher. Проверен реальный parser projectService/allowDefaultProject, RED budget и исправленный bounded matcher. Полный audit7→1 moderate/high0/critical0; production0. Оставшийся version-based finding прежнего selector-parser backport не скрыт. docs/audit-minimatch-remediation.md.

Владелец одобрил точный workflow diff только локально. В существующий validate добавлены Chromium и13 последовательных disposable PG18 наборов перед build/package/upload; secrets, permissions, guard, timeout, security/layout/deploy dependencies неизменны. Неверно совмещённый phone/worker fixture разделён на две БД того же owned контейнера: телефон проверяет47, worker только разрешённый32; прежние assertions и финансовый preflight сохранены. docs/review/postgres-ci-gate.md.

Реальные PostgreSQL/browser687/687 за188.2s и native2562/2562 без skips, frozen npm ci, floor/types/lint/build, expiry/watchdog/ZAP shell suites проходят. Единственное прежнее lint-предупреждение targetType. Concurrent build/dev прогон не засчитан; финальные PG и build выполнены последовательно. Ручная схема39 записей и production33 не менялись, provider HTTP не выполнялся. QA01 на выпуске требует реального GitHub runner: local proof не подтверждает его сеть/OS/install time и общий20min budget.

Локальный HTTPS стенд запущен на `https://127.0.0.1:3045` (вход `/__local`): health/ready200, фактический HTML/Flight заказов и откликов совпадает с BUILD_ID `IPkCMMYcCqTUUU-wpETEk`. Push/deploy не выполнялись. Финансы/компенсации, исторический recovery, удаление данных, media cleanup и эксплуатационная приёмка остаются открыты согласно плану.

Graphify10463/30453 и Code Graph2120/6276 обновлены для текущего корня; staged Gitleaks без находок.


## Локальный инкремент F02/0048 — 10.11.2026

Добавлено private TEST исполнение неизменяемого решения о компенсации отклика: каноническая full reservation/request, общий dispatcher и GET journal, один financial effect/уведомление. Operation ID равен исходной оплате; late view не отменяет уже возникшее право. Pending/canceled/UNKNOWN не объявляются возвратом. Исходный срок23h55m и максимум12 попыток не расширяются. Snapshot/доставка/контакты сохраняются. docs/audit-application-compensation-refunds.md.

0036–0039 guards дополнены отдельной application-веткой в новой0048; старые миграции не редактировались. Реальная ограниченная роль выявила42501 при CASE с private helper; отдельный PL/pgSQL IF сохранил прежние placement-права. BEFORE проверяет/выводит данные, AFTER INSERT владеет эффектом/уведомлением; удалённое уведомление не создаётся повторно. Read-only placement inspector/placement approval не открыты для произвольного application. Фискальный допуск основан на неизменяемом оригинале, реальный магазин не вызывался.

RED исходного SQL и Node import; mutation допуска без case обнаружена, файл восстановлен побайтно. Native2563/2563; полный PG13-наборов700/700, после добавления проверки cap12 финальный compensation subset32/32. Независимое инженерное ревью завершено; дополнительную модель владелец пропустил. Floor/types/lint/build прошли, только прежний targetType warning. Неуспешная параллельная проверка типов/build не засчитана: final check:fast выполнен после генерации Next. Guard/workflows, прежние assertions и зависимости не менялись.

Ручная БД сохраняет39 записей:0001–0035+0041+0044+0046+0047;0048/новая таблица проверенно отсутствуют. Production0033/права/сервисы и provider HTTP не затрагивались. Bounded consumer/очередь, operator recovery, уведомления возвратов размещений и real TEST/fiscal приёмка остаются открыты. Новый код сам по себе не выполняет автоматические возвраты сайта.

Свежий HTTPS стенд `https://127.0.0.1:3045` (`/__local`): health/ready200; HTML/Flight заказов, откликов и оплаты совпадает с BUILD_ID `o-NiRoNJNbOVi2fhcNJJR`. Graphify10498/30578 и Code Graph2126/6290 обновлены для текущего корня; push/deploy не выполнялись.

Локально10.11:0049 queue сохранённых cases, nonce/lease/backfill и last-ACK recovery проверены. Native2565/2565, PG717/717, build/floor/types/lint; manual39/production33 не менялись. Подробности — docs/audit-application-compensation-queue.md.

Локально10.11:0050 автоматический intake + worker.sweep() проверены вместе с0048/49. Native2567/2567, PG732/732, build/floor/types/lint; manual39 и production не менялись. Текущий F02 остаток указан в верхней таблице; детали docs/audit-application-compensation-discovery.md.
