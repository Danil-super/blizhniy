# Приватный журнал платёжных намерений PostgreSQL

## Объём и допуск

Подготовительный срез L17: точное хранение запроса checkout и разрешение его
повтора. `PostgresPaymentIntentStore` не подключён к маршрутам, UI, worker или
ЮKassa. Это не работающая оплата и не завершение переноса.

Миграция0019 добавляет только `payment_checkout_intents`,
`payment_dispatch_anchors`, `payment_provider_links` и их защитные triggers.
Ранее применённые18 migrations не изменяются. `getBootstrapPlan` включает её
только с явным `includePaymentIntents:true`; обычные планы, deployment и запуск
приложения её не применяют. Runtime/roles/grants не меняются. На рабочую БД этот
срез не применён. Требуется отдельное согласование схемы, финансовой роли и
политики ПД после завершения проверки и следующего интеграционного среза.

## Контракт хранения

- Неизменяемы ID, владелец, вид/ID/точная revision цели, тариф, исходная сумма,
  продолжительность, магазин/TEST-флаг и UTF-8 тело запроса до16KiB. Денежные
  значения передаются десятичными строками; bigint revision не превращается в
  JavaScript number. Бесплатное размещение не является запросом списания.
- Snapshot включает только используемый hosted redirect/capture контракт,
  четыре обязательные metadata-привязки и необязательный полный чек. Схема
  отклоняет несовпадение суммы/валюты/metadata; декодер дополнительно проверяет
  точную структуру, строки/Unicode, URL и чек. БД считает SHA256 INSERT-trigger,
  store сверяет его до выдачи тела. Generated expression с convert_to намеренно
  не используется: PostgreSQL18 отверг его как не immutable (42P17).
- `persistInTransaction` вызывается доверенным серверным orchestration **в той
  же транзакции**, в которой тот проверяет сессию, текущего владельца, доступность
  тарифа, модерацию и уникальность активной оплаты цели. Сам store этого не
  делает. Повтор одного ID принимает только тот же economic binding; при
  конкурентной вставке возвращает точные bytes победителя, не новый чек/title.
- Нет внешнего запроса до успешного COMMIT авторизации. Первая committed
  авторизация задаётся clock_timestamp() БД; она не обновляется повторным
  запросом. Окно POST строго меньше23h55m; clock проверяется после row lock.
  Из остатка вычитается весь monotonic round trip, включая COMMIT/decode.
  Потерянный ответ COMMIT не повторяется автоматически и не сбрасывает anchor.
- Известный provider ID всегда возвращает только GET-recovery, даже после
  истечения POST-окна. ID привязан однозначно, immutable; `bindProvider` можно
  вызывать только после независимой проверки ответа ЮKassa, не по callback или
  browser input. Сам метод не подтверждает деньги и не исполняет услугу.
- UPDATE/DELETE всех трёх таблиц, включая no-op owner UPDATE, отклоняются.
  Down сначала блокирует таблицы и отказывается при наличии хотя бы одной
  записи. Операционный откат — прежний код с сохранением данных, не стирание
  финансовой истории и не возврат к прежнему backend.

## Границы доверия и персональные данные

Браузер не получает SQL-доступ, тело чека, hash или merchant binding. Credentials
в журнале не хранятся. UUID владельца/цели и email в чеке — связанные с человеком
данные; назначение хранения — byte-exact replay и сверка платежа. Нет raw provider
payload, карточных данных, телефона или нового сбора ПД.

Нет каскадного удаления финансовых записей при удалении аккаунта. Это **не**
завершённая политика хранения: до production требуется согласовать сроки,
export/erasure, сверку и резервные копии. Срез не выдумывает правовой срок и не
добавляет автоматическую очистку/анонимизацию immutable receipts. SQL-owner
остаётся доверенным оператором, способным менять DDL; triggers не считаются
защитой от компрометации владельца БД. Новых grants в миграции нет.

## Следующая интеграция — ещё не реализована

Серверная авторизация оплаты текущей одобренной версии и уникальный активный
payment order; независимый provider boundary/transport; монотонная запись
сверенного финансового состояния; webhook с authoritative GET; атомарное
однократное исполнение и сроки публикации/доставка отклика; история/return UI,
возвраты и отдельный согласованный TEST-merchant E2E. Наличие приватного журнала
не даёт права вызывать ЮKassa или напрямую выставлять paid/published.

## Проверки и внешнее ревью

Контрольная точка19.10: native1532/1532, PostgreSQL262/262, fail0/skipped0;
production build63/63, whole lint0errors (прежний checkout unused warning),
floor/diff/Gitleaks clean. Native прогон с одновременным SQL/default concurrency
получил3 таймаута внешних systemd/npm subprocess, не был объявлен успешным.
После разделения тяжёлых прогонов полный неизменённый набор прошёл с локальным
`--test-concurrency=2`; assertions, timeout, CI и quality floor не менялись.

`tests/payment-intent-contract.test.mjs` выполняет actual module, включая
неверные binding/receipt/Unicode, истечение бюджета после COMMIT и corrupted
hash. Инверсия SHA-сравнения действительно сломала отрицательный тест, затем
восстановлена. Независимый разбор нашёл escaped lone surrogate в return_url:
добавленный тест сначала упал, после проверки decoded URL прошёл.

`tests/payment-intents-integration.mjs` запускается общим owned PostgreSQL18
runner. Проверяет additive upgrade/down/hash, rollback/commit visibility,
конкурентных preparers, чужие bindings, unknown COMMIT, известный provider ID,
immutable owner mutation, ограничения отдельной fixture-роли и истечение после
реального ожидания lock. Исторический anchor меняется только SQL-owner внутри
точно ограниченного disposable fixture; production clock override отсутствует.
Весь контейнер удаляется с проверкой ownership существующим runner.

По выбору владельца внешний этап — **ручная проверка**, без CLI/передачи ключей.
До получения её результата этот срез не сливается в main и не устанавливается.

Задание внешнему ревьюеру: найти нарушения контракта выше в diff, особенно
повторное списание при lost response/конкуренции, продление окна, подмену
economic binding/чека, обход private ACL и разрушительный rollback. Различать
ошибки storage-среза и явно ещё не реализованное orchestration; не объявлять
оплату готовой. Вернуть findings с файлом/строкой, сценарием и серьёзностью;
при отсутствии findings указать пределы проверки. Ничего не применять.

Источники: [ЮKassa API](https://yookassa.ru/developers/api),
[идемпотентность](https://yookassa.ru/developers/using-api/interaction-format),
[PostgreSQL18 row locks](https://www.postgresql.org/docs/18/explicit-locking.html),
[Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html).
