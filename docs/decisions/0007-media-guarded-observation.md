# ADR-007: Сверка файлов и актуальной БД под удерживаемым fence

## Статус

Принято для локального этапа 6e3b. Read-only для media; cleanup, release, upload HTTP и production не включены.

## Дата

2026-10-10

## Контекст

Снимок ADR-006 устаревает после завершения child. Получить SQL состояние до файлового lock или после его снятия недостаточно для согласованного наблюдения. Guard обязан проверить текущего владельца и сессию, в том числе после ожидания/чтения. Credentials нельзя передавать файловому процессу.

## Решение

`MediaMetadataRepository.observeWrite(token,fileId,worker,signal?)` вызывает trusted `worker.observe(inspect => guarded transaction)`. Child сначала доказывает собственный kernel fence и отправляет READY (`82`); только после него parent начинает SQL. Порядок: OS fence → user → session → owned media row FOR UPDATE → immutable attempt lookup → одна файловая inspection → финальная проверка сессии → завершение transaction → EOF child → DONE (`68`) → child close. БД остаётся в parent; child получает только прежний 116-byte `BFI1` запрос и выдаёт прежний 7-byte `BFO1` отчёт. Ответов всего 9 байт либо 2 при отказе без FS запроса. Child удерживает lock после отчёта, пока parent не закроет stdin.

Результат — `{state,files}`, без байтов, путей, inode, attempt ID и токенов. Чужой UUID, admin без ownership, неизвестная сессия или отсутствующая попытка не вызывают файловую inspection. Media/claim/budget не изменяются; штатный session guard может обновить last_seen_at. Состояние читается заново после row-lock ожидания, а не берётся из прежнего reservation. Нет новых SQL privileges или миграций. Busy отображается в MEDIA_IN_PROGRESS, другие неизвестные исходы — в generic MEDIA_METADATA_UNAVAILABLE. Finite guard denial сохраняется после clean child close. Потерянный COMMIT response не вызывает retry.

`observe` — внутренний **read-only** callback contract, не произвольная destructive transaction. Один inspector вызов нужно await; detached work, повтор/поздний вызов, отмена до callback, ранний DONE, повреждённый/избыточный ответ, преждевременный close дают отказ. Slot/deadline/stop/latch общие с writer. Child может аварийно умереть во время SQL: в этом случае успешного отчёта не будет, но timeout не останавливает сам SQL callback. Поэтому mutation/cleanup в callback запрещены; даже successful observation не становится capability для будущего удаления. Протокол не обещает, что SQL rollback и OS crash атомарны.

## Альтернативы

Parent-side flock-helper может исчезнуть независимо от фактического I/O. Чтение SQL до fence даёт stale state. Передача session/PG credentials child расширяет область доступа. Новый reconciliation daemon/lease не нужны для bounded локального наблюдения. Изменение существующего write workflow не требуется: claim commit происходит до FS fence, а complete — после завершения child; он не ждёт fence, удерживая SQL locks. Транзакции короткие и ограниченные существующими timeout; внешних запросов внутри нет.

## Последствия

Проверяются настоящий PG18/private FS/flock, актуальное pending/ready, ownership/admin/unclaimed denial, expiry после реального отчёта, kernel lock во время SQL ожидания и после COMMIT, lost response без retry, column-scoped runtime и сохранность claims/quota. Narrow supervisor faults проверяют handshake, early cancellation/DONE, detached work и close. Следующий шаг — отдельные durable ownership/absence proofs и destructive recovery contract; ни UUID, ни размер, ни этот отчёт сами по себе не разрешают удаление. Прежние ADR-005/006 остаются применимы к write/low-level inspect.

Основания: [PostgreSQL18 explicit locks](https://www.postgresql.org/docs/18/explicit-locking.html), [Node22 child close](https://nodejs.org/download/release/v22.23.1/docs/api/child_process.html).
