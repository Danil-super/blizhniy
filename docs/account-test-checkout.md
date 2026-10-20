# TEST-оплата объявления из кабинета

20.10.2026 владелец разрешил после проверок включить отправку TEST-платежей
только для своего аккаунта. Это не разрешение LIVE или публикации за TEST-деньги.
Email/UUID allowlist и секреты хранятся только в приватной конфигурации.

## Контракт

- Сохранённое объявление должно пройти актуальную модерацию. Сервер заново
  проверяет владельца, живую сессию, revision, тариф, фотографии и approval.
- Preview показывает серверную цену и срок; создание замораживает исходный
  creationKey и параметры. При потере ответа доступен readback с тем же ключом.
  Перепроверка сессии скрывает DOM, но не уничтожает этот буфер того же владельца.
- Отправка в ЮKassa — отдельное явное действие на странице заказа. Первая
  отправка повторно проверяет admission после последнего SQL ожидания, перед POST.
  Сохранённая provider link восстанавливается GET, а не новым платежом.
- После provider I/O сессия проверяется снова; поздний ответ не выдаёт URL
  отозванной сессии. Hosted HTTPS URL ограничен доменами ЮKassa/ЮMoney.
- Новый `account-test` verifier запускается отдельно с финансовой ролью: только
  GET уже связанных TEST-заказов этого владельца/магазина, до пяти за проход,
  не чаще одного прохода за 30 секунд. Он **не вызывает fulfillment/queue**.
  TEST succeeded не публикует объявление в рабочем каталоге.

Web-роль получает восемь дополнительных column privileges сверх прежних40:
UPDATE(id) immutable намерения для row lock; SELECT(intent_id,authorized_at)
и INSERT(intent_id) dispatch anchor; SELECT/INSERT(intent_id,provider_payment_id)
provider link. Действующий immutable trigger запрещает фактический UPDATE.
Ни status заказа, ни verification/fulfillment, ни признаки оплаты/публикации
web-серверу не выдаются. План и обратный план —
`database/permissions/listing-checkout-dispatch{,-revoke}.sql`.
Это операторские операции, не startup hook; новых миграций нет, journal24.

## Включение и откат

После protected PR/CI/deploy оператор сверяет точный release, журнал, runtime
и worker ACL, сохраняет приватный baseline, затем применяет только восемь прав.
Проверяется действующий canonical immutable guard и отсутствие обхода через
ownership, replication role, функции, schema и grants. Неизвестный COMMIT требует
отдельного read-only verify, а не повторного apply.

Для web: `BLIZHNIY_LISTING_PAYMENT=account-test`, приватный
`BLIZHNIY_PAYMENT_TEST_USER_ID`, существующий TEST merchant и явный TEST VAT1.
Выбор фискализации для LIVE этим не решён. Остальные env значения сверяются
по fingerprint; сохраняется root-only backup на российском VPS.
Для отдельного worker: `BLIZHNIY_PAYMENT_WORKER=account-test`, тот же owner/shop,
TEST-only ключ, dedicated financial role, verify-full TLS. Перед `--run` нужен
реальный non-root `--check`; artifact/dependencies не должны зависеть от prune
старого web release. Публичный webhook и queued-test fulfillment не включать.

Откат: отключить account-test web режим, перезапустить только сайт; остановить
отдельный account-test verifier; после сверки ровно48 прав применить обратный
восьми-column план до прежних40. Историю заказов и provider links не удалять.
SSH, другие приложения и права пользователей не меняются.

## Проверки и границы

Owned PostgreSQL18:337/337, включая старые40 прав/нулевой network, точные48,
запрещённый UPDATE, иностранного владельца, отзыв сессии во время provider POST,
GET-only verifier и отсутствие публикации. Отдельная регрессия воспроизводит
отзыв сессии во время финального SQL ожидания. Browser проверяет потерю ответа
создания, focus/session recheck с исходным ключом, потерю dispatch и восстановление
перехода; provider/API transports в этом тесте синтетические, не merchant proof.
Настоящий merchant TEST доказан отдельно: [provider test](payment-provider-test.md).

Этот документ описывает подготовленный контракт; факт установки фиксируется
отдельным приватным operator proof и deploy SHA, а не наличием файла в Git.
Остальные услуги, LIVE, refunds, полный launch/перенос этим не завершены.
