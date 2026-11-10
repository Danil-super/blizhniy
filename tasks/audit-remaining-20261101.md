# Что осталось после аудита

Состояние на10.11.2026. Предыдущий выпуск объединён в main и установлен как `cad32102463031dd96f0a1af168c9410ac931ff1`; production-схема0033 и совместимый TEST-guard проверены. Новые исправления F05 и F02 выполняются только локально в `fix/local-audit-booking-lifecycle-20261103`. Наличие исходников возвратов не означает их активацию. Канонический подробный журнал — `tasks/audit-20261029.md`.

## Незавершённые функции и финансовые сценарии

| Пункт | Что ещё требуется | Проверяемый результат |
|---|---|---|
| F01 | Закончить оплату/исполнение всех предусмотренных платных услуг и сверить local/production composition. Не вводить новые платежи за бесплатные сценарии | Изолированный TEST: возврат из провайдера/закрытие вкладки, webhook/polling, повторы/late events/unknown; услуга исполнена один раз. Рабочий account TEST ничего не публикует |
| F02 | Возвраты размещений и специальные компенсации платы за непросмотренный отклик | Policy/инициатор/чек, активация очереди/уведомлений/операторского recovery, real-provider acceptance; Финансовое исполнение компенсаций откликов; private допуск0043 и сериализация решений проверены локально. Локально готовы disclosure/reservation/request/window/inspection, GET journal0038, sender0039, once-only service effect0040 и processor; добавлено неизменяемое решение администратора0042 с причиной и полной исходной суммой, проверен полный0001–0042. Реальный провайдер не вызывался, production-off |
| F03 | Восстановить прежние оплаченные расхождения версий; безопасно отменять подготовку до dispatch | Авторитетная сверка + операторский recovery/возврат; unknown не освобождается по возрасту, immutable binding и active-order unique остаются. Новые изменения полей/фото при checkout уже заблокированы локально |
| F04 | Исполнение удаления аккаунта и политика хранения связанных данных | Реальное удаление/анонимизация по правилам, включая финансовую/контактную историю, файлы и резервные копии. Приём и админская обработка запроса0033 уже установлены в production |
| F05 | Локальная часть проверена; остаётся отдельный production rollout и эксплуатационная приёмка | 6часов/3pending, отмена обеими сторонами до начала, immutable start/host, журнал/уведомления, эффективный expiry и bounded sweeper. Native2530/2530, PG17/17, browser8/8 отдельно и настоящий local compiled HTTP→SQL→browser прошли. Подробности — `docs/audit-booking-lifecycle.md` |
| F06 | Полный lifecycle вакансий, заказов и сервисных размещений | Снятие/возврат/архив/удаление и новый оплаченный период с сохранением старой финансовой истории |
| F08 | Освобождение квоты и удаление лишних фото | Reference-aware cleanup, owner limits, fencing и reconcile; живые ссылки, snapshots и активные покупки сохраняются |

Для F02 подтверждены публичные правила Профи.ру о непросмотренном отклике; собственный wallet, абонементы и внутренний чат не добавляются. Владелец согласовал только полный возврат размещения по решению администратора с причиной; успешный возврат прекращает размещение. За непросмотренный отклик предусмотрена компенсация также при снятии/удалении заказа самим заказчиком. Частичные возвраты не добавляются. Финансовое исполнение компенсаций откликов ещё не завершено. Сейчас от владельца не требуется действие для продолжения локальной технической работы.

## Интеграция и приёмка выпуска

| Пункт | Что ещё требуется |
|---|---|
| F16 | Проверить production ingress/nonce/reporting и совместимость внешних провайдеров до включения enforce CSP |
| F17 | Подключить локальный handoff к реальному процессу выпуска; проверить разные сборки, общие сессии/лимиты, единственные workers, старые assets и ресурсный запас |
| F18 | Усиление rollback установлено с cad3210; остаётся реальная приёмка outage/reboot/cross-build восстановления |
| QA01 | Сделать настоящий PostgreSQL обязательным CI/release gate. Подготовить конкретный workflow diff для review по CONSTRAINTS.md |
| DEP-MINIMATCH-20261101 | Совместимое исправление нового moderate build/dev advisory либо отдельное решение владельца об остаточном риске перед релизом. Проверенная текущая ESLint-конфигурация не вызывает уязвимый level2 путь; finding не скрыт |
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
