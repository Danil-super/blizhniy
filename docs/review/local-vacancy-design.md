# Локальный vacancy checkout — контракт ревью

Артефакт: расширить существующий PostgresListingCheckoutStore опциональной
серверной стратегией targetType=vacancy. По умолчанию всё остаётся listing.
Стратегия используется только из local-primary-payment.mjs при включённом
строго локальном флаге: существующий HTTP cookie/CSRF boundary, отдельный
/api/account/vacancy-checkout, те же immutable intents/orders/dispatch/verification.
Проверка формы через PostgresWorkPublicationStore.inspectInTransaction и
активный tariff vacancy-publication; draft, unpaid, exact revision required.
Та же стратегия доверенного fulfillment-worker проверяет capture, merchant,
owner, revision, все поля/активные ссылки/фото, затем атомарно публикует work
и пишет существующий immutable fulfillment receipt. Не создаётся фиктивное
решение модератора. Локальная публичная выборка допускает vacancy по receipt,
intent binding и текущему оплачиваемому периоду вместо approval. Production
по умолчанию и workRequest продолжают требовать прежнее approval.

Контракт: никакой клиентской записи is_paid/status, новых прав runtime или
production endpoint/флагов. Все SQL имена выбираются только из серверного
enum, не из входных строк. Ключ покупки стабилен при потерянных ответах;
чужие/смешанные listing/vacancy ключи и paymentId не пересекаются. Pending,
cancel, чужой аккаунт, изменённая revision/город/профессия/фото не публикуют.
Replay не воскрешает и не продлевает; тариф в уже принятом заказе immutable.
Публичные контакты не раскрываются. Только собственный local PostgreSQL18,
проверки restricted runtime и отрицательные/browser сценарии. Внешние деньги,
production rollout, миграции/выдача дополнительных прав не входят в артефакт.

Результат первого разбора: три замечания приняты как actionable. Public gate
также требует текущий succeeded order и точное SQL-совпадение дат receipt с
work_publications. Worker держит SHARE города/профессии/media до commit и
проверяет канонические названия против формы. Эти же проверки входят в quote
и dispatch как актуальная проверка; SHARE ссылок удерживает только trusted
fulfillment, потому что ограниченной runtime-роли не выдаются UPDATE-права
на справочники ради lock. При изменении ссылки после dispatch capture остаётся
финансовым фактом, а публикация блокируется. Второй разбор выявил доменные
ошибки revision/deletion, уходившие в503: они преобразованы в blocked, неожиданные
ошибки БД по-прежнему не скрываются. Restricted-role PG подтверждает durable
capture без публикации для edit/delete после dispatch. Дополнительная модель
предложена владельцу; CLI не запускались.
