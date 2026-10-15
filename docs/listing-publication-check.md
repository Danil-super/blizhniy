# Проверка объявления перед публикацией

Завершённый read-only сценарий подготовки, не отправка на модерацию, оплата или публикация. В кабинете владелец открывает сохранённый черновик и нажимает «Проверить перед публикацией». Проверка показывает конкретные недостающие поля и действующий тариф из российской БД. Черновик не меняет revision/status/is_paid/даты, платёж и внешние запросы не создаются. Порядок модерации и реальный checkout — отдельные этапы, не скрытая часть этого POST.

## Контракт

`POST /api/account/listing-publication` принимает ровно `{expectedOwnerId,listingId,expectedRevision}`. Клиент не передаёт цену, тариф, поля объявления, paid/status или approval. Ответ: `{listingId,revision,checksPassed,issues,tariff}`; issues содержат только allowlisted field и статическое сообщение. Tariff либо null, либо `{id,name,amount,currency:"RUB",durationDays}`. Денежная сумма — точная SQL decimal string, revision — bigint string. Контакты, адрес, полный текст, owner ID и media metadata не возвращаются.

Те же cookie/Host/Origin/custom header/Sec-Fetch/query/trusted ingress/body4096/2s/shared SQL session limiter, что у других приватных маршрутов. GET/PUT/PATCH/DELETE405, вне PostgreSQL-mode404; ошибки401/404/409/422/429/generic503. Ответы no-store/no-referrer/nosniff/CSP. Audit: только event/requestId/status/duration/code, без IDs, формы, телефона, тарифа и SQL причин.

В App session transaction проверяется текущий подтверждённый незаблокированный владелец, затем блокируется его draft и сверяется точная revision. Переиспользуются полная snapshot-проекция и проверки owned ready photos/160МиБ. Категория и родитель должны быть active; город обязан быть сохранён. Название3–120, непустое описание≤3000 и телефон/мессенджер соответствуют прежним публикационным ограничениям, не более мягкому контракту сохранения черновика. Для аренды вызывается существующая полная проверка booking. Active offer `listing_publication` читается в БД, float-преобразования цены и static fallback отсутствуют. До commit сессия проверяется снова; штатное обновление last_seen_at остаётся единственным auth-побочным эффектом.

Результат описывает данные на момент проверки, не фиксирует будущую покупку, не обещает прохождение модерации и не гарантирует доступность провайдера. Перед реальным checkout нужны повторная серверная проверка версии/категории/тарифа, разрешение модерации по согласованной политике и отдельный immutable financial intent. Этот readonly POST нельзя незаметно превратить в endpoint создания платежа.

## Проверки и выкладка

Pure content/tariff tests, bounded cookie-only browser transport, HTTP input/CSRF/ingress/limiter, настоящий owned PostgreSQL18 с limited runtime, foreign/stale owner/revision и изменением тарифов/категорий. Браузер проверяет видимый тариф и отсутствие новой записи формы/платежа; несохранённые поля блокируют проверку, изменение identity/revision уничтожает старый результат. Новых migrations/grants/dependencies нет. Откат к6385afe сохраняет новую БД, Auth, media и существующие0013; SSH, бот и workflows не меняются.
