# F15 — нормализация новых аватаров на сервере

Локальный инкремент от `b67347f`, 31.10.2026. Проверка сигнатуры не доказывала, что файл содержит корректное изображение: header-only PNG/JPEG мог пройти в профиль. Ошибка воспроизведена тестом настоящего `PostgresProfileStore`: до исправления новый trusted normalization callback игнорировался, и повреждённый input сохранялся.

## Что изменено

Первичный runtime профиля всегда передаёт серверный `normalizeAvatar`. До его вызова store копирует и валидирует поля, проверяет app-сессию, владельца и ожидаемую revision. Затем завершает транзакцию. Изолированная обработка не удерживает соединение или блокировки БД. После неё новая транзакция повторяет авторизацию и CAS. Смена версии профиля, отзыв сессии или блокировка пользователя во время обработки запрещают запись. Неизвестный результат записи не повторяется автоматически.

`profile-avatar.ts` принимает только canonical base64 data URL JPEG/PNG/WebP до 300 KiB и передаёт байты существующему декодеру. В production это защищённый Unix socket с тем же клиентом и ограничением одновременной работы, что у фотографий публикаций. Локальный ingress использует тот же store/adapter и существующий systemd worker. Sharp не загружается в веб-процесс для этой операции. Вызов decoder ленивый: обычное чтение и сохранение настроек с прежним аватаром не требуют его доступности.

Decoder полностью читает пиксели с `failOn: warning`, лимитом 24 MP и четырёх каналов, отклоняет анимацию, корректирует EXIF-ориентацию и создаёт WebP без исходных метаданных. Сохраняется только проверенный бинарным протоколом ответ, до 300 KiB и 2048 px по каждой стороне. UI по-прежнему создаёт квадрат 512×512; этот размер подтверждён в браузере и реальном SQL runner. Прямой API может передать иной формат сторон, сохраняя те же серверные ограничения. Ограничения ОС существующего worker: 512 MiB RAM, без swap, CPU 100%, до 32 задач, 8 секунд работы и принудительная остановка всей группы процессов; transport deadline до 10 секунд. Это повторное использование существующей изоляции, не новая гарантия абсолютной безопасности нативного декодера.

Повреждённый, слишком большой или неподдерживаемый input получает 422 `INVALID_INPUT`. При недоступности decoder, busy, abort или неверном ответе сохранения нет: HTTP возвращает существующий 503 `PROFILE_UNAVAILABLE`. Исходные байты не используются как fallback, внутренние ошибки и пути не попадают в ответ. Прежний аватар и остальные поля остаются в БД. Удаление аватара не требует декодирования. Повторное сохранение с тем же изображением сохраняет его побайтово, без повторного сжатия.

Изменений схемы, grants, зависимостей, guard, старых assertions, production или внешних сервисов нет. Default старых store-адаптеров без callback сохранён; первичный runtime и локальный ручной стенд проверены с callback. Миграция/массовая проверка исторических аватаров не выполнялась: прежняя неизменённая строка переносится без пережатия, нормализация происходит при замене. Это исправление приёма новых изображений, а не доказательство корректности всех исторических файлов. Встроенный data URL остаётся в существующем private profile JSON; общий media cleanup F08 не заменяется этой работой.

## Проверки

```sh
npm test
npm run check:types
npm run lint
npm run check:floor -- --base b67347f
NODE_ENV=test node --experimental-strip-types --test tests/profile-avatar-postgres-integration.mjs
npm run test:postgres:local
node --experimental-strip-types --test tests/bootstrap-postgres-integration.mjs
npm run build
# После запуска своего локального стенда:
node --experimental-strip-types scripts/check-local-normalized-avatar.mjs
```

Проверенный Node 22.23.1. Общий PG runner удаляет `.next`, поэтому он выполняется до финальной сборки и запуска стенда. Отдельный avatar runner использует собственный digest-pinned PostgreSQL 18.6, штатные profile grants и реальный systemd decoder, не изменяет `.next` или общую ручную БД и удаляет только свой проверенный контейнер и временные credentials. Браузерный runner создаёт собственный synthetic account, читает только его mail IDs/capture-файлы и удаляет его данные и письма после проверки; реальный SMTP не используется.

- RED: 7 из первых 18 boundary cases падали; первый фиксировал сохранение signature-only PNG.
- Boundary: 21/21 с реальным store/guard и SQL adapter. Проверены неизменность caller input, отсутствие транзакции при decode, preflight, CAS/session races, concurrent create, rollback и ограничение обработки прежних аватаров.
- Normalizer: 6/6 с настоящим pixel decode; форматы, ориентация, метаданные, truncated/header-only, MIME mismatch, анимация, размеры, malformed reply и abort.
- Primary runtime: 2/2 через настоящий factory/HTTP/store/adapter и подменённые DB/socket boundaries. Удаление callback из primary composition вызывает падение regression; после mutation исходник восстановлен побайтово.
- Новый PG/decoder: 7/7, без skip; настоящие restricted runtime grants, JPEG/PNG/WebP, metadata removal, HTTP 422, отсутствие записи при busy/abort, content/session races и SQL trigger rollback.
- Общий PG/browser: 137/137; bootstrap/ACL/payment: 349/349.

Native 2334/2334, без skip. Types/lint/floor и production build прошли; прежнее lint-предупреждение `targetType` не скрывалось. Chromium на пересобранном локальном стенде проверил отказ malformed direct upload, crop/save/replace/reload/remove, серверный WebP 512×512 без метаданных и отсутствие пережатия при сохранении настроек. Проверены 320/768/1280 px, без ошибок страницы и внешних запросов. Graphify/Code Graph обновлены для текущего корня. Это не production-приёмка и не подтверждение закрытия остальных пунктов аудита.

## Документация решения

Актуальная документация Sharp получена через Context7 (`/lovell/sharp`). [Constructor](https://sharp.pixelplumbing.com/api-constructor/) описывает `failOn`, pixel/channel limits и формат input; [output](https://sharp.pixelplumbing.com/api-output/) — полное `toBuffer`, удаление метаданных и границы timeout. Метаданные заголовка сами по себе не доказывают успешное декодирование пикселей; отдельный regression воспроизводит этот случай.
