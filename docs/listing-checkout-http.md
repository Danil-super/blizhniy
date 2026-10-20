# Заказ объявления: cookie API и возврат с оплаты

Текущий статус20.10: точный column-scoped план TEST-подготовки применён,
API установлен в284f0fe и включён только в prepare-only/test. Настоящий HTTPS
prepare/replay/readback/foreign-denial proof прошёл без merchant-запросов.
Прежние права сайта и роли обработчика сохранены.
[Cutover и границы](listing-checkout-cutover.md). Ниже — исходный локальный срез;
его прежние production-off сведения не описывают текущий статус DDL/grants.

Локальный срез L17 поверх [checkout](listing-checkout.md) и
[dispatch/recovery](primary-payment-dispatch.md). Не установлен на VPS;
production остаётся на `6fbcccf0604c`, схема0018. Финансовое внешнее ревью
по решению владельца отложено, не заменяется этими проверками.

## Граница полномочий

`/api/account/listing-checkout` создаёт только локальный заказ обычного
объявления и читает его. Не вызывает ЮKassa, не принимает её URL/ключ/receipt,
не меняет финансовый статус или публикацию. Доверенный dispatch не вызывается
из HTTP-handler и не получает экономическую привязку от браузера.

Обязательны точный Host/Origin, `X-Blizhniy-Request: 1`, JSON, доверенный
`X-Real-IP` от текущего ingress и HttpOnly cookie сессии. Запрос ограничен
4096 байт/2s. Bearer старого backend не принимается. Используется существующий
общий SQL rate budget `session`; лимиты не изменены. В каждой транзакции
проверяются актуальная сессия app, ожидаемый владелец, verified/unblocked user;
перед COMMIT сессия проверяется ещё раз. Ответы и ошибки `no-store`,
`no-referrer`; аудит содержит event/requestId/status/duration/code, без ПД,
cookie, идентификатора заказа или текста provider/SQL-ошибок.

## Контракт

Во всех телах обязателен `expectedOwnerId`. Лишние поля отклоняются.

| Метод | Остальные поля | Ответ200 |
|---|---|---|
| POST | `action: "preview"`, `listingId`, `expectedRevision` | Существующий checkout preview: фактический тариф и активный заказ |
| PUT | `listingId`, `expectedRevision`, `creationKey`, `expectedTariffId`, `expectedAmount`, `expectedDurationDays` | Исходный безопасный DTO заказа |
| POST | `action: "intent"`, `creationKey` | Исходный DTO или null; восстановление результата COMMIT |
| POST | `action: "order"`, `paymentId` | `{order, fulfillment}` или null |

Ревизии — точные десятичные строки, сумма — строка с двумя знаками.
Сумма и срок в PUT — ожидаемое пользователем предложение, не источник цены:
store сравнивает их с серверным тарифом и approved текущей revision.
Успешный PUT не означает платёж или публикацию. После неизвестного результата
нельзя создавать новый ключ; сначала читать `intent`, затем при необходимости
повторять только исходный payload/key. Сам handler не повторяет операции.
Этот инкремент не добавляет кнопку подготовки/списания в редактор объявления.

`order` содержит только id/creationKey/targetId/targetRevision/tariffId/amount/
durationDays/status/createdAt. `fulfillment` — null или исторические
`publishedAt`/`expiresAt` из immutable записи исполнения. Read-by-ID ограничен
владельцем, типом listing, исходным merchant и TEST/LIVE режимом конфигурации.
Ни отсутствие, ни чужой заказ не раскрывают существование записи: оба null.
Не выдаются provider ID, merchant ID, receipt, email, request bytes или хеши.
Историческое исполнение не доказывает, что объявление всё ещё публично.

401 — сессия; 404 — недоступный черновик; 409 — изменённые данные/предложение
или неготовность checkout; 422 — некорректный ввод; 429 с Retry-After900;
неизвестный результат/ошибка БД — generic503 без внутреннего сообщения.

## Выключатель и права

По умолчанию API возвращает503 `CHECKOUT_DISABLED` до auth/database startup.
Поддержан только явный `BLIZHNIY_LISTING_CHECKOUT=prepare-only`,
`BLIZHNIY_PAYMENT_MODE=test`, `BLIZHNIY_PAYMENT_SHOP_ID` и обязательный
`BLIZHNIY_PAYMENT_RECEIPT_VAT` (`none` либо1–12). LIVE отклоняется.
Секрет магазина не читается этим API. Не включать режим в production:
нужны отдельное решение по rollout, схема0019–0022 и проверенные минимальные
права из предыдущих инкрементов. Новых provisioning/deploy hooks нет.
Read-by-ID дополнительно потребует SELECT только трёх колонок
`app.payment_fulfillments(intent_id,published_at,expires_at)` — грант проверен
лишь в одноразовой локальной БД, на production не выдавался.

## Страница возврата и дизайн

В postgres/неизвестном auth mode `/oplata/[paymentId]` не монтирует legacy
платёжный компонент. Использует существующие токены/размеры карточки, один h1,
текстовые статусы, клавиатурные действия и мобильную ширину от320px.
Задача страницы — прочитать исходный заказ, не создать/подтвердить новый платёж.
Отдельны: подготовлен, обрабатывается, оплата подтверждена без исполнения,
размещение исполнено, отменён, возвращён; доступны вход и кабинет.
Нет таймера polling или автоматического перенаправления в магазин.

При потере ответа последний DTO остаётся в памяти с предупреждением о
неподтверждённой актуальности. При перепроверке сессии данные скрываются;
тот же аккаунт может восстановить их, другой аккаунт/выход уничтожают scope.
Ответ старого запроса после смены аккаунта не применяется. Приватные данные
не сохраняются в local/sessionStorage. Чтение ограничено15s/16KiB/1024chunks;
JSON проверяется на точный ID/shape/даты/деньги/ревизию/сочетаемость статусов.

## Проверки и оставшийся объём

Новые focused native проверки —10/10. RED: отсутствующие handler/config/client,
старое монтирование legacy page в postgres mode, отсутствующий readOrder.
Мутация `o.id!==id` → `o.id===id` нарушает две проверки; после восстановления
3/3 client tests зелёные. PostgreSQL pipeline включает настоящий HTTP
prepare/replay/readback/status и сессионную транзакцию, затем synthetic dispatch/
GET verification/once-only fulfillment. Негативные случаи: другой действующий
аккаунт, wrong merchant/mode, revoked session; чтение receipt ограничено тремя
колонками, financial writes остаются запрещёнными runtime-роли.

Изолированный Chromium на production build проверил стадии, потерю ответа,
повторное чтение, скрытие при session recheck, смену аккаунта с поздним ответом,
выход и disabled API. Только cookie POST/read, без merchant/legacy запросов.
320/768/1024/1440px без overflow, keyboard Space работает, axe serious/critical0
в проверенной области. Это synthetic HTTP browser proof, не настоящий sandbox E2E.

Итоговая регрессия этого среза: native1574/1574, owned PostgreSQL18 300/300,
Next production build exit0, types0errors, lint0errors (прежний unused
`targetType` в checkout-prerequisites.test.cjs:30 остаётся), floor clean,
staged Gitleaks без находок. После финальной сборки Chromium повторно прошёл.
Независимый целевой разбор не оставил Required/Critical; не является отложенным
ручным внешним ревью финансового стека.

Далее: admission/очередь dispatch и bounded worker, webhook с авторитетной
сверкой, кнопка оплаты в форме/история кабинета, настоящий изолированный TEST
магазин и webhook E2E, остальные типы услуг, продления и возвраты.
Полный перенос и разрешение реальных списаний этим инкрементом не закрыты.
