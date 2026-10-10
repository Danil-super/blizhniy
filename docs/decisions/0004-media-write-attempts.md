# ADR-004: Однократная попытка файловой записи

## Статус

Принято для локального этапа 6e1. Не является production upload или завершённым восстановлением после сбоя.

## Дата

2026-10-10

## Контекст

Резерв 0006 учитывает объём и владельца, но сам не разрешает запуск повторных FS writers. Случайное temporary имя существующего файлового примитива не связано с PostgreSQL; после kill его нельзя найти по reservation. В двух хранилищах нет общей транзакции. Просроченный SQL lease не доказывает остановку процесса, который ещё может записать файл.

## Решение

- Additive 0007 создаёт immutable `media_write_attempts`: один серверный attempt UUID на media ID, UNIQUE/FK RESTRICT, без TTL, reset, DELETE и повторного назначения. Это операционные метаданные, связанные с владельцем; новые виды ПД/внешняя передача не добавляются.
- Claim проходит live app-session/owner boundary, блокирует pending media row, сравнивает все metadata с уже зарезервированными и атомарно вставляет attempt. Только успешный ответ после COMMIT разрешает следующий локальный FS вызов. Дубликат сообщает IN_PROGRESS. Readback показывает факт claim, но не выдаёт повторное право писать.
- BEFORE INSERT trigger повторно проверяет pending под parent row lock и запрещает изменение/удаление attempt. Runtime имеет column INSERT(media_id)/SELECT, не задаёт UUID/time и не изменяет журнал. Никаких новых SECURITY DEFINER функций.
- Локальный writer сначала копирует и проверяет bounded normalized WebP, затем claim → FS write → guarded complete. Claim UUID задаёт точное temporary имя `.pending-<attempt UUID>`; final остаётся `<media UUID>.webp`. FS не перезаписывает/не удаляет существующий leaf другой попытки. Старый low-level write без attempt остаётся для прежнего локального контракта, не подключается к HTTP.
- Unknown claim COMMIT не вызывает FS. Неизвестный FS/ready исход сохраняет attempt, reservation и квоту; нет retry, удаления файла или "компенсационного" SQL reset. Сбой до FS может навсегда занять attempt до отдельной безопасной сверки — это сознательный отказ в доступности вместо двойной записи.
- Этот журнал — **не OS fencing/lease и не доказательство остановки writer**. Runtime остаётся доверенным серверным кодом; низкоуровневый FS не защищён от произвольного same-UID кода. Не подключать очистку/release/upload, пока файловый процесс не ограничен механизмом, который исключает его позднюю запись. Таймер, PID, исчезновение DB connection или имя файла таким доказательством не являются.

## Альтернативы

Автоматически переиспользовать старый claim или выдавать новый после TTL небезопасно при позднем writer. Файловый sidecar/случайный temporary UUID не дают авторитетного ownership journal. Хранить SQL-транзакцию открытой всю FS-запись не делает две системы атомарными и теряет claim при connection loss; выбрано предварительное сохранение без автоматического release.

## Последствия

Локально проверяется полная последовательность от reservation до private read. После сбоя остаются известные ID двух возможных leaf names и постоянный однократный claim; это необходимые исходные данные будущей reconciliation, не её реализация. Продолжают требоваться OS writer fencing, доказательства inode/root/отсутствия файлов, безопасная cleanup/release, admission/retention/export и backup в РФ. 0001–0006 не переписываются. Down 0007 блокирует журнал до проверки и отказывается при любых attempt rows; последующие down выполняются в обратном порядке. Серверы/Timeweb/HTTP не меняются.

Основания: [PostgreSQL 18 row locks](https://www.postgresql.org/docs/18/explicit-locking.html), [INSERT ON CONFLICT](https://www.postgresql.org/docs/18/sql-insert.html).
