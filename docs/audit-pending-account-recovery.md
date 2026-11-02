# F14 — доступ к неподтверждённому аккаунту через почту

Локальный инкремент от `221e8b3`. Неподтверждённый аккаунт больше не удерживает email без пути восстановления: первичный recovery отправляет ссылку владельцу почты. Обычная повторная регистрация по-прежнему не переписывает пароль, профиль или legal history.

## Граница владения

Запрос письма и открытие ссылки не меняют пароль, статус подтверждения, профиль, документы, роль, блокировку или сессии. Только отправка формы нового пароля с действительным токеном из письма атомарно меняет пароль и подтверждает pending email. Прежний пароль перестаёт работать; старые подтверждения, recovery token и обе разновидности сессий отзываются. Автоматического входа нет — пользователь входит обычным способом.

Используются прежние256-bit случайные токены, их SHA256 в `password_recoveries`, привязки email/auth_version и30-минутный срок. Encrypted outbox создаётся в той же транзакции, что ссылка. Пользователь блокируется первым, затем токен; expiry проверяется по wall clock после ожидания блокировки. Изменение пароля и подтверждение находятся в одной транзакции с reset_notice: ошибка откатывает все эффекты. Потерянный ответ COMMIT не вызывает автоматического повтора.

Заблокированный pending аккаунт не подтверждается и не восстанавливается. Подтверждённый заблокированный аккаунт сохраняет прежнюю возможность сменить пароль, оставаясь заблокированным. Роли и данные профиля не назначаются из recovery input. Подтверждение email, session и recovery tokens имеют разные таблицы/назначения. Старый verified recovery не оживает после снятия подтверждения: существующий DB trigger повышает auth_version.

`pendingAccounts:true` явно включён в primary HTTP composition, standalone mail runtime и локальном capture-worker. Старые verified-only adapters сохраняют прежний контракт по умолчанию. Это opt-in server constructor, не параметр HTTP body. Worker проверяет текущие email/version/expiry/source перед dispatch; отправленное ранее письмо нельзя отозвать, но его устаревший токен не работает. SMTP leases, ограничения повторов и правила unknown outcome сохранены. Bounded prune recovery-токенов в новом режиме сохраняет действительные pending links; автоматическое удаление аккаунтов не включается.

Публичный recover возвращает одинаковые202/accepted для существующего pending и неизвестного адреса. CAPTCHA, IP/email/global limits, origin/CSRF, строгие body keys, no-store, fragment ссылки и очистка адресной строки сохранены. Это проверка одинаковой публичной формы ответа, не доказательство абсолютной одинаковой задержки и отсутствия любого timing channel.

UI сообщает, что при сохранении нового пароля неподтверждённая почта подтвердится. Оно не раскрывает наличие или статус аккаунта. Существующие profile/legal snapshots остаются историей исходной регистрации; recovery не выдаётся за новую регистрацию с новыми согласиями. Пользователь может проверить данные профиля после обычного входа.

## Основания решения

[OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): одинаковый публичный ответ, письмо как отдельный канал, одноразовый ограниченный токен, отсутствие изменений до предъявления токена, обычный вход после reset и отзыв сессий. Новый поток использует эти уже существующие механизмы для pending email, без нового вида секрета или миграции.

[PostgreSQL18 Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html) и [Row-Level Locks](https://www.postgresql.org/docs/18/explicit-locking.html) подтверждают повторное чтение актуальной версии после ожидания `FOR UPDATE`. Реальные тесты дополнительно проверяют обе очередности competing операций и истечение во время ожидания.

## Проверки

```sh
npm test
npm run check:types
npm run lint
npm run check:floor -- --base 221e8b3
node --experimental-strip-types --test tests/pending-account-recovery-integration.mjs
node --experimental-strip-types --test tests/postgres-integration.mjs
node --experimental-strip-types --test tests/bootstrap-postgres-integration.mjs
npm run build
# После запуска собственного локального стенда:
node --experimental-strip-types scripts/check-local-pending-recovery.mjs
```

Используется проверенный Node22.23.1. PG/browser runners и build, использующие общий `.next`, выполняются последовательно; общий runner удаляет сборку, поэтому ручной стенд запускается после финального build. Graphify/Code Graph обновляются для того же корня. Новых миграций/привилегий/зависимостей и изменений guard нет; production и настоящая SMTP-доставка не затрагиваются.

- RED воспроизведён настоящим хранилищем: pending request возвращал null даже с новым opt-in.
- Native2305/2305, без skip; types/lint/floor прошли. Прежнее lint-предупреждение `targetType` сохранено.
- Новый PostgreSQL18.6 runner17/17, ~24 секунды: настоящая ограниченная runtime-роль и штатные grants, encrypted outbox/worker, legacy default, enabled confirmed path, duplicate registration, запрет смены статуса без токена, старые пароли/ссылки/обе scopes, blocked pending, stale state/demotion/prune, SQL-trigger rollback, неизвестный COMMIT, конкуренция confirm/resend/reset, token expiry после ожидания. Отдельно выполнен настоящий standalone runtime factory с фактическим worker и локальным SMTP adapter.
- Общий PostgreSQL/browser137/137. Bootstrap/ACL/payment349/349. Production build прошёл. Локальный Chromium проверил просроченную старую ссылку, recovery через capture-письмо, отсутствие изменений на request/GET, очистку fragment, атомарную смену пароля и подтверждение почты, отказ старого пароля/ссылок, отсутствие autologin и обычный вход новым паролем. Профиль, legal history, роль и блокировка сохраняются. Интерфейс проверен на 320/768/1280 px, без внешних запросов и ошибок страницы.

Проверки не являются доказательством реальной доставки письма, полной готовности production или закрытия остальных пунктов аудита. Старый ручной `prunePendingRegistrations` не включён как worker: выбор и проверка отдельной политики удаления pending аккаунтов не подменяются восстановлением по почте.

При дальнейшем выпуске HTTP и оба mail entrypoint должны обновляться вместе: старый verified-only worker отменит pending recovery как устаревший. Локальный стенд перезапускает оба процесса. Доставка подтверждена только локальным capture/SMTP adapter, не реальным провайдером.

Ревью дополнено mutation-проверкой: инверсия server opt-in в `PasswordRecoveryStore` приводит к падению нового PG regression. Исходник после проверки восстановлен побайтово.
