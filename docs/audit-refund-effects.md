# F02: однократное прекращение возвращённого размещения

Локальный инкремент02.11.2026: `PostgresPlacementRefundEffectStore`, `createPrimaryPlacementRefundProcessor` и opt-in0040. Только полный TEST-возврат `listing`/`vacancy`/`workRequest`. Production/manual bootstrap, grants, HTTP и worker activation не добавлены. Ручной стенд сохраняет схему35. Все provider calls в проверках подменены; реальных возвратов нет.

## Поведение

Processor соединяет0039 отправку/GET recovery с0040 эффектом. `pending` и `canceled` возвращаются без изменения услуги. Только авторитетный `succeeded`0038 разрешает apply. Ошибка SQL при применении не отменяет уже подтверждённый возврат: durable candidate/GET journal сохраняются, следующий запуск выполняет GET-only recovery и повторяет однократный эффект. Текущий допуск инициатора/основания и фискального сценария по-прежнему обязан предоставить будущий финансовый caller; обязательный callback не является реализацией этой политики.

Одна неизменяемая запись `payment_refund_effects` связывает operation, исходный payment intent, provider refund, магазин и target. Услуга и receipt обновляются в одной транзакции:

- `unfulfilled`: исходного fulfillment receipt нет; исходный order становится refunded, target не меняется. Reservation0036 продолжает запрещать новое исполнение этой покупки.
- `revoked`: текущий target всё ещё принадлежит владельцу/виду и исходному оплаченному периоду. `is_paid=false`, published/paid переводится в archived; остальные статусы сохраняются. Исходные даты, revision, форма, фотографии и block/deletion markers не меняются.
- `superseded`: текущий период отличается либо другой succeeded order имеет fulfillment того же периода. Новая оплаченная услуга остаётся без изменений.
- `missing`: target отсутствует либо его владелец/вид больше не совпадают. Чужая карточка не меняется; финансовый факт сохраняется.

Исходные amount/body/SHA/capture, GET observations и fulfillment receipt не переписываются. Уже refunded order допускается для позднего применения/защиты нового периода; остальные неподтверждённые состояния запрещены. Повтор существующего0040 receipt проверяет immutable binding/refunded status и возвращает точную прежнюю запись до доступа к target: новая публикация и `appliedAt` не меняются. Pending/created replacement checkout в исходном периоде, включая противоречивую преждевременную receipt, требует операторской сверки. Checkout fence0034 не ослаблен.

## Ограниченная SQL-операция

Store принимает operation и конфигурацию TEST merchant. Для него достаточно SELECT0040 и INSERT только `(operation_id,merchant_shop_id)`; UPDATE оплаты/target и чтение приватного исходника роли не выдаются. SECURITY DEFINER trigger с пустым search_path и отозванным PUBLIC EXECUTE проверяет точный магазин, полный TEST source, reservation/request/key/SHA/window/capture и успешный GET proof. Входные derived поля и время запрещены; SQL вычисляет их самостоятельно. UPDATE/DELETE/TRUNCATE0040 запрещены, down допустим только пустой.

Порядок locks — user→intent→order→target. При отсутствии исторического пользователя прямое применение эффекта продолжает работать; target берётся по ID до проверки владельца/вида. Отдельные VOLATILE queries после ожиданий видят свежие источники и новое размещение, согласно [READ COMMITTED](https://www.postgresql.org/docs/18/transaction-iso.html) и [видимости volatile functions](https://www.postgresql.org/docs/18/xfunc-volatility.html). Другие intent/order после target не блокируются. Перед изменением target исходный order переводится в refunded, что согласуется с существующим checkout edit fence. Ошибка любого trigger/constraint откатывает order, target и receipt совместно.

Дополнительный RED обнаружил: одного согласованного SHA исходного body недостаточно для обнаружения повреждённой структуры confirmation. Добавлены проверки финансовых bindings и JSON field shape, включая допустимые top-level keys, confirmation type, metadata, amount/capture и при наличии исходный receipt/customer/items. Реальный положительный receipt проверен для всех трёх видов. Это **не** дублирование полного `parsePaymentIntent`/WHATWG URL parser: return_url здесь не используется и не исполняется; SQL не заявляет эквивалентность URL-парсинга или UTF-16 length semantics. Receipt/contact body не копируется в новую историю или результат. Сетевая достоверность0038 — обязанность доверенного GET writer, SQL проверяет внутреннюю целостность этого доказательства.

Унаследованное ограничение: существующий0039→0037 `readPrepared` требует историческую user row, поэтому processor не объявляется поддерживающим удалённого пользователя. Для уже GET-подтверждённого возврата прямой0040 capability этот случай поддерживает. Операторское восстановление и полная политика удаления/retention остаются открыты.

## Проверки и оставшаяся работа

Новый disposable PostgreSQL18.6 runner проверяет полный0001–0040 и40 точных имён/SHA.34 группы охватывают три вида размещения, старый/новый/одинаковый период, edited/block/deleted/missing owner/kind, неверный merchant, partial amount mismatch/LIVE source, pending/canceled, source checksum и shape, валидный receipt, SQL isolation/ACL/derived columns, отсутствие общей финансовой UPDATE authority, concurrency/replay, rollback/lost COMMIT ACK, реальные owner-restore/new-fulfillment waits в обоих порядках и empty/nonempty down. Есть fresh fake inspection→POST→GET→effect и фактический40 CHECK failure: journal остаётся, order/target откатываются, повтор использует только GET и одну effect receipt.

Поведенческий source-body RED сохранён. Mutation, заменяющая `superseded` на `revoked`, обнаруживается тестом защиты нового периода. Исходник восстанавливается побайтно; canonical checks выполняются после восстановления. Права/данные production и manual stand не меняются. Функция пока не включена в consumer: нужны schema/ACL/owner/hash preflight, финансовая политика/чек, очередь/уведомления/операторское восстановление и real-provider TEST acceptance. Компенсации непросмотренных откликов — отдельная часть F02. LIVE остаётся выключенным.

Итоговый canonical PostgreSQL34/34 после mutation restore; новый native subset3/3, полный набор2522/2522 без skipped. Types/lint/floor/build прошли; прежнее предупреждение `targetType` не скрыто. Независимое read-only ревью store/SECURITY DEFINER SQL/processor/тестов и границ документации завершилось без Required замечаний после уточнения измеренного coverage. Старые tests/workflows/quality guards не менялись. Graphify code-only и Code Graph обновлены, новые файлы находятся в обоих контекстах. Browser UI/настоящий provider TEST, CI security scanners и production этим прогоном не проверялись.

Артефакты — `/home/danil/.cache/blizhniy-audit-f02/effect-{native.tap,postgres.log,processor-red.tap,red-source-binding.log,mutation.log,types.log,lint.log,floor.log,graphify.log,build.log,readiness.json}`. Сборка запущена на `https://127.0.0.1:3045`: HTTPS ready200 и реальный HTML/Flight BUILD_ID `gkxYl3Eq4I_hcjkDMI-Iu` подтверждены readiness helper. Это локальная сборка, не опубликованный выпуск; manual schema35 не изменялась.
