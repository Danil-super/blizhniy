# Что осталось после аудита

Обновление12.11: подготовлен [совместный локальный кандидат F02](../docs/review/refund-owned-composition.md)
на базе8c80e3c: owned worker, точный профиль реальной локальной схемы,
private socket → три возврата размещения/компенсация отклика → рестарт без дублей.
Native2633/2633, PG108/108, focused25/25, fast/Gitleaks прошли. Журнал ручной39
прочитан READ ONLY и воспроизведён синтетически;16 добавочных миграций дают
полную локальную55. Ручной контейнер возвращён остановленным, данные/права/TLS
не менялись. Владелец12.11 одобрил точный guard diff только для локального
сохранения; установка и публикация не разрешены этим согласованием.
Этап1 остаётся открыт до установки/подключения ручного контура и отдельно
настоящей TEST/fiscal приёмки; production и остальные три этапа не закрыты.

Состояние плана на12.11.2026. Накопленный код опубликован в main и production как `28a328a1f0420961f0108327cd46432286ae8155`; workflow43175011405 завершён успешно, включая public postchecks и host confirmation. Production-профиль/schema0033 и прежний отдельно установленный TEST-worker сохранены: новых миграций/GRANT/финансовых служб/LIVE не включали. Продолжение идёт только локально в `fix/local-audit-refund-runtime-20261112`;54-совместимость одобрена владельцем и сохранена вd4207a3. Наличие исходников возвратов не означает их активацию. Канонический подробный журнал — `tasks/audit-20261029.md`.

## Порядок работы крупными этапами

По указанию владельца11.11 результаты объединяются в законченные блоки. Внутри блока продолжаются небольшие локальные изменения и focused-проверки; полный контрольный прогон и итоговый отчёт — на границе блока. Не завершать этап отчётом об одном helper или сборщике. Краткие обновления по ходу работы сохраняются; вопросы нужны только для недостающего решения или явно требуемого согласования конкретного diff. Группировка не меняет критерии CONSTRAINTS.md и ранее установленные границы разрешений. Работа пока локальная.

| Этап | Объём | Результат для проверки |
|---|---|---|
| 1. Локальный контур возвратов — текущий | Остаток F02: runtime, TLS/TEST-магазин preflight, служба, операторские решения/восстановление, совместимость обработчиков на общей схеме | Сквозной сценарий решения → очереди → отправки/UNKNOWN → сверки → единственного эффекта/уведомления на изолированном локальном контуре. Проверены отказ доступа, повторы, рестарт, истечение сессии/аренды. Подготовлен единый пакет критичных diff для необходимых согласований; код и фактическая активация различаются в отчёте. Настоящая provider/fiscal приёмка отмечается отдельно, пока не выполнена |
| 2. Остальные финансовые сценарии | F01, F03 и финансовая часть F06 | Поддерживаемые платные услуги, recovery оплаченных расхождений, безопасная отмена подготовки и новые периоды проверены совместно; исходная история и сроки сохранены |
| 3. Аккаунты и хранение данных | F04, F08, оставшийся lifecycle F06 | Удаление/анонимизация и media cleanup с сохранением необходимых финансовых/живых ссылок, проверенные квоты и повторное исполнение |
| 4. Выпуск и эксплуатационная приёмка | F05 rollout, F16–F18, QA01, зависимости и общая приёмка | Согласованный выпуск, реальные CI и два российских сервера, внешний TEST/SMTP/Telegram, нагрузка/CWV/accessibility, restore и наблюдаемая бета; отдельные непроверенные условия не объявляются закрытыми |

Внутренние save-point commits допустимы, но не считаются завершением большого этапа. Новые запросы на обязательный review защиты объединяются в конкретный пакет в пределах этапа; предыдущие точечные одобрения не расширяются автоматически. Выпуск исходников12.11 завершён; дальнейшая разработка снова локальная, без push/деплоя.

## Незавершённые функции и финансовые сценарии

| Пункт | Что ещё требуется | Проверяемый результат |
|---|---|---|
| F01 | Закончить оплату/исполнение всех предусмотренных платных услуг и сверить local/production composition. Не вводить новые платежи за бесплатные сценарии | Изолированный TEST: возврат из провайдера/закрытие вкладки, webhook/polling, повторы/late events/unknown; услуга исполнена один раз. Рабочий account TEST ничего не публикует |
| F02 | Интерфейс/роль оператора, совместимость обоих обработчиков с54 и настоящая TEST/fiscal эксплуатационная приёмка; перед production пересмотр managed-допуска | Private TEST компенсации0048, очередь0049/intake0050, operator recovery0051, placement queue/уведомления0052 и application lease fence/deadline0053 реализованы локально. Кандидат минимальной worker-роли/lock-only0054 и общий системный ACL guard обоих обработчиков одобрены для локального сохранения; автономный пакет содержит общий модуль (docs/audit-financial-catalog-privileges.md). Read-only сверка фактической app-схемы54 с эталоном source replay также одобрена и проверена локально (docs/audit-refund-schema.md). Отдельный offline builder и compiled refund-пакет проверены по docs/audit-refund-artifact.md; роль/служба не устанавливаются. Изолированный локальный runtime/service с TLS, TEST merchant preflight и остановкой при неопределённом результате реализован; compiled-пакет проверен на временной PostgreSQL (docs/audit-local-refund-runtime.md). Установка на ручной/рабочий стенд не выполнена. Original key/window/cap сохраняются. Consumer/финансовые схемы/права ручного и рабочего сайтов не включены. |
| F03 | Восстановить прежние оплаченные расхождения версий; закончить операторское/автоматическое освобождение забытых подготовок и rollout безопасной отмены | Авторитетная сверка + операторский recovery/возврат; unknown не освобождается по возрасту, immutable binding и active-order unique остаются. Новые изменения полей/фото при checkout уже заблокированы локально;0046 также защищает цель оплачиваемого отклика и выбор исполнителя до доставки/достоверного отказа оплаты (docs/audit-response-checkout-fence.md).0047 добавляет владельцу локальную отмену до anchor, четыре типа и защищённый readback; actual TEST merchant/production остаются выключены (docs/audit-checkout-cancellation.md) |
| F04 | Исполнение удаления аккаунта и политика хранения связанных данных | Реальное удаление/анонимизация по правилам, включая финансовую/контактную историю, файлы и резервные копии. Приём и админская обработка запроса0033 уже установлены в production |
| F05 | Локальная часть проверена; остаётся отдельный production rollout и эксплуатационная приёмка | 6часов/3pending, отмена обеими сторонами до начала, immutable start/host, журнал/уведомления, эффективный expiry и bounded sweeper. Native2530/2530, PG17/17, browser8/8 отдельно и настоящий local compiled HTTP→SQL→browser прошли. Подробности — `docs/audit-booking-lifecycle.md` |
| F06 | Новые оплаченные периоды и lifecycle остальных сервисных размещений | Снятие/восстановление/мягкое удаление вакансий и заказов0044 работают на локальном стенде; UI/HTTP/SQL проверены. Срок и история сохраняются. Новый оплаченный период и другие виды остаются открытыми |
| F08 | Освобождение квоты и удаление лишних фото | Reference-aware cleanup, owner limits, fencing и reconcile; живые ссылки, snapshots и активные покупки сохраняются |

Для F02 подтверждены публичные правила Профи.ру о непросмотренном отклике; собственный wallet, абонементы и внутренний чат не добавляются. Владелец согласовал только полный возврат размещения по решению администратора с причиной; успешный возврат прекращает размещение. За непросмотренный отклик предусмотрена компенсация также при снятии/удалении заказа самим заказчиком. Частичные возвраты не добавляются. Private TEST исполнение0048, очередь0049 и автоматическое обнаружение оснований0050 проверены локально. Operator recovery0051 и placement queue/уведомления0052 реализованы как dormant private TEST capabilities; interface/role и эксплуатационное включение остаются открыты; application lease hardening закрыт локально0053. Локальный runtime/TLS/TEST merchant preflight реализован12.11; настоящая provider/fiscal приёмка отдельно открыта. Сейчас от владельца не требуется действие для продолжения локальной технической работы.

## Интеграция и приёмка выпуска

| Пункт | Что ещё требуется |
|---|---|
| F16 | Проверить production ingress/nonce/reporting и совместимость внешних провайдеров до включения enforce CSP |
| F17 | Подключить локальный handoff к реальному процессу выпуска; проверить разные сборки, общие сессии/лимиты, единственные workers, старые assets и ресурсный запас |
| F18 | Усиление rollback установлено с cad3210; остаётся реальная приёмка outage/reboot/cross-build восстановления |
| QA01 | Обязательный PG18 gate опубликован и прошёл на настоящем GitHub runner для28a328a:13 наборов808/808 перед build/package. Прежние проблемы подготовки runner исправлены и проверены финальным workflow43175011405; нагрузка, доступность, restore и общая эксплуатационная приёмка остаются открыты. docs/review/postgres-ci-gate.md |
| DEP-MINIMATCH-20261101 | Scoped override minimatch11.0.1 только для TypeScript ESLint опубликован в28a328a и прошёл CI. RED/GREEN и настоящий parser projectService проверены. Полный audit7→1 moderate, production0; оставшееся version-based срабатывание backport рассматривается отдельно, а не объявляется отсутствующим. docs/audit-minimatch-remediation.md |
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


## Локальный инкремент F02/0051 — 10.11.2026

Закрытая GET-only сверка blocked/UNKNOWN: live admin, исходное решение0042/0043/0045, send proof, immutable request/result audit и атомарный effect/result/queue completion. Опознаваемый UUID провайдера может быть проверен после истечения окна; новые POST/key/window/reservation и сброс cap запрещены. Повтор завершённого действия возвращает локальное доказательство даже без API. История отклика сохраняется; successful application effect/notification ровно один. docs/audit-refund-recovery.md.

Инженерное ревью выявило недоступность terminal retry при outage API и проверку сессии до queue lock wait; оба случая исправлены. Негативные мутации обнаружены, исходники восстановлены побайтно. Native2569/2569, полный PG13-наборов743/743 за231.6s; focused74/74. Ручной журнал39 и отсутствие новых финансовых таблиц проверены read-only. Migration0051/роль проверены только в disposable fixture, старые миграции/guards/workflows не менялись. Дополнительную модель владелец пропустил.

F02 остаётся открыт: operator interface/role/preflight, placement refund queue/уведомления, periodic consumer и real TEST/fiscal приёмка. Production/реальные provider HTTP/деньги не затрагивались. Graphify10578/30784 и Code Graph2139/6333 обновлены для текущего корня.

Финальные floor/types/lint/build прошли (только прежний targetType warning); staged Gitleaks без находок. Свежий HTTPS стенд https://127.0.0.1:3045 (`/__local`): health/ready200, фактический HTML/Flight трёх страниц кабинета совпадает с BUILD_ID `WCBkmLZLywT4LyeDhLrtz`. Push/deploy не выполнялись.


## Локальный инкремент F02/0052 — 10.11.2026

Private placement refund queue создаётся только из durable approval0042, имеет raw bounded keyset backfill, SKIP LOCKED/token/lease и cap12. Исходные key/body/window/send cap не расширены. Last-mile monotonic deadline закрывает delayed COMMIT до POST; transactional fence перед effect и после target/notice lock waits предотвращает применение по истёкшей lease. Общие placement processor/approval/effect принимают необязательный callback, прежние вызовы сохраняют права/поведение.

AFTER INSERT effect создаёт одно уведомление исходному существующему payer с причиной/ссылкой на кабинет. Ошибка notice откатывает локальный money/target effect; повтор использует GET и не воссоздаёт удалённое уведомление. Missing historical user не ломает прежний0040 контракт. Operator recovery0051 завершает соответствующий job с полной привязкой к approval/payment/refund/shop; отдельная RED-регрессия обнаружила и закрыла столкновение UUID application payment и чужого placement approval.

Native2571/2571 и все13 PG-наборов758/758 за227.7s прошли. После дополнительной SQL-привязки финальный placement набор31/31, включая новую collision-регрессию. Три негативные мутации last-mile deadline/final lease/bounded raw history обнаружены тестами, исходники восстановлены побайтно. Независимое инженерное ревью завершено; дополнительную модель владелец пропустил. docs/audit-placement-refund-queue.md.

Перед запуском прежнего application compensation consumer нужно также перенести last-mile deadline и финальную lease-проверку на его отдельный effect path. В этом инкременте он не менялся/не запускался; F02 остаётся открыт. Ручная/рабочая схема, runtime права, provider HTTP и LIVE не затрагивались. Graphify10616/30881 и Code Graph2145/6350 обновлены для текущего корня.

Финальные floor/types/lint/build прошли; только прежний targetType lint warning. Staged Gitleaks без находок. Ручной журнал39 миграций и отсутствие финансовых таблиц0048–0052 подтверждены read-only. HTTPS стенд https://127.0.0.1:3045 (`/__local`) запущен: health/ready200; HTML/Flight заказов, откликов и оплаты совпал с BUILD_ID `AIMgWGZc2RfBcF8XMckiD`. Push/deploy не выполнялись.


## Локальный инкремент F02/0053 — 10.11.2026

Закрыты last-mile deadline перед POST и финальный lease fence прежнего application compensation consumer. Новый private remaining helper вызывает прежний0049 guard и возвращает wall-clock бюджет; старые void API/ACL сохранены. Каждый tick имеет свой консервативный монотонный deadline; задержанный ACK admission не позволяет отправку после expiry. После FK/notification INSERT/readback optional fence повторяется в той же транзакции, откатывая money/effect/notice при expiry. Original key/window/cap и история отклика не меняются. docs/audit-application-compensation-lease.md.

Два реальных денежных RED на прежнем коде воспроизведены: лишний POST и effect без финального PBQ01. После исправления focused78/78, native2572/2572 и все13 обязательных PG-наборов763/763 за267.2s без skips. Проверены scope/nonce/expiry, старый void API и отсутствие HTTP/send attempts при missing EXECUTE; после точечного fixture GRANT одна исходная операция исполняется. Независимое ревью плана/кода без новых замечаний; дополнительную модель владелец пропустил.

0053 и её EXECUTE применялись только в disposable fixture. Ручной точный журнал39 проверен read-only, новая функция и очередь компенсаций отсутствуют. Runtime/production/периодические consumers/реальный provider HTTP/LIVE не менялись. Graphify10626/30904 и Code Graph2148/6352 обновлены для текущего корня. Открыты operator interface/role/preflight, service preflight/включение и настоящая TEST/fiscal приёмка.

Финальные floor/types/lint/build прошли (только прежний targetType lint warning); staged Gitleaks без находок. Локальный HTTPS стенд https://127.0.0.1:3045 (`/__local`) перезапущен: health/ready200, фактический HTML/Flight трёх страниц кабинета совпал с BUILD_ID `YW6Eum2NydJqBEVNtcKLF`. Push/deploy не выполнялись.


## Локальный инкремент F02/0054 — 10.11.2026

Подготовлен и одобрен владельцем standalone кандидат blizhniy_refund_worker: NOLOGIN-план точных колонок/EXECUTE, read-only admission и три ALWAYS UPDATE OF id lock-only guard. Временная роль выполняет оба существующих TEST consumer: три вида размещения и компенсацию непросмотренного отклика. Прямые изменения оплаты, публикаций, ID, истории и решения администратора не разрешаются. Старый reconciler/runtime/workflows и права ручного/рабочего сайтов не менялись. docs/audit-refund-worker-role.md.

Реальный RED без0054 воспроизвёл разрешённый UPDATE users SET id=id. После0054 SELECT FOR UPDATE проходит, UPDATE id/noop запрещён для current_user и session_user, в том числе через definer. Штатный definer UPDATE статуса платежа при возврате работает. Отрицательные случаи покрывают лишние/отсутствующие ACL/grant options, PII/сессии, параметры/CREATE во всех схемах, pg_read_binary_file/pg_authid через роль и PUBLIC, полный журнал54/SHA256 и изменённые триггеры/тело/колонки guard.

Инженерное ревью выявило пропущенные системные ACL, параметры и namespace — проверки добавлены. Точный штатный список62 metadata SELECT взят из PostgreSQL18.6 information_schema.sql: эти grants появляются после фиксации pg_init_privs. Проверки сохраняют закрытость новых/внутренних объектов и всех операций записи. Дополнительную модель владелец пропустил. docs/review/refund-worker-role.md и точный patch одобрены только для локального сохранения.

Focused46/46, native2576/2576 и все13 обязательных PG-наборов774/774 за216.8s прошли без skips. Финальные floor/types/lint/build прошли; только прежний targetType lint warning. Сканирование staged изменений на секреты выполняется перед локальным commit. Graphify10644/30951 и Code Graph2151/6359 обновлены для текущего корня.

Ручная БД проверена read-only: точный журнал39, новые refund queues/effect/guard и worker-роль отсутствуют. HTTPS стенд https://127.0.0.1:3045 (`/__local`) запущен; health/ready200, HTML/Flight заказов/откликов/оплаты соответствует BUILD_ID AawxKhTvqmgTqP_oIDBwG. Push/deploy/production/provider HTTP/LIVE не выполнялись.

F02 остаётся открыт: отдельные интерфейс/роль оператора, полная сверка фактических business-объектов БД, перенос расширенных ACL-проверок на прежний reconciler с отдельным review, service/artifact/TLS/магазин preflight и настоящая TEST/fiscal приёмка. Новый кандидат не подключён к runtime/службе.


## Локальный инкремент F02: перенос системных ACL-проверок — 11.11.2026

Оба финансовых guard используют один financial-catalog-privileges.mjs: проверки всех namespace/параметров и дополнительных системных ACL, включая PUBLIC. Старый reconciler сохраняет прежние финансовые колонки, memberships, lock guards и схемы24/25/32/33; его read-only preflight получил statement_timeout5s/lock_timeout1s. В обоих guard добавлены точные namespace исключения и relkind t, чтобы SELECT на TOAST также запрещал допуск. План GRANT, роли, миграции, runtime factory и режим магазина не менялись. Сборщик включает общий модуль в автономный пакет. docs/audit-financial-catalog-privileges.md.

Десять реальных RED воспроизвели старый приём лишних системных прав исходниками и пакетом. После исправления focused367/367 и refund46/46 прошли, включая причинный SELECT на реальную pg_toast relation без schema USAGE. В native fixture схем32/33 добавлены metadata ответы; существующие assertions сохранены. Независимое ревью завершено, замечание pg_toast учтено; дополнительную модель владелец пропустил. Точный docs/review/financial-catalog-transfer.md/patch одобрен только для локального сохранения, SHA256 совпали перед итоговой проверкой.

Итоговый повтор после прерывания11.11: native2576/2576, все13 обязательных PG-наборов785/785 за233.5s без skips. Финальные floor/types/lint/build прошли, только прежний targetType lint warning. Журналы проверок сохранены в закрытом локальном audit-checks вне Git; staged Gitleaks выполняется перед commit. Graphify10646/30957 и Code Graph2152/6365 обновлены для текущего корня; обе связи к общему helper подтверждены по графу и исходникам.

Ручная БД проверена read-only: точный журнал39, новые refund tables/lock guard/роль отсутствуют. HTTPS https://127.0.0.1:3045 (`/__local`) снова запущен: health/ready200, фактический HTML/Flight трёх страниц кабинета соответствует BUILD_ID AG3xPogeDjGW-f-u1t1kz. Push/deploy/production/provider HTTP/LIVE не выполнялись; установленный обработчик не обновлён.

Открыты полная сверка фактических business-объектов БД, интерфейс/роль оператора, service/artifact/TLS/магазин preflight и настоящая TEST/fiscal приёмка. Перед production требуется отдельный пересмотр managed-допуска PAYMENT-PG18-ADMIN-20261020 с прошедшей датой03.11.2026; локальный diff его не продлевает. F02 целиком остаётся открыт.


## F02: сверка фактической схемы — 11.11.2026

Подготовлен и одобрен только локальный кандидат fingerprint app-схемы0001–0054. 66/66 focused,19 причинных mutation-сценариев,2576/2576 native и805/805 в полной последовательной матрице13 PostgreSQL-наборов. Функции, ограничения/колонки/индексы, триггеры, владельцы относительно schema owner, наследование/casts/прочие перечисленные классы сверяются с эталоном свежего source replay, не с произвольным снимком целевой БД. docs/audit-refund-schema.md; точный review docs/review/refund-schema.md/patch.

Два единых Node-прогона упёрлись в180s browser timeout. Последующая матрица отдельных процессов прошла за232.4s без повышения лимитов или изменения assertions. CI-бюджет и устойчивость общего вызова под нагрузкой остаются частью QA01; это не объявляется успешным GitHub gate. Старый reconciler сохраняет схемы24/25/32/33: совместная54 ещё требует service preflight. Ручная/рабочая БД, роли и финансовые consumers не устанавливались.


Финальные floor/types/lint/build прошли; только прежнее targetType lint warning. Ручной стенд подготовлен без применения миграций: read-only проверен точный журнал39, новые refund effects/queue/guard/worker role отсутствуют. HTTPS https://127.0.0.1:3045 (`/__local`) запущен; health/ready200, фактический HTML/Flight заказов/откликов/оплаты соответствует BUILD_ID `A-8sQznk3q2tOhjUyDN9v`. Staged Gitleaks — без находок; новых исключений нет. Push/deploy/production/provider HTTP/LIVE не выполнялись.


## F02: offline refund artifact — 11.11.2026

Добавлен отдельный сборщик canonical placement/application consumers в CommonJS, copied read-only guard/schema sources, точные54 миграции и фиксированный snapshot. Manifest schema54 записывается последним; новый private target не переиспользуется, byte mismatch миграции до записи закрывает сборку. Обычный Node загружает пакет без TS/src/aliases и без import-time сети/PG. Compiled PostgresDatabase + copied guard проверены на существующей ограниченной роли временной PostgreSQL18.6: отказ SQL/ACL drift, три типа размещения и unread-response intake/компенсация с одним fake POST/эффектом/уведомлением, повтор idle. docs/audit-refund-artifact.md.

Старый builder/reconciler, guards, SQL и планы прав неизменны. Новый пакет не включает runner/runtime/operator executor и не устанавливает dependencies; pg нужен из принятого lockfile. Runtime/TLS/merchant admission, совместимость схем54/33, оператор и настоящая TEST/fiscal приёмка остаются открыты. Работа только локальная, без provider HTTP/production/push.


Контроль упаковки11.11: native2578/2578, PG13-наборов808/808 за227.1s без skips, floor/types/lint/build прошли. Настоящий CLI build сохранил35 compiled-модулей/schema54 в private refund-candidates; runtime/служба/роли не устанавливались. Ручная схема39 проверена read-only; health/ready200 и фактический HTML/Flight BUILD_ID lDLpqIqzJbRsf8ICEjSkg проверены. Graphify10660/31022, Code Graph2157/6377 актуальны. Staged Gitleaks — без находок и новых исключений. CI/реальные TEST/fiscal операции и production не проверены этой работой.


## Локальный инкремент F02/runtime — 12.11.2026

В автономный compiled-пакет добавлены явный local-test runtime и последовательный цикл двух потребителей. Factory без ambient конфигурации допускает только локальную TEST-БД, выделенную refund-роль и verify-full TLS. Существующий read-only guard проверяет схему54/ACL до и после bounded merchant GET, затем перед каждым заданием. TEST-магазин должен совпасть и явно иметь отключённую фискализацию; противоречия/отсутствующие значения запрещены. Processing_unavailable отзывает допуск и останавливает цикл; неизвестный COMMIT не повторяется автоматически. Stop дожидается текущей операции; report ограничен техническими полями без приватных данных.

На owned disposable PostgreSQL18.6 проверен настоящий TLS и compiled-путь runtime→service→очередь→fake provider→единственный эффект/уведомление для трёх размещений и непросмотренного отклика. Неверный CA/магазин/лишние права отвергаются, рестарт не дублирует операции. Focused13/13, native2598/2598 и все13 PG-наборов812/812 за224.4s прошли без skips. Три причинные мутации обнаружены, исходники восстановлены побайтно. Сборка приложения, floor/types/lint прошли (прежний targetType warning); staged Gitleaks — без находок. Graphify10689/31088 и Code Graph2165/6393 обновлены для текущего корня. docs/audit-local-refund-runtime.md.

Текущий ручной контейнер остановлен с exit0, owned definition подтверждена read-only; повторная проверка журнала SQL в этом прогоне не выполнялась. Его запуск, схема39, роли и настройки не менялись. Runtime не установлен на ручной или рабочий сайт. Открыты операторский интерфейс/отдельная роль, общая схема прежнего reconciler и refund worker, настоящая provider TEST/fiscal приёмка и установка службы. Первый большой этап целиком остаётся открытым; push/deploy/production не выполнялись.


## Локальный кандидат F02/совместимость схемы54 — 12.11.2026

Подготовлен draft допуска прежнего payment reconciler на полной54: точный журнал, полный fingerprint business-схемы, отказ при установленной refund-таблице и усечённом журнале32/33. Cabinet ACL, lock guards, managed-допуск и все прежние запреты сохранены; дополнительных прав не требуется. Offline package содержит проверяемые metadata/байты54, прежние compiled payment consumers. Новые refund consumers/оператор в него не включены.

На owned disposable PG54 исходный и compiled guard проверены вместе с двумя настоящими ограниченными ролями: created→captured→публикация→возврат→безопасный повтор; reservation перед исполнением даёт publication_blocked без публикации/срока/receipt. Целевой набор73/73 и native2601/2601 прошли, два причинных отключения защиты обнаружены, файлы восстановлены. Подробности docs/audit-reconciler-refund-coexistence.md; точный пакет docs/review/reconciler-schema54.md. Точный guard одобрен владельцем12.11 только для локального сохранения; установленный обработчик/ручной и рабочий сайт не менялись. Все13 обязательных PG-наборов816/816 за240.9s прошли без skips. Сборка приложения, floor/types/lint и staged Gitleaks прошли. Graphify10690/31125 и Code Graph2167/6399 обновлены.

Первый большой этап всё ещё открыт: отдельная роль и интерфейс оператора, реальная совместная runtime/служебная композиция и TEST/fiscal приёмка. Локальная совместимость guard сама по себе не устанавливает финансовые роли или службы. Push/deploy/production/provider HTTP не выполнялись.


## Локальный кандидат F02/operator55 — 12.11.2026

Предыдущий точный54 patch одобрен владельцем и сохранён вd4207a3. Следующий кандидат — отдельный NOLOGIN-план blizhniy_refund_operator и read-only допуск точных колонок/EXECUTE, schema55/fingerprint и трёх новых ALWAYS lock-only0055 guards. Оператор не получает reservation/request/anchor/attempt/candidate/queue WRITE/EXECUTE; исходные READ/блокировки нужны переиспользуемым approval и GET-only recovery. Это доверенная финансовая роль с доступом к session hashes/receipt sources, без заявления SQL-RLS изоляции от её компрометации.

Права прежних workers не меняются. Они могут принять точные54/55 с соответствующим полным fingerprint; builders сохраняют default54, явный55 включает оба эталона и проверенные55 исходников. Отдельный offline operator package содержит канонические approval/read/recovery без send consumers, запуска службы, dotenv и GRANT executor.

На owned disposable PG18.6 проверены source/compiled роли и канонические API под точным оператором: три размещения и компенсация непросмотренного отклика, один POST прежнего worker, один effect/notice и сохранность истории; live-session refusals/revocation и потеря финального COMMIT с readback без HTTP. Эталон55 повторён под другим владельцем; mismatched journal/schema, неизвестная56, новые guard/ACL/system-эскалации отвергаются. Целевой PG86/86, native2605/2605 и floor/types/lint прошли. Все13 обязательных PG-наборов829/829 за322.8s прошли без skips, включая causal ID control. Сборка приложения и проверки упаковки прошли; staged Gitleaks без находок. Graphify10713/31242 и Code Graph2174/6415 обновлены для текущего корня. docs/audit-refund-operator.md.

Точные новые guards/планы одобрены владельцем12.11 только для локального сохранения. Роли, миграция55 и пакеты не установлены на ручной/рабочий сайт; manual39/production33, настройки/платежи/SSH не менялись. Операторский runtime/transport/интерфейс админки и настоящая TEST/fiscal приёмка остаются открыты. Первый большой этап целиком не завершён; push/deploy/provider HTTP отсутствуют.


## Локальный инкремент F02/operator runtime — 12.11.2026

Точный operator55 diff одобрен владельцем и сохранён в9e50eb0. Добавлена явная фабрика только для локальнойTEST-БД/операторской роли/verify-full TLS. Canonical input фиксируется до async admission, merchant immutable, config/PG/TLS overrides запрещены. Все действия повторно проверяют role/schema; канонические API проверяют live-admin. Exposed только preflight/approve/readForAdmin/recover/close, overlap отказ/дренирование/один close, ошибки редактированы. POST/aborted requests запрещены; нет SQL/командного retry или новых IDs.

Старый первый авторизованный этап GET-recovery выделен в prepare без изменения legacy recover flow. Терминальное доказательство читается локально при provider outage; новый recovery сначала фиксирует/читает исходное действие, затем проходит merchant admission до начала refund GET budget и повторно авторизуется. ReadForAdmin не зависит от provider. Ошибку shutdown и outage-регрессию воспроизвели RED и исправили; независимое ревью завершено, дополнительную модель владелец пропустил.

Compiled runtime проверен на настоящем TLS/PG55 и точной роли: preflight без financial writes, wrongCA/merchant/excessACL refusals, approval/read/recovery один раз, terminal readback при полном outage без HTTP, revocation во время probe не создаёт effect. Целевой PG90/90, native2614/2614, floor/types/lint прошли; две causal мутации обнаружены и восстановлены побайтно. Все13 обязательных PostgreSQL-наборов833/833 за239.8s прошли без skips; сборка приложения и staged Gitleaks завершились успешно. Graphify10734/31292 и Code Graph2177/6424 обновлены. docs/audit-local-refund-operator-runtime.md.

Ручной/рабочий сайт, роли, schema39/33, сервисы и provider HTTP не затрагиваются. Transport и UI админки, установка локального оператора и реальная TEST/fiscal эксплуатационная приёмка остаются открыты. Этот runtime не является установленной функцией сайта; первый большой этап ещё открыт.


## Локальный блок F02: админка и закрытый IPC — 12.11.2026

Runtimeaa97979 подключён к новому actor-scoped журналу и интерфейсу решений: local-only view, bounded scroll/page50, причина/полный возврат/явное подтверждение, GET-сверка по candidate/link или известному ID ЮKassa. Общедоступного production route/новых GRANT/миграций нет. Явный local ingress→сокет0700/0600→точная роль/schema/TLS→live-admin→старые канонические операции. Source receipts/контакты/session hashes/секреты не выдаются; body4KiB/2s ограничен до Fetch-buffering, response256KiB и временные пределы, no retry/overlap queue.

До действия точный ID сохраняется/прочитывается из actor-scoped sessionStorage. Reload не отправляет деньги; неизвестный результат допускает только явный same-ID replay или связанный readback. При blocked storage команда не отправляется. Loading/revocation/actor change убирает private DOM и игнорирует поздние ответы. Исправлен найденный review случай lost POST response без candidate: доказанная provider link сохраняет статус в журнале; reservation связана с исходным merchant/payment.

Целевой реальный PG93/93, native2629/2629 без skips, все13 обязательных PG-наборов836/836 прошли. Матрица выявила прежнюю микросекундную гонку search fixture; в отдельном7556ff2 исправлены только тестовые временные отметки, constraint/assertions сохранены, три повтора18/18 прошли. Итоговая матрица использует зелёные журналы неизменённых наборов и выполненное продолжение. Причинный контроль provider-link fallback сломал новую PG-регрессию, исходник восстановлен побайтно. Сборка и staged Gitleaks прошли. Browser на настоящем Next/Chromium проверил unknown/reload/readback, recovery, отзыв роли, смену actor и ширины320–1440; axe0 serious/critical, без внешнего трафика/настоящего provider. Независимые backend/UI ревью завершены, дополнительную модель владелец пропустил. Graphify10819/31571 и Code Graph2200/6473 обновлены. docs/audit-local-refund-admin.md.

Постоянный ручной контейнер по owned definition остановлен штатно, exit0; текущий SQL journal не перечитывался. Его историческая БД называется blizhniy_prod, новый refund runtime допускает только blizhniy_test. Следующий блок — точный owned/TLS допуск этого локального стенда и пакет установки; переименование, обход admission, новые роли/миграции/службы на нём не выполнялись. Production/schema33, SSH, реальные деньги и внешние provider-запросы не менялись. Первый большой этап всё ещё открыт до установки/общей композиции и настоящей TEST/fiscal приёмки.


## Локальный кандидат F02: owned manual target — 12.11.2026

Админка/IPC сохранены в64d4ae2, search fixture —7556ff2. Следующий кандидат добавляет отдельный createLocalPrimaryRefundOperatorRuntime: до выбора фиксированного blizhniy_prod read-only проверяются защищённый state, текущие owned Docker definition/live binding и сертификат контейнера. Обычный вход остаётся ограничен blizhniy_test. Сертификат сверяется с фактическими ssl.ca/rejectUnauthorized того же Pool config; повторного чтения доверенного файла после сравнения нет. Новой environment bypass-переменной/произвольного DB override не добавлено.

Ревью выявило риск CA TOCTOU — исправлен; повторное ревью без замечаний. Новый owned disposable PostgreSQL18.6/schema55/TLS подтвердил compiled новый вход, отказ обычного входа, wrong project/port/config CA до Pool/provider. Focused14/14, расширенный PG95/95 и native2632/2632 без skips прошли. Причинное удаление сравнения CA обнаружено, исходник восстановлен побайтно. Автономная сборка/import без процесса/сети, floor/types/lint и staged Gitleaks прошли. Graphify10835/31641 и Code Graph2203/6483 обновлены для текущего корня. Остальные12 PG-наборов в этом инкременте не повторялись; последний общий13-наборный836/836 сохранён для предыдущего блока. Next-приложение не менялось и повторная его сборка не заявляется.

После предложения точного docs/review/refund-owned-local-target.md/patch владелец12.11 поручил «продолжай работу»; разрешение использовано только для локального сохранения этих проверенных версий, без установки. Содержание семи before/after не менялось: исправлено только оформление двух пустых context-строк patch, обе версии reverse-check проходят; исходная версия сохранена в закрытом audit-checks. Постоянный ручной/рабочий стенд, роли/миграции/службы/provider/LIVE не менялись. Следующий отдельный пакет — установка и совместная композиция (включая owned допуск refund worker), затем настоящая TEST/fiscal приёмка. Первый большой этап открыт.
