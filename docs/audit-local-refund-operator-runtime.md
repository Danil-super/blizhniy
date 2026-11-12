# F02: локальный runtime оператора — 12.11.2026

Основа9e50eb0: владелец одобрил точный пакет роли/schema55 только для локального сохранения, commit создан. Этот инкремент не устанавливает роль, миграции, службы или HTTP listener. Production/schema33, ручной39, их настройки/права и provider HTTP не затрагиваются.

## Программный контракт

createLocalRefundOperatorRuntime получает явный environment и предоставляет только preflight, approve(token,expectedAdmin,input), readForAdmin(token,expectedAdmin,approvalId), recover(token,expectedAdmin,input) и close. Import/factory не выполняет SQL или HTTP. Нет default process.env, module-path/URL выбора через ENV, worker/sender/SQL доступа или генерации новых action IDs. Trusted module/fetch seams предназначены для композиции/тестов.

Допускаются только local-test, TEST-ключ/магазин,127.0.0.1/blizhniy_test, рольblizhniy_refund_operator и verify-full с абсолютным CA. readPostgresConfig повторно проверяет CA/идентичность TLS; ambient PG* и отключение TLS отвергаются. Один owned pool max2, application_name blizhniy-local-refund-operator. Merchant фиксируется копией и freeze.

Перед асинхронной работой используются прежние канонические parsers/hashSessionToken: actor/action/reason/ссылка операции захватываются отдельным валидированным объектом, мутация входного объекта во время ожидания не меняет решение. Каждый вызов сначала проходит существующий read-only role/schema55 admission; app/admin сессия повторно проверяется внутри канонических транзакций, до каждой записи и после ожиданий.

preflight и approve дополнительно делают bounded TEST merchant GET между двумя проверками БД. Как и прежний local refund worker, этот кандидат допускает только явно выключенную фискализацию; полноценная provider TEST/fiscal приёмка остаётся открыта. readForAdmin является локальным авторизованным чтением и не зависит от API провайдера.

Для recovery выделен прежний первый этап в createPrimaryRefundRecovery.prepare: тот же авторизованный durable requested audit и локальное доказательство терминального результата, без HTTP или новых попыток. recover продолжает использовать тот же этап; исходные source/key/window/cap/финансовые записи не меняются. Runtime сначала вызывает prepare: завершённый результат возвращается локально даже при полном outage провайдера. Иначе merchant admission завершается до начала bounded refund GET, затем recover заново проверяет ту же сессию/действие. Ошибка или неопределённый COMMIT не повторяется автоматически; нужен явный вызов с прежним action ID. Нормальная повторная авторизация после известного prepare не является слепым SQL retry.

Весь operator fetch разрешает только GET, проверяет закрытие и AbortSignal до вызова. Канонический transport сохраняет прежние35s/3attempt bounded GET правила; запрет автоматического повтора касается команд/SQL. Probe не вложен в deadline refund GET: сначала admission, затем запрос. Нет методов отправки денег, изменения статуса или сброса очереди.

Операции одной фабрики выполняются последовательно; overlap отказывается без очереди ожидания. close сразу запрещает новые действия, дожидается текущего и закрывает pool один раз. Close во время уже записанного действия может вернуть unknown; durable исходный ID остаётся доступным для readback из нового runtime. Ошибки конфигурации/БД/provider/закрытия возвращаются единым сообщением без внутренних деталей. Роль/процесс остаются доверенной финансовой властью, как описано в audit-refund-operator.md; новая SQL-RLS граница не заявляется.

## Проверка

Native покрывает отказ до module loading, snapshot входа, порядок admission, отсутствие SQL/HTTP для неверного input, overlap/drain/close, явный same-ID повтор после неизвестного результата, POST/aborted-signal denial, ошибки конструирования/закрытия и локальный readback при API outage. Реальный RED показал утечку shutdown detail и отказ offline read при безусловном probe; оба исправлены. Новый helper prepare сохраняет старый recover flow, старые assertions/guards/миграции не ослаблены.

Во временной изолированной PostgreSQL со схемой55 скопированная фабрика используется без loadModules-подмены, с настоящими compiled canonical modules и новой TLS-сессией. Public CA читается через owned-container command; глобальный fetch запрещён, provider явный fake. Preflight не добавляет approval/audit/attempt; неверный CA/магазин/лишние права отказывают до решения. Approve/read/GET-recovery дают один effect/notice и сохраняют один POST прежнего worker. Повтор завершённого action и чтение approval работают без HTTP при полном outage. Revocation во время merchant probe не допускает refund GET/effect и оставляет только requested audit.

Целевой PostgreSQL90/90 и focused native13/13 прошли без skips. Первый fixture-прогон не засчитан: docker archive cp не прочитал public certificate из контейнера; чтение через команду parent-owned контейнера исправило fixture, TLS/CA требования не ослаблялись. Native2614/2614 без skips прошёл; causal отключение GET-only и terminal readback обнаружено тестами, исходники восстановлены побайтно. Graphify10734/31292 и Code Graph2177/6424 обновлены для текущего корня. Все13 обязательных PostgreSQL-наборов833/833 за239.8s прошли без skips. Сборка приложения завершилась успешно (74 статические страницы); staged Gitleaks не нашёл секретов. Floor/types/lint прошли, прежнее предупреждение targetType сохранено.

## Остаток первого этапа

Фабрика включена только в offline operator package; установки или автоматического запуска нет. Transport к этому процессу, интерфейс админки, развёртывание на ручном стенде и настоящая provider TEST/fiscal/эксплуатационная приёмка остаются открыты. Этот инкремент не объявляет первый большой этап или весь аудит завершённым.
