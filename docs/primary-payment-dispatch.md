# Отправка сохранённого платёжного намерения

Локальный срез L17. `createPrimaryPaymentDispatcher` соединяет immutable
журнал0019 с общим transport/validator и reader. HTTP/worker/UI его пока не
вызывают. Новых migrations/grants, реальных запросов магазину и production
изменений нет. Отложенное ручное внешнее ревью финансовой части остаётся
условием выпуска; тесты его не заменяют.

## Контракт

`dispatch(originalBinding)` — приватный метод доверенного процесса, не endpoint
для тела браузерного запроса. Вызывающий компонент обязан сначала атомарно
проверить владельца, текущую approved revision и предложение и сохранить
исходный заказ через checkout store. Наличие UUID или тип TypeScript не даёт
пользователю такой authority. Будущие API/worker требуют собственных auth,
admission, блокировок допуска, аудита и безопасных пользовательских ошибок.

Конфигурация магазина копируется при создании. Несовпадение shop/TEST-LIVE с
original binding отклоняется до сети. Затем actual intent store сверяет
исходные экономические поля и hash request_body, а не доверяет переданной цене.
Сохранённые receipt/return_url/UTF-8 bytes никогда не строятся заново из текущих
email, тарифа или конфигурации. Идемпотентный ключ — существующий UUID намерения,
не новый UUID попытки и не случайный идентификатор после timeout.

1. Один shared budget начинается до первой авторизации:35s и максимум3 remote
   попытки с суммарными headers/body/backoff. SQL-авторизация перед запросом
   тоже расходует этот бюджет; SQL не держит locks во время remote I/O.
2. Известный provider ID означает только GET того же UUID на фиксированном
   api.yookassa.ru. Ни404, ни отсутствие confirmation URL не разрешают POST.
   GET разрешён даже после истечения POST-окна.
3. Для неизвестного ID используется только исходный request_body. **Перед
   каждой** сетевой попыткой POST actual store повторно проверяет immutable
   original anchor и оставшееся эксклюзивное окно23h55m. Это запас относительно
   гарантированных провайдером24h, не TTL для удаления нашей финансовой истории.
   Истёкший UNKNOWN не получает новый key/anchor/order автоматически.
4. Caller дополнительно вычитает весь свой await roundtrip из оставшегося
   времени; store уже вычитает свой SQL roundtrip. Повторное вычитание намеренно
   консервативно и учитывает задержку continuation: около границы оно может
   раньше отказать, но никогда не продлевает разрешение.
5. Если конкурент уже связал проверенный ID, текущий POST прекращается и
   выполняется GET с **тем же** budget/attempt counter. Handoff не начинает
   новые35s/3 попытки и не обходит первоначальный короткий дедлайн.
6. Успешный HTTP-ответ сначала проходит общий strict validator: UUID, shop,
   TEST/LIVE, RUB/точная сумма, четыре metadata binding, status/paid, capture и
   hosted confirmation URL. Только затем bindProvider сохраняет связь с ID.
   Конфликт с другим ID не перезаписывает историю и не скрывается успехом.

Метод возвращает только `{providerPaymentId, confirmationUrl}`; URL может быть
null. Это не финансовый succeeded и не право публиковать карточку. Нет записи
order status, webhook-доверия, entitlement или срока от времени POST.
Авторитетная GET-сверка и однократная выдача услуги — отдельные stores0021/0022.
Неверный ответ или неизвестный COMMIT не превращаются в failed/успешную оплату.
SQL COMMIT не повторяется внутри диспетчера: при новом явном вызове committed
link читается через GET; при отсутствии link тот же POST допускается только
в первоначальном окне. Журнал неизвестного результата не удаляется.

## Дедлайн без зависимости только от таймера

Review выявил, а отдельный RED-тест воспроизвёл случай: monotonic deadline уже
прошёл, но callback setTimeout ещё не выполнен и AbortSignal не aborted.
Общий transport теперь проверяет monotonic clock синхронно непосредственно
перед fetch и до/после awaited body read. `budget.check` сохраняет исходный
clock/deadline при передаче reader, а таймер продолжает прерывать зависшие
операции. Допуск не продлевается из-за очереди микрозадач; тело с поздними
данными отменяется. Ограничения64KiB/2048chunks/3attempts не изменены.
Временная подмена clock-проверки при mutation-проверке сломала оба регрессионных
теста, после чего исходное условие восстановлено.

Это shared transport старого и нового кода, поэтому проверяются также прежние
provider/lifecycle regressions, а не только новый dispatcher. Code Graph
показал новый reader/dispatcher, но пропустил alias-import старого provider;
прямой поиск подтвердил этот dependency. Граф не заменяет полный impact review.

## Проверки и выпуск

Actual-source native tests: байты/key/commit-before-fetch, same-key retry,
known-ID GET, discovery/handoff, общий attempt/deadline, ошибочные bindings и
ответы, unknown COMMIT в первой/непосредственной pre-POST/финальной транзакции,
конфликт provider ID. Fake clock проверяет просрочку без запуска timer callback
и поздний body после reader handoff. Настоящая loopback PostgreSQL18 проверяет
рестарт/UNKNOWN/concurrency/immutable anchor/guarded роль без финансовых и
publication writes. Journal22 не меняется.

Локальная сквозная композиция использует настоящие session checkout → dispatcher
→ GET verification → fulfillment → public reader. Только fetch провайдера
синтетический. Положительный composition test использует владельца disposable
БД; минимальные права verification/fulfillment отдельно доказаны их fixtures.
Это не реальный merchant sandbox E2E и не проверка нового браузерного checkout.

Контрольная точка: native1564/1564, PostgreSQL18 300/300, отдельные прежние
financial lifecycle PostgreSQL17 71/71 — без пропусков/ошибок. Whole lint:
0errors и одно прежнее предупреждение unused targetType; floor чистый.
Production build завершён с exit0; types проверены после build, staged
секреты проверяются отдельно для каждого сохраняемого изменения.
Общий transport не получил новую историческую совместимость или ослабление
валидации, а финансовый authorizer/окно и все22 SQL sources остались неизменными.

До включения остаются защищённые API/UI/история, webhook/admission/очередь и
наблюдение, sandbox настоящего провайдера, остальные типы услуг/продления/
возвраты/чеки и допуск financial DDL/ролей. На рабочем сайте schema0018, полный
перенос не завершён. Откат кода не должен удалять UNKNOWN intents, links или
записи исполнения и не должен возвращать старый backend/fallback.

Команды: `node --experimental-strip-types --test tests/bootstrap-postgres-integration.mjs`,
`node --test tests/payment-lifecycle-integration-postgres.mjs`, полный native
suite, types/build/lint/floor и staged Gitleaks. Реальные секреты/ПД не читаются.

До реализации через Context7 получены официальные [идемпотентность ЮKassa](https://yookassa.ru/developers/using-api/interaction-format),
[API](https://yookassa.ru/developers/api) и [таймеры Node22](https://nodejs.org/docs/latest-v22.x/api/timers.html).
