# Приватные фотографии в российском контуре

15.10.2026. Продолжение рабочего PostgreSQL Auth/cabinet cutover. Этот документ описывает внедряемый инкремент, а не доказательство полного запуска всех разделов. Состояние установки записывается отдельно после проверки сервера.

## Размещение и границы

На прежнем VPS сайта: Next.js под `blizhniy-web`/Node22, приватные нормализованные файлы `/var/lib/blizhniy-web/media` (0700, файлы0600), отдельный decoder `blizhniy-media`. На российской managed PostgreSQL: metadata, однократные write claims и упорядоченные связи с черновиками. Ни исходные файлы, ни URL/пути не отправляются Supabase или в публичный image optimizer.

POST `/api/account/media` принимает один сырой JPEG/PNG/WebP/статичный GIF до10МиБ. Cookie, exact Host/Origin, custom request header, ожидаемый владелец, ingress overwrite и общий SQL limiter проверяются до чтения/декодирования. Стабильный UUIDv4 intent повторно используется для проверки потерянного ответа; автоматических повторов записи нет. Сначала одна авторизованная upload admission на процесс, затем socket decoder, reservation, committed single write claim, fenced filesystem write и verified ready. Общий storage budget5ГБ/10000objects сохраняется. Deadline чтения30s, ограниченный decode, файловые лимиты и неизвестные результаты не обходятся.

POST `/api/account/media/read` требует ту же App-сессию/expected owner и возвращает только ready owned bytes. GET не обслуживает файл; нет публичного URL. Ответ no-store/no-referrer/nosniff/CSP-none. Ассоциации используют прежний `/api/account/listing-photos` и общую bigint-string revision. Known фото-only CAS повышает редактору только revision; иной revision требует явной сверки текста. Неизвестный ответ не превращается в новый upload intent или слепой повтор PUT. Выбранный File/intent живут лишь в owner-scoped памяти, не в localStorage, и скрываются при перепроверке сессии.

## Декодер

`blizhniy-media.socket` — root-managed AF_UNIX socket0600 для web UID. `Accept=yes`, `MaxConnections=1` ограничивают число активных экземпляров на уровне systemd, включая случай disconnect клиента. `blizhniy-media@.service` получает accepted socket через stdin/stdout, без окружения сайта, паролей, БД и доступа к файлам пользователей. До импорта Sharp проверяются реальные UID, Node22, cgroup, NoNewPrivs, пустые capabilities, RAM512МБ/no-swap/1CPU/32tasks. Unit: PrivateNetwork, ProtectSystem=strict, namespaces restricted, runtime8s, control-group kill. Ответ ограничен2МиБ WebP и проверяется по framing/container/digest без native decode в web.

Протокол EOF/half-close проверен реальным дочерним процессом и Unix socket; это не доказательство production sandbox. Production admission требует отдельного реального запуска на VPS. Клиентский socket close не объявляется доказательством смерти worker.

## Установка оператором

1. Сверить точный migration journal и role flags. Добавить только0013 через `bootstrapPostgres(...,{includeListingPhotos:true})`, не менять прежние SQL/hashes. Down запрещён для непустых связей; обычный rollback сохраняет additive schema/data.
2. Runtime: SELECT media metadata; INSERT canonical reservation columns; UPDATE только state/ready_at. Write attempts: SELECT, INSERT(media_id), без UPDATE/DELETE. Listing photos: SELECT/INSERT(listing_id,media_id,position)/DELETE links; без UPDATE/TRUNCATE. Не давать runtime budget mutation, DDL, author/status/payment writes или owner credentials.
3. Проверить private persistent media root и пустой `.writer.lock` с web UID,0600. Создавать только отсутствующее; не обнулять существующий lock/file/claim. Поставить root-owned0640 root:web `/etc/blizhniy-media-runtime.json` с точными `{version:1,uid:994,root:"/var/lib/blizhniy-web/media",socket:"/run/blizhniy-media/decoder.sock"}`. Config не содержит секретов. Проверить immutable release/root-owned parents и точный Node binary.
4. После установки проверенного кода валидировать обе units на actual systemd VPS, daemon-reload и enable socket. Проверить реальные пиксели/orientation/metadata removal под web UID, cgroup/exit и отсутствие доступа decoder к auth/media paths. Не менять SSH, другой бот или mail timer.
5. Перезапустить только сайт: runtime cache намеренно требует restart после исправления config/socket. Проверить health/PG ready, cookie upload/read/association/reopen, чужой owner/unknown cookie. Проверить сохранение текста после фото и readback конфликтов.

Откат: закрыть socket и удалить root-managed opt-in (после безопасного остановленного upload), вернуть проверенную версию приложения, сохранив PostgreSQL Auth/session key/ingress headers. Не удалять файлы, metadata/claims/quota/0013 автоматически. Не возвращать legacy Auth, когда уже могли появиться новые аккаунты.

## Границы готовности

Редактор кабинета сохраняет основные поля и приватные фотографии. Полная форма размещения, публикация/модерация/оплата, остальные виды публикаций и публичная выдача фото ещё требуют завершения миграции. Удаление связи не удаляет файл и не освобождает quota. General account/media deletion с guarded cleanup proof и восстановление PG+media ещё не завершены. Массовый запуск не объявляется готовым по одному этому инкременту.
