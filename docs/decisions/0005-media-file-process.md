# ADR-005: Файловая запись в процессе, удерживающем OS lock

## Статус

Принято для локального этапа 6e2. HTTP/production, reconciliation и освобождение квоты не входят в этот инкремент.

## Дата

2026-10-10

## Контекст

Журнал ADR-004 исключает повторный claim, но не останавливает позднюю FS-запись. Блокировка в помощнике, когда файл пишет родитель, не годится: помощник может завершиться, а родитель продолжить запись. Срок SQL lease, PID и успешная отправка kill не доказывают окончание I/O.

## Решение

Отдельный Linux/Node 22 child выполняет весь private FS write. `flock --no-fork --exclusive --nonblock` заменяет себя этим child и сохраняет lock до окончания процесса. Lock — заранее созданный оператором пустой `.writer.lock` 0600 в private root 0700. Root/lock открываются no-follow, проверяются UID/type/link count/dev/inode и передаются дескрипторами; flock открывает `/proc/self/fd/3`, не повторно разрешает имя lock. Worker проверяет собственный kernel FLOCK в fdinfo. Same-UID код, операторские пути и неизменная иерархия доверенные; это не sandbox от RCE.

IPC bounded/binary: только media UUID, attempt UUID и уже нормализованный WebP, без session/SQL credentials, caller paths и native codec; ≤2 МиБ + 121 байт запроса, ровно один байт ответа. Один активный job в процессе, межпроцессный конфликт немедленно отклоняется, очереди нет. Отмена/срок 5 с/ошибка протокола посылают SIGKILL только ещё не reaped собственному child; успех возможен только после `close` и точного ответа. Ожидание остановки ограничено ещё 2 с. Любой неизвестный файловый исход, в том числе отменённый partial write, блокирует новые jobs в данном parent; новый экземпляр factory не снимает latch. Busy без запуска FS не блокирует последующую работу. Parent crash не снимает lock с продолжающего писать child. Child также имеет собственный JS deadline, но это не гарантированная OS остановка при SIGSTOP/непрерываемом I/O: пока процесс жив, lock сохраняется.

Однократные SQL claims сохраняются при busy/abort/unknown, не переиспользуются. Low-level file store остаётся внутренним локальным примитивом, не защищённым от доверенного кода, обходящего worker. Lock никогда автоматически не удаляется/не заменяется, в том числе при restart; иначе можно разделить один fence на два inode. File store получает ожидаемые dev/inode root от унаследованного дескриптора. Cleanup/release требуют отдельного протокола: тот же OS fence, повторная проверка актуального SQL состояния под fence, ownership/absence/durability proofs. Новую authority из одного UUID или факта завершения child не выводим. Повторный запуск parent после unknown требует операторской проверки, а не reset через приложение.

## Альтернативы

SQL advisory lock или TTL теряются независимо от файлового writer. Lock-only helper не удерживает actual writer. Systemd decoder остаётся отдельной ресурсной границей; файловому процессу без native codec не копируется весь decoder supervisor. Не обещаем cgroup sandbox или автоматическую остановку после parent crash.

## Последствия

Нет SQL/remote изменений, новых npm dependencies или автоматического удаления. Реальная Linux filesystem и flock проверяются конкурентными процессами, отменой, гибелью parent и отказом при непроверенном lock. Node запускает существующий FS слой напрямую с strip-types: runtime import имеет `.ts`, `allowImportingTsExtensions` разрешён при существующем noEmit, параметр-свойство Error заменено эквивалентным явным полем. Decoder не меняется. Эта схема не предназначена для NFS/CIFS; не является power-loss durability proof или готовым upload endpoint.

Основания: [util-linux 2.41 flock](https://raw.githubusercontent.com/util-linux/util-linux/v2.41/sys-utils/flock.1.adoc), [Node 22.23.1 child close/kill](https://nodejs.org/download/release/v22.23.1/docs/api/child_process.html), [kernel fdinfo locks](https://www.kernel.org/doc/Documentation/filesystems/proc.txt).
