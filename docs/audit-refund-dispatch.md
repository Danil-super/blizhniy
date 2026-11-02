# F02: TEST-отправка, неизвестный исход и восстановление

Локальный инкремент02.11.2026: private `createPrimaryRefundDispatcher`, `PostgresRefundDispatchStore`, opt-in0039 и `readPrepared` существующего request store. Только полный TEST-возврат объявления/вакансии/заказа, только подготовленные исходные bytes/key. Маршрут, cron/worker consumer, production bootstrap и GRANT не добавлены. Все HTTP в проверках — in-process fixture; настоящий провайдер не вызывался, рабочие серверы/БД и ручная схема35 не менялись.

## Процесс

`dispatch(operationId, authorizeRefund)` требует функцию текущего допуска до SQL/сети. Caller — доверенный финансовый обработчик; будущий callback обязан проверять инициатора/основание и совместимость чека/способа оплаты после потенциального ожидания SQL locks. Здесь эта бизнес-политика не заменяется TEST-флагом. Пропуск callback запрещён, а публичного caller пока нет.

`readPrepared` только читает уже сохранённую подготовку: исходная покупка/TEST/магазин/сумма, canonical refund body/SHA/key и сохранённый capture. Не создаёт request/anchor и не копирует receipt/контакты из purchase body в результат. Порядок блокировок source store — user→intent→order. Сеть выполняется после COMMIT.

Если известен candidate0039 или GET-verified ID0038, выполняется только авторитетная сверка0038. Истечение окна или исходный order=refunded не разрешают новый POST и не мешают восстановлению известного ID. Противоречие между журналами требует reconciliation.

Перед первым возможным POST без прежних attempts выполняется строгий provider inspection. Найден и воспроизведён отдельным RED недочёт: согласованные между собой GET snapshots могли противоречить сохранённому capture, а POST происходил до обнаружения этого при readback. Теперь inspection принимает optional stored capture, проверяет календарь/будущее до сети и сравнивает его с первым и последним GET с полной точностью. При missing provider capture сохранённая дата ограничивает историю. Результат inspection остаётся прежним, старые тесты/contract не ослаблены.

До каждого HTTP attempt фиксируется новая durable запись `payment_refund_send_attempts` с исходным request SHA и временем БД. Первоначальный anchor0037 не сбрасывается:23ч55мин — консервативное окно внутри [24-часовой идемпотентности ЮKassa](https://yookassa.ru/developers/using-api/interaction-format). Остаток рассчитывается в БД и уменьшается на полную monotonic latency, включая COMMIT, затем ещё на scheduling await. Повтор использованного attempt UUID запрещён; за всю operation допускается не более12 возможных отправок под одним и тем же ключом. Callback, SQL или сеть могут прервать выполнение после записи attempt — это консервативное UNKNOWN, не доказательство доставки.

POST идёт только на фиксированный `/v3/refunds`, с исходными body и `refund-<operation UUID>`, Basic TEST merchant, cache=no-store, redirect=error. Перед каждой попыткой заново проверяются canonical source/байты/сохранённый capture, оригинальное окно и текущий callback допуска. Финальная проверка transport deadline следует после callback. Один POST budget ограничен35s/3attempts и прежними64KiB/2048chunks. Inspection и последующий authoritative readback имеют отдельные ограниченные бюджеты: полный процесс не объявляется общим35s. Будущий caller должен исполнять его как финансовую фоновую работу, не скрытый синхронный долгий UI запрос.

Повтор при уже существующем durable attempt не выполняет новый balance inspection: собственный pending refund не должен запрещать восстановление того же idempotency key. Он повторяет только прежний запрос в прежнем окне. [Ошибка500 или потеря ответа не доказывают отказ операции](https://yookassa.ru/developers/using-api/response-handling/recommendations). Новый ключ, отмена reservation и успех из такого исхода не создаются. При12 attempts или истечении окна без ID необходима операторская сверка.

POST reply проверяется по original payment ID/полной сумме/RUB/local operation metadata/capture. Затем candidate ID сохраняется в `payment_refund_candidates` **до** GET readback. Candidate — проверенный ответ на отправку, не финансовое исполнение услуги. Неверный ответ не записывается, attempt остаётся. Сбой после сохранения candidate, в том числе COMMIT/lost ACK, означает следующий запуск GET-only. Поздний валидный ответ допускается сохранить после cutoff; возврат не теряется из-за истечения времени отправки.

## SQL-инварианты

Обе таблицы append-only: UPDATE/DELETE/TRUNCATE запрещены даже владельцу при включённых guards. Время/SHA задаёт БД; candidate связан с конкретным attempt и operation. Invoker/VOLATILE функции с пустым search_path и отозванным PUBLIC EXECUTE проверяют source/TEST/full placement/RC/capture/байты, берут intent→order и читают новые snapshots после ожиданий. Права вставлять timestamp/hash fixture-worker не получает. Down только для пустой0039; чужая0038 история сохраняется.

Из ревью исправлены два случая: matching attempt ID больше не обходит лимит; известный0038 ID тоже запрещает POST. Один provider UUID глобально принадлежит одной operation в0038+0039, а одна operation не может иметь разные ID. Для этого дополнительный `zz_` trigger на обеих таблицах после canonical intent/order guard берёт общий transaction-level advisory UUID lock и перечитывает оба журнала. [PostgreSQL18 запускает однотипные triggers по имени](https://www.postgresql.org/docs/18/trigger-definition.html), а [transaction advisory locks освобождаются при завершении транзакции](https://www.postgresql.org/docs/18/explicit-locking.html); коллизия hash только сериализует лишние операции. Настоящие конкурирующие INSERT в разные таблицы проверены в обоих направлениях через `pg_blocking_pids`.

## Границы и оставшаяся работа

Нет автоматического применения возврата к услуге, финансового actor/reason audit, фискального допуска/чека, production queue/webhook activation и компенсаций непросмотренных откликов. Callback — обязательная точка интеграции будущей политики, не доказательство её реализации. Нынешний immutable body не содержит refund receipt; для сценария, где он обязателен, этот путь включать нельзя. Нельзя дописать чек в уже uncertain request с тем же ключом. Реальный TEST end-to-end и production schema/ACL preflight ещё не выполнялись. LIVE и настоящие возвраты выключены.

Перед активацией нужно обновить schema/ACL preflight финансовой роли: новый identity trigger на0038 также читает0039. Без точечных SELECT прав прежний writer0038 откажет закрыто. Миграция сама прав не выдаёт; это не разрешение установить её отдельно от проверенного состава/прав.

## Проверки

21 новый native сценарий, итоговый полный набор2519/2519 без skipped. Отдельный PostgreSQL18.6 runner проверяет19 групп на полном составе0001–0039 с точными39 именами/SHA. Для трёх видов размещения выполнены inspection3GET→POST→readback2GET и проверена неизменность оплаты/услуги. Есть реальные SQL ожидания, concurrent38/39 UUID collisions в обоих направлениях, попытки повторить attempt ID после1/12 отправок, исходный cutoff, callback/deadline, late candidate, COMMIT/lost ACK, rollback, ACL/RC/immutable history и empty/nonempty down. Provider calls только fake, контейнеры после canonical и mutation прогонов удалены с проверкой ownership.

Поведенческий capture RED сохранён до исправления. Отключение SQL lifetime12 guard в sensitivity experiment обнаружено тестом; файл восстановлен побайтно, затем canonical19/19 повторён. Независимое read-only ревью закрыло найденные случаи, Required замечаний после исправлений нет. Types/floor/lint/build прошли; прежнее `targetType` warning не скрыто. Graphify code-only и Code Graph обновлены и видят новые файлы. Никаких новых npm dependencies, защищённых workflow/guard или изменений старых tests нет.

Артефакты — `/home/danil/.cache/blizhniy-audit-f02/dispatch-{native.tap,postgres.log,capture-red.log,capture-green.log,mutation.log,types.log,lint.log,floor.log,graphify.log,build.log,readiness.json}`. `dispatch-red.log` — явно обозначенная запись первоначального missing-module RED из tool output, а не синтетический TAP-прогон. Фактический поведенческий RED — `dispatch-capture-red.log`.

Локальная сборка запущена на `https://127.0.0.1:3045`: HTTPS ready200 и реальный HTML/Flight BUILD_ID `tUPdQMQeEOjV4vI_X4Yhz` подтверждены readiness helper. Это не опубликованный выпуск. Ручной стенд сохраняет схему35; новая39 установлена только в своей удаляемой fixture.
