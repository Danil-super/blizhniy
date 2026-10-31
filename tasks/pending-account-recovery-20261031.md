# F14 — восстановление неподтверждённого аккаунта

Основа `221e8b3`, только локально. Не менять production/права БД/guard и старые assertions. Закрываем блокировку email через владение почтой, а не DELETE аккаунтов или перезапись пароля при signup.

## Контракт

- Первичный recovery обслуживает подтверждённые и неподтверждённые незаблокированные аккаунты по одинаковому публичному202 ответу. Запрос не меняет пользователя, пароль, подтверждение, профиль, документы или сессии. Повторный signup остаётся no-op; resend с прежним паролем не становится recovery.
- Используется существующий recover purpose, таблица password_recoveries, криптографический256-bit токен, hash/email/auth_version binding, TTL30min и encrypted outbox в одной транзакции. Новая схема/права не нужны. Отдельный constructor opt-in pendingAccounts=true включает поведение в primary composition и его worker; старые verified-only adapters сохраняют контракт по умолчанию.
- Только POST нового пароля с действительным токеном из письма атомарно меняет пароль и подтверждает pending email. Сначала user lock, затем token lock, wall-clock expiry после lock. auth_version повышается; app/data-subject sessions, старые подтверждения и recovery token отзываются. Роль, блокировка, профиль и legal history не меняются; session не выдаётся, затем обычный login. Заблокированный pending аккаунт не подтверждается; подтверждённый заблокированный сохраняет прежнюю возможность сменить пароль, оставаясь заблокированным.
- Старый подтверждённый recovery не оживает после снятия подтверждения: действующий users_guard_auth_version увеличивает версию. При confirm/reset/resend запросы сериализуются user-first; проигравшие/старые ссылки не восстанавливают пароль или сессии после reset. Ни один COMMIT/письмо автоматически не повторяется при неизвестном исходе.
- Worker pending opt-in проверяет текущие email/version/expiry/source перед отправкой, сохранённые SMTP outcome/leases/retries не меняются. Prune в этом режиме сохраняет допустимые pending recovery; никаких автоматических удалений аккаунтов. Ссылка во fragment; GET/scanner не меняет аккаунт. CAPTCHA, shared rate limits, origin/CSRF/body gates, no-store и generic responses остаются.
- UI не обещает восстановление только подтверждённого аккаунта; ясно сообщает, что установка нового пароля по письму подтверждает почту при необходимости. Не показывает статус существования аккаунта.

## Проверки

RED существующего хранилища с pending account и новым opt-in. Настоящие PG/outbox/worker: ownership,32byte token/singleuse/TTL, смена credentials+confirmation, отказ старого пароля/confirm/токенов, обе session scopes, отсутствие autologin, нет повышения роли/снятия block, блокированный pending, неизвестный email, rotation, rollback, stale state, demotion, expiry while locked, concurrent confirm/resend/reset. Отдельно enabled verified path и legacy regression. Chromium primary UI через локальный перехватчик, без настоящих писем; no token/PII в отчетах. Native/types/lint/floor, PG/bootstrap/build; графы текущего корня и локальные коммиты. Общий PG runner очищает `.next`; финальный стенд пересобрать после него.

Основание безопасности: OWASP Forgot Password Cheat Sheet (uniform public response, side-channel token, no state change before valid token, normal login after reset) и PostgreSQL18 row locking docs. Это локальная проверка, не доказательство реальной SMTP-доставки или закрытия всего аудита.

## Локальный результат — 31.10.2026

Реализован opt-in восстановления pending email в первичном HTTP и обоих mail entrypoint; локальный capture-worker использует тот же режим. Старый signup и verified-only default не меняются. Схема, grants, guard и прежние assertions сохранены.

RED воспроизведён. Native 2305/2305, новый PG 17/17, общий PG/browser 137/137, bootstrap/ACL/payment 349/349, types/lint/floor и production build прошли. Chromium проверил реальный primary UI и локальную доставку через capture, атомарную смену пароля/подтверждение email, отсутствие autologin, старые токены и responsive layout. Mutation server opt-in ловится PG regression. Детали и границы — `docs/audit-pending-account-recovery.md`.

Локальный стенд пересобран и перезапущен после общего PG runner. Push/deploy, production DB, реальные SMTP и платежи не выполнялись.
