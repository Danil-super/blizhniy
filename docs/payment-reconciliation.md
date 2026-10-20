# Доставка результата оплаты: webhook и очередь сверки

Локальный срез L17 поверх [подготовки заказа](listing-checkout-http.md),
[dispatch](primary-payment-dispatch.md), [сверки](postgres-payment-verification.md)
и [однократного исполнения](listing-payment-fulfillment.md). Не установлен на
рабочем сайте; новые DDL/grants и сервисы production не применялись.
Ручное внешнее финансовое ревью отложено владельцем и не считается пройденным.

## Контракт и границы доверия

Новый `POST /api/payments/yookassa/primary-webhook` принимает только подсказку
об уже известном платеже обычного объявления. Уведомление не подтверждает
деньги и не публикует карточку. Для окончательной проверки worker выполняет
авторитетный GET исходного provider ID через существующий строгий validator;
проверяются магазин, TEST/LIVE, сумма и четыре metadata-привязки.
Затем отдельная транзакция исполняет исходное размещение с immutable receipt.
Worker этой очереди не делает provider POST и не создаёт новый платёж.

Входящий JSON может содержать полный платёж, но извлекается только UUID
`object.id`; `type` должен быть `notification`, `event` — одной из строк
`payment.succeeded`, `payment.waiting_for_capture`, `payment.canceled`.
Статус, сумма, metadata, email, банковские данные и чек из уведомления
не становятся финансовой истиной, не сохраняются и не журналируются.
Возвраты и другие типы услуг пока не обслуживаются этим endpoint.

Разрешены только точный Host настроенного origin, отсутствие query и IP из
документированного списка отправителей. Берётся только `X-Real-IP`, который
текущий локальный ingress обязан перезаписывать socket peer; Next должен
слушать loopback. XFF/Cloudflare-headers не служат заменой. Allowlist IPv4/IPv6
проверен19.10.2026; его изменения требуют пересмотра. Это дополнительный фильтр,
не замена сверки провайдера. Правила доставки, HTTP200 и список сетей:
[официальные HTTP-уведомления ЮKassa](https://yookassa.ru/developers/using-api/webhooks).

JSON ограничен64KiB/1024chunks/2s, включая зависший read; неоперативный
`cancel()` не продлевает deadline. UTF8 строгий, плохой формат —400,
запрещённый ingress —403, неподдержанный метод —405, timeout —408,
слишком большой body —413, content type —415. Все ответы no-store/no-referrer.
HTTP200 `{ok:true}` возвращается только после подтверждённого COMMIT admission
известного UUID в свою очередь. Неизвестная привязка, ошибка/неизвестный COMMIT
дают generic503 без текста SQL/provider-ошибки, позволяя сервису повторить
доставку в его24-часовом окне. Это также покрывает webhook до bindProvider.

## Долговечная работа и отказоустойчивость

Миграция0023 — новая private таблица `app.payment_reconciliation_jobs`.
FK требует существующую immutable связь provider→intent. Одна строка на intent;
приём по provider ID дополнительно ограничен merchant/mode/type listing.
`ON CONFLICT(intent_id) DO NOTHING` сохраняет первую работу без сброса claim,
срока, attempts, backoff и completed/blocked. Чужой магазин, другой режим,
неизвестный provider и linked не-listing не могут породить задачу.

| Состояние | Обработка |
|---|---|
| queued | Готовность по SQL clock; обработчик выбирает одну задачу |
| processing | Новый случайный claim UUID,120s SQL lease; краткая транзакция с SKIP LOCKED |
| completed | Финальный отменённый/возвращённый заказ или подтверждённое исполнение; дубликаты не возобновляют |
| blocked | Проблема публикации либо исчерпание12 попыток; сохранено для оператора, не выброшено |

Pending/нет capture/ошибка обработки планируют повтор:30s,60s и далее
экспоненциально, максимум3600s. После12 неудач — attempts_exhausted; сбой процесса
на последней аренде тоже становится blocked после её истечения.
Ошибка COMMIT claim не повторяется автоматически: ждём SQL lease.
Ошибка COMMIT завершения выходит наружу без второго acknowledgement.
Неизвестная запись денег/исполнения повторно сверяется тем же GET и использует
первую immutable запись исполнения, не новую оплату или новый срок.

Старый claim не может завершить или перенести задачу после истечения lease
или её получения другим worker. Владение проверяется до GET и до fulfillment.
Это **не транзакционная блокировка всех финансовых действий lease-токеном**:
lease может истечь в отдельной транзакции. Безопасность повторного финансового
исполнения обеспечивают уже существующие блокировки, монотонная сверка и
однократная запись публикации, а не обещание exactly-once доставки очереди.

`createPaymentReconciliationWorker(...).tick()` — явный один шаг с результатом
idle/lost/completed/deferred/blocked. Следующий локальный
[service-срез](payment-reconciliation-service.md) добавляет последовательный цикл
и адаптер сигналов, но не production runtime factory, отдельную роль или установку.
Автозапуска, PM2/systemd установки или нового CLI с доступом к деньгам нет.

## Выключатели, права и откат

По умолчанию новый endpoint возвращает503 WEBHOOK_DISABLED до auth/pool.
Явное включение пока только `BLIZHNIY_PAYMENT_WEBHOOK=queued-test`,
`BLIZHNIY_PAYMENT_MODE=test`, `BLIZHNIY_PAYMENT_SHOP_ID`. LIVE отклоняется.
Выключатель независим от admission новых checkout: запрет новых заказов
не должен мешать доставке результатов старых. HTTP не читает merchant secret
и не получает полномочия финансового worker.

Используется прежняя закреплённая production-auth конфигурация/pool; локальный
HTTP Request-фабричный тест с настоящей PostgreSQL не означает проверку
активного опубликованного Next route с этой конфигурацией. Защитная привязка
к production host/role не ослаблялась ради локального запуска.
Старые `/api/payments/yookassa/webhook` и `/api/webhooks/yookassa` в postgres
или неизвестном auth mode fail closed до старого хранилища. Legacy local mode
сохраняется для прежних регрессионных проверок, без fallback нового callback.

Bootstrap0023 только через `includePaymentReconciliation:true`, без нового
CLI/app/deploy hook. Все22 предыдущих hash сохранены. Up не выдаёт прав.
Down проверен для пустой таблицы и отказывается уничтожать непустую очередь.
Операционный откат — выключить callback/worker, сохранить незавершённые задачи,
а не удалять финансовую историю.

В одноразовой БД ingress-роли достаточно SELECT нужных идентификаторов/scope
из intent/link и INSERT+SELECT только `jobs.intent_id`. SELECT ключа необходим
для conflict_target: [права INSERT/ON CONFLICT PostgreSQL18](https://www.postgresql.org/docs/18/sql-insert.html).
Чтение state/receipt/users, изменение очереди/денег/публикации/удаление запрещены.
Отдельная claim-роли проверяет SELECT/ограниченный UPDATE только queue и scope,
без INSERT задач, доступа к плательщику или финансовых/публикационных изменений.
Эти роли созданы только в disposable fixture, не в production. Полномочия
настоящего объединённого verification/fulfillment worker ещё требуют отдельной
подготовки и приёмки, не выводятся из доказательства прав claim-роли.

## Наблюдаемость и проверка

Webhook audit: стабильный event, entryPoint=webhook, requestId, status,
durationMs, generic code. Ни body, ни IP, ни user/provider/order ID в лог не идут.
Вопросы оператора: есть ли недоставленная работа, почему блокируется исполнение,
растёт ли число отказов callback? Для первых двух — durable state/last_code/
attempts/created_at, для последнего — audit status/duration. Метрики, alert и
постоянный процесс ещё не установлены; этот срез не закрывает L25.

Первый безопасный запрос для диагностики через будущую доверенную роль:
`select state,last_code,count(*),min(created_at) from app.payment_reconciliation_jobs group by state,last_code;`
При blocked не генерировать новый платёж и не менять is_paid вручную;
проверить исходную сверку/receipt и причину, согласовать дальнейшее действие.
Инструмент повторного запуска blocked пока не реализован и не обещается.

Новые тесты воспроизводят RED до реализации. Реальная owned PostgreSQL18
проверяет down/up, минимальные права, конкуренцию, точное сохранение строк
при дубликатах, unknown COMMIT на admission/claim/finance/fulfillment/finish,
lease-loss внутри GET, backoff/исчерпание и Request→queue→GET→once-only publish.
Транспорт ЮKassa синтетический: ни одного запроса в настоящий магазин.
Мутация инверсии source-IP проверки ломает3 native проверки; после
восстановления все4 webhook проверки проходят.

Контрольная точка19.10: native1585/1585 и PostgreSQL310/310 без пропусков,
production build и явный tsc после сборки успешны. Smoke собранного Next
проверяет default-off нового callback, отказ обоих старых маршрутов в
postgres-режиме и405 для GET:1/1. Это проверка HTTP-границ, не настоящий
merchant E2E. Lint:0 ошибок, прежнее unused-предупреждение в
`tests/checkout-prerequisites.test.cjs:30` сохранено. Floor и staged secret
scan проходят; SAST/dependency CI этим локальным срезом не объявляются пройденными.

Остаются: admission/recovery dispatch без известного provider ID, production
фабрика/роль/preflight и установка ограниченного worker, настоящий изолированный TEST
магазин+callback E2E, история/кнопка оплаты и остальные услуги/возвраты.
Новый финансовый режим нельзя включать до отложенного внешнего ревью,
отдельного согласования DDL/прав/rollout и завершения перечисленных проверок.
Полный функциональный перенос ещё не завершён.
