# ADR-006: Неразрушающее наблюдение файлов под OS fence

## Статус

Принято для локального этапа 6e3a. Это файловый примитив, не завершённый протокол сверки с БД или очистки.

## Дата

2026-10-10

## Контекст

После прерванной загрузки могут остаться временное имя, конечное имя или оба hardlink одного inode. Ошибка записи не различает эти состояния и не разрешает удаление. До согласования destructive recovery с SQL нужен проверяемый read-only способ посмотреть два известных имени, не перечисляя весь каталог и не затрагивая чужие попытки.

## Решение

`createLocalMediaFileWorker(...).inspect(record, attemptId, signal?)` выполняет наблюдение в том же отдельном процессе и под тем же `.writer.lock`, что запись из ADR-005. Общий supervisor удерживает один slot, проверяет точный ответ и ждёт `close`; busy не ставится в очередь, unknown outcome сохраняет latch. Production по-прежнему запрещён. Запрос — ровно 116 байт: magic, два UUID, размеры и digest; ответ — ровно 7 байт: magic и три конечных значения. Ни пути, ни токен сессии, ни credentials не передаются.

File store проверяет только `<media UUID>.webp` и `.pending-<attempt UUID>` под закреплённым root descriptor. Для каждого возвращается `absent`, `complete`, `incomplete` или `unsafe`; `linked` означает, что эти два известных имени объясняют ровно две ссылки одного private inode. Посторонний hardlink не признаётся допустимым. UID/0600/type, inode/link count и изменения размера/mode/mtime/ctime проверяются; no-follow/nonblock исключают чтение известных symlink/необычных leaves. Полный объект ограниченно читается и проверяется по точному размеру, RIFF/WebP и SHA-256. `incomplete` означает только меньший размер private regular file, не корректность байтов или доказанное происхождение.

Отсутствие — только ENOENT при lstat; другие I/O ошибки, изменение namespace во время проверки, непроверенные root/lock или ответ дают generic UNKNOWN. Root/kernel fence повторно проверяются перед выдачей ответа child. Нет записи, fsync, публикации, удаления, reset claims или освобождения квоты. Чтение может обновить atime. Отчёт не содержит байтов, путей или inode и становится устаревающим снимком после освобождения fence; его нельзя сохранять как capability для последующего удаления.

## Альтернативы

Сканирование каталога добавляет несвязанные attempts и неоправданную область обработки. Обычный `exists`/`readFile` не различает ошибки отсутствия, тип и ограниченный размер. Проверка вне fence может пересечься с actual writer. Автоматическое удаление по UUID/TTL/PID не доказывает ownership или остановку I/O.

## Последствия

Удерживаемый guarded SQL вариант теперь реализован в [ADR-007](0007-media-guarded-observation.md); исходный low-level inspect из этого ADR по-прежнему не заменяет его и не разрешает очистку.

Это **не** повторная проверка актуального SQL состояния под fence и **не** power-loss durability proof. Следующий 6e3b должен удерживать этот же fence при owner/session-guarded SQL lookup и наблюдении, включая повторную проверку сессии после работы. Возвращённый снимок 6e3a нельзя использовать для самостоятельного cleanup/release. Порядок блокировок и протокол удержания child до завершения guarded transaction нужно проверить отдельно; HTTP, endpoint выдачи и production sandbox остаются вне этого решения.

Проверки охватывают настоящую Linux FS/flock: absence, complete/incomplete/empty, оба hardlink, чужие ссылки, права, symlink, directory, oversize, corruption и сохранность файлов. Fault adapters моделируют только I/O/namespace и события supervisor; реальные writer-crash тесты ADR-005 остаются обязательными. Схема/права PostgreSQL не меняются, новых dependencies нет.

Основания: [Node 22.23.1 fs](https://nodejs.org/download/release/v22.23.1/docs/api/fs.html), [Node 22.23.1 child close](https://nodejs.org/download/release/v22.23.1/docs/api/child_process.html), [ADR-005](0005-media-file-process.md).
