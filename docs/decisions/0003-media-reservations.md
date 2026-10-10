# ADR-003: Учёт фотографий до файловой записи

## Статус

Принято для локальной реализации. Production upload и применение на Timeweb не включены.

## Дата

2026-10-10

## Контекст

Фотографии размещаются на VPS вне релизов, метаданные/владелец — в PostgreSQL. Worker нормализует WebP, файловый слой проверяет bytes и не перезаписывает существующий ID. Между SQL и FS нет общей транзакции: потеря ответа или остановка процесса могут оставить файл без подтверждённого статуса. TTL сам по себе не доказывает отсутствие файла или остановку писателя.

## Решение

- Перед файловой записью создаётся `pending` reservation с owner из guarded app session, неизменными metadata, серверным UUID и устойчивым UUID intent, уникальным на владельца. Клиент не задаёт owner/ID/state.
- Общая квота — **5 000 000 000 байтов** (5 ГБ, не 5 ГиБ), плюс максимум **10 000 объектов** для ограничения inode/metadata. Все pending/ready считаются занятыми. Оператор может снизить лимиты в пределах этих верхних границ; runtime их не меняет.
- INSERT учитывается AFTER-trigger: неуспешный `ON CONFLICT DO NOTHING` не расходует квоту. Условный UPDATE одной budget-строки сериализует разные процессы/аккаунты и откатывается вместе с reservation при отказе. Узкий `SECURITY DEFINER` trigger с fixed `pg_catalog,pg_temp` search_path и fully-qualified tables позволяет не выдавать runtime запись budget. PUBLIC execute отозван в той же транзакции; runtime не владеет schema/table/functions.
- Повтор same-intent/different metadata отклоняется; same pending сообщает `MEDIA_IN_PROGRESS`, не запускает ещё одну запись. Ready повтор возвращает прежний результат. При неизвестном COMMIT нет автоматического retry; authenticated lookup по intent показывает сохранённое состояние.
- Pending → ready только после чтения и проверки конечного файла доверенным FS layer внутри guarded owner transaction; expiry после ожидания/чтения откатывает state. Private bytes читаются только в этой же owner/session boundary; admin не получает доступ к чужим фото лишь из-за роли.
- ID/owner/intent/metadata/created_at неизменны. Owner FK — RESTRICT, не CASCADE: удаление аккаунта не должно терять доказательства ещё существующих файлов. Runtime не получает DELETE/TRUNCATE, прямую запись budget или изменение user role/password.
- Этот инкремент не освобождает квоту и не удаляет reservations по времени. Crash-safe write claim/fencing, доказуемая cleanup/reconciliation, retention/export/account deletion и migration к состояниям удаления — следующий отдельный инкремент до HTTP. Reservation не является lock/lease файлового писателя; нельзя подключать текущий primitive к повторяемому upload без этих механизмов.

## Альтернативы

Проверка SUM перед INSERT без сериализации допускает переполнение при конкуренции. In-memory счётчик теряется при рестарте и умножается на число процессов. Освобождение pending по TTL допускает позднюю запись вне квоты. CASCADE user deletion оставляет файлы без ownership evidence. Хранение bytes в PostgreSQL противоречит принятому двухсерверному распределению и усложняет резервирование.

## Последствия

Сбой сохраняет занятое место до доказуемой сверки; это может временно остановить загрузки, но не скрывает неучтённые файлы. Ограничение объектов — ёмкость хранилища, не лимит запросов; rate/admission control остаётся необходимым. Runtime доверен как серверная identity, не является RLS-tenant: authorization проверяется модулем, пользователи не получают SQL credentials. Миграция additive, down блокирует обе таблицы **до** проверки и отказывается при любых reservations/ненулевом учёте; приложение/деплой её автоматически не запускают. Независимые копии в РФ и восстановление обоих хранилищ обязательны до открытия пользователям.

Основания: [PostgreSQL 18 SECURITY DEFINER](https://www.postgresql.org/docs/18/sql-createfunction.html), [условный UPDATE и Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html), [BEFORE/AFTER triggers](https://www.postgresql.org/docs/18/trigger-definition.html).
