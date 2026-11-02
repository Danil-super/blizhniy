# F02: полный состав схемы и остановка исходного размещения

02.11.2026. Проверены совместно0001–0037 в новом одноразовом PostgreSQL18.6. Ручной стенд35, рабочая БД и два российских сервера не менялись; настоящие Telegram/ЮKassa не вызывались. Это SQL/store/worker acceptance, не разрешение production schema/ACL preflight или включение возвратов.

## Найденная и исправленная ошибка

0036 запрещает новый receipt при reservation кодом `PBR01`. Реальная транзакция fulfillment откатывает публикацию, но payment reconciliation worker считал этот код временной ошибкой: возвращал `deferred/processing_unavailable` и вновь ставил job в очередь. При пробуждении после подтверждения телефона0032 мог сохранить `last_code=phone_required`, хотя фактической причиной уже был возврат. Продолжение до12 попыток скрывало причину и создавало лишние GET к провайдеру.

Теперь `PBR01`, как и `P7602`, завершает job в `blocked/publication_blocked`. Это остановка публикации, не отмена платежа и не подтверждение возврата. Исходные amount/body/hash/capture/order сохранены. `P7601` по-прежнему создаёт durable waiting_phone, неизвестный SQLSTATE — retry с прежним лимитом. Старый receipt остаётся историческим: replay не обновляет период и не снимает опубликованное размещение до отдельного подтверждённого изменения услуги.

## Что доказано

`scripts/check-local-refund-composition.mjs` устанавливает0001–0025 из штатного bootstrap,0026–0035 из тех же manifest functions, что у локального сайта, затем0036/0037. Все37 имён и SHA сравниваются с журналом БД. Роли созданы только внутри своего контейнера; права веб-роли на финансовые таблицы/журналы не появляются. Финансовая fixture-роль имеет явно названные права для проверки реальных stores; это не утверждение о production роли.

14 проверок охватывают три вида размещения, телефонную политику и shift полного30-дневного срока0032, неизменность receipt/replay, PBR01 с откатом всех publication writes, сохранность checkout edit fence0034, допустимость refund prepare/window при поздней блокировке аккаунта/смене телефона и отсутствие phone proof у legacy capture. Оба порядка phone-confirmation/reserve проходят настоящий user row-lock wait. Подтверждение моделируется SQL владельца в одноразовой БД с тем же user→binding порядком, не успешным Telegram Login.

Критический RED: legacy payment создан без подтверждения до включения политики, затем required=true → actual worker GET → waiting_phone → reservation/request/window → confirmation/wake → worker. До исправления worker возвращал deferred; после — blocked/publication_blocked, attempts1. Следующие12 tick — idle без нового GET, receipt или публикации; повторный profile wake не меняет terminal job. GET-ответ — in-process stub строго исходного provider ID/merchant/TEST/metadata/capture. Денежные поля сравниваются до/после, новый POST отсутствует.

Добавлен native matrix на attempts1/12, PBR01/P7602/P7601/42P01, один finish с прежним claim и отсутствие private error payload в acknowledgement. Старые четыре native-проверки сохранены. Возврат старой ветки удалением PBR01 снова ломает полный PG-сценарий; исходник восстановлен побайтно и14/14 выполнены повторно. Full native2470/2470 без skipped, focused worker5/5, types/lint/floor/build прошли. Прежнее предупреждение targetType не скрыто. Независимое read-only ревью проверило source/test/RED/GREEN/mutation без замечаний. Graphify/Code Graph обновлены. Артефакты — `/home/danil/.cache/blizhniy-audit-f02/composition-*`.

Локальный сайт пересобран и запущен на `https://127.0.0.1:3045`; HTTPS ready200 и реальный SQL-backed HTML/Flight BUILD_ID `o1UxjACEdjy7bU5QG4FWk` проверены. Это локальная сборка, не published release. Ручной стенд по-прежнему35, полная37 проверялась только в своём удаляемом контейнере.

## Следующий этап допуска перед запросом

По актуальному [OpenAPI ЮKassa](https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml), Payment содержит обязательный refundable; refunded_amount — необязательное поле суммы успешных возвратов. Существующий payment reader намеренно проверяет только потребляемый capture contract и не возвращает эти сведения. Его `succeeded` недостаточно для допуска нового полного возврата.

Нужно отдельно проверить доступность полного возврата, pending/succeeded внешние возвраты и финансового инициатора. API `GET /v3/refunds` поддерживает фильтр payment_id и [пагинацию](https://yookassa.ru/developers/using-api/lists); незавершённый/противоречивый обход не доказывает отсутствие возвратов. Между чтением и POST возможны внешние операции — provider admission и окончательная сверка обязательны, локальный snapshot не заменяет их. Далее нужны совместимые способ платежа/чек, actual dispatch в исходном окне, provider refund ID и постоянная reconciliation. Эти сведения не являются разрешением выполнять настоящие операции.

Разрешение canceled/unknown и операторское восстановление исходной услуги остаются отдельным согласованным процессом. Terminal publication-blocked job не должен автоматически оживать из-за смены профиля, нового phone proof или возраста reservation. Компенсации откликов, schema/ACL активация и real-provider TEST также остаются открытыми.
