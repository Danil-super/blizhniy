# ADR-002: Серверные сессии и ограниченный scrypt

Статус: реализовано и проверяется локально в рамках принятой архитектуры 09.10.2026. Публичный вход и production-переключение ещё не выполнены.

## Контекст

Отказ от Supabase требует собственной серверной идентификации. На VPS около 2 ГБ RAM; сессии нужно отзывать сразу после смены учётных данных и не терять при перезапуске приложения. Блокировка обычного доступа не должна лишать пользователя возможности запросить удаление/экспорт своих данных.

## Решение

- Встроенный async scrypt Node.js 22: N=131072, r=8, p=1, свежая 16-байтная соль. Не более двух вычислений одновременно на процесс, без очереди. Новые пароли 15–128 Unicode-символов, без изменения пробелов/нормализации; malformed Unicode и NUL отклоняются.
- Сессия — случайный токен 32 байта. PostgreSQL хранит только SHA-256 токена, владельца, scope, версию учётных данных и сроки; plaintext токен выдаётся исключительно серверному cookie-handler.
- Абсолютный срок 8 часов, простой 30 минут. Роли и блокировка читаются из БД на каждом запросе. JWT/localStorage и browser-to-DB доступ не используются.
- Подтверждение email обязательно перед выдачей сессии. Выдача блокирует строку пользователя и повторно проверяет hash/version после KDF, выполненного вне транзакции. Триггер повышает auth_version при смене пароля/почты или снятии подтверждения, запрещая оживление старых сессий.
- Обычный scope — `app`. Отдельный `data-subject` допускает заблокированного владельца только к будущим ownership-checked запросам удаления/экспорта; обычный resolver не принимает такой токен даже после снятия блокировки.

## Альтернативы

JWT требует дополнительного state для немедленного отзыва, поэтому не упрощает два имеющихся сервера. bcrypt ограничивает длину пароля в байтах; native scrypt не требует новой npm/native зависимости. Argon2 можно рассмотреть при смене Node.js, но не нужно устанавливать новый сервис или ослаблять параметры ради текущего VPS.

## Последствия

Каждая проверка сессии обращается к БД и отказывает при её недоступности. Ограничение KDF не заменяет общий серверный rate limit и CAPTCHA. Прежде чем публиковать Auth, нужны HttpOnly/Secure/SameSite cookies, CSRF/origin, email-confirm/recovery, общий limiter, аудит без секретов и production runtime-права. Старые маршруты остаются нетронутыми до проверки замены.

Основание: [Node.js scrypt](https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html). Проверки и статус — [tasks/todo.md](../../tasks/todo.md).

## Уточнение: регистрация и подтверждение

Pending account, отметки двух документов и подтверждение создаются одной транзакцией. Дубликат email не является reset: не меняем его пароль, legal records или токен. Это исключает перехват аккаунта повторной регистрацией. Повторное письмо требует исходный пароль; забытый пароль восстанавливается отдельным потоком, а не заменой данных регистрации.

Подтверждение — отдельная таблица с хешем случайного токена, email/auth_version и сроком 1 час. В отличие от stateless signed URL, это позволяет атомарно потребить ссылку и отозвать прежнюю при resend. Ссылка не выдаёт сессию: после подтверждения нужен обычный вход. Порядок user → token совпадает с login/resend, а срок проверяется после lock по `clock_timestamp()`, не по времени начала transaction.

Agreement acceptance и privacy review — разные записи, не универсальное согласие на обработку/рекламу/передачу третьим сторонам. Время/версию фиксирует сервер, неизвестные поля запрещены. Хранить IP/user-agent ради этих отметок сейчас не нужно. Для неподтверждённых аккаунтов установлен порог очистки 24 часа; удаление каскадное, до 100 записей за вызов с SKIP LOCKED. Maintenance schedule перед запуском обязателен, иначе порог сам по себе ничего не удаляет.

Эти операции проверены только на локальном PostgreSQL; HTTP-защиты, новая registration-форма и loopback capture подключены только при явном локальном режиме. Реального SMTP/production-переключения нет. Основание: [OWASP email verification](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html).

## Уточнение: cookie boundary и смена аккаунта

Локальные login/session/logout требуют HTTPS и только одну `__Host-blizhniy_session` cookie: Secure, HttpOnly, SameSite=Lax, Path=/, без Domain. Токен не дублируется в JSON/Bearer/localStorage. Prefix защищает от Domain/path shadowing в поддерживающих браузерах; duplicate и malformed cookie отклоняются независимо от browser policy. Точный Origin/Host, JSON/custom header и ограничения тела действуют и на logout/session. Короткий абсолютный срок проверяет БД, cookie его не продлевает.

При успешном входе старая app-сессия браузера отзывается вместе с созданием новой в одном commit. Одна замена cookie без отзыва позволила бы продолжать использовать старый токен; отдельная операция отзыва теряла бы прежний вход при неудачной вставке. Неуспешная проверка пароля ничего не отзывает. Предъявленный токен другого scope не удаляется этой операцией. Login не является безопасной автоматической retry-операцией после неизвестного commit; клиент проверяет текущую сессию.

Общий credential limiter не применяется к session/logout: исчерпание попыток или блокировка не должны лишать пользователя возможности выйти. Это не отменяет будущие production ограничения запросов/пула на доверенном proxy. При сбое DB logout отвечает 503 и не изображает успешный отзыв. HTTP API использует один pool с registration; resource guards дополнительно обязаны проверить владельца/роль.

Проверка Chromium показала отказ `__Host-` cookie на прежнем HTTP-стенде. Поэтому runner перешёл на собственный HTTPS с короткоживущим SAN-сертификатом; Node доверяет только его CA, Chromium — только его SPKI. Cookie Secure не отключается даже локально. Основания: [cookie prefixes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#cookie_prefixes), [Next.js development HTTPS](https://nextjs.org/docs/app/api-reference/cli/next#using-https-during-development).

## Уточнение: локальная форма и клиентское состояние

`/auth/local/login` доступен только в явно включённом локальном HTTPS-контуре. Серверный render не читает cookie/БД и показывает проверку сессии, не данные прежнего аккаунта. Клиентский adapter вызывает только same-origin JSON POST; принимает точный публичный user-contract и согласованные пары HTTP status/error code. Только 401 UNAUTHENTICATED означает анонимную сессию; 503, timeout и повреждённый ответ не являются успешным выходом.

При проверке, смене аккаунта и logout прежняя identity сразу убирается из UI; пароль очищается после попытки. После успешной мутации выполняется отдельная session-проверка: успех login JSON сам по себе не доказывает, что браузер сохранил cookie. Неизвестный commit не повторяется автоматически; пользователь может проверить фактическую сессию или повторить выход. Неудачный login не отзывает существующую сессию: отмена смены аккаунта заново запрашивает сервер, не восстанавливает cached identity.

Ответ применяется только к актуальной версии состояния и смонтированной форме; cleanup инвалидирует незавершённые lookup, в том числе при Strict Mode. BroadcastChannel передаёт лишь `{type:"changed"}`, без email/ID/credential; другие вкладки убирают старую identity и читают сервер. При отсутствии BroadcastChannel остаётся проверка на focus/возврате видимости и восстановлении страницы из bfcache. Периодический polling не используется, чтобы не продлевать idle lifetime. Это синхронизация представления, **не** замена owner/role guard на каждом resource API.

Проверки: реальная форма двух аккаунтов, reload, ошибочный пароль, выход, delayed lookup после смены во второй вкладке, неизвестный login/logout result, обновление роли и блокировка, доступность на 320/768/1024/1440. Старый `/auth`, его browser storage и предметный кабинет пока не переключены/не очищаются этим кодом. Тесты не обращаются к production, не отправляют реальные письма; новых npm-зависимостей нет. Основания: [BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel), [React effect cleanup](https://react.dev/reference/react/useEffect).

## Уточнение: серверное восстановление пароля

Отдельный `PasswordRecoveryStore` и таблица `app.password_recoveries` не переиспользуют подтверждение email или session token. Хранится SHA-256 случайного 256-битного токена, user_id, текущие email/auth_version и срок 30 минут. Email — ПД, необходимая только для привязки ссылки к проверенному адресу; IP/user-agent/пароль не добавляются. UNIQUE(user_id) ограничивает один активный challenge и индексирует FK для каскада; повторный запрос вращает ссылку атомарно и не меняет пароль/сессии. Pending account не подтверждается восстановлением.

Восстановление доступно подтверждённому владельцу, включая заблокированного: смена пароля не снимает блокировку/не меняет роль, а возможность data-subject доступа с новым паролем сохраняется. Сама функция не делает автоматический вход. Reset принимает ровно token/password; пароль обрабатывается прежним bounded scrypt вне транзакции, без изменения пробелов. В одной транзакции user → recovery-row блокируются в согласованном порядке, challenge проверяется/потребляется, пароль меняется, auth_version увеличивается и все app/data-subject сессии владельца удаляются. Старые подтверждения email также удаляются. Результат — только внутренний email receipt для будущего уведомления после commit, не публичный ответ.

Срок проверяется `clock_timestamp()` **после обеих блокировок**. Реальный тест воспроизвёл, что `DELETE ... expires_at > clock_timestamp()` может проверить условие перед ожиданием tuple lock и затем потребить истёкшую ссылку. Поэтому recovery-row явно блокируется отдельным SELECT до удаления. `now()` также непригоден для этой проверки: это время начала транзакции, а не потребления. SQL defaults используют общий `statement_timestamp()` вставки, чтобы created/expires имели точную разницу 30 минут и срок начинался после ожидания user lock.

Ошибки вставки/обновления/удаления откатывают link/password/version/sessions; повтор после неизвестного commit не выполняется автоматически. Pruning удаляет максимум 1000 истёкших/устаревших хешей, SKIP LOCKED пропускает занятые строки, пользователи не удаляются; расписание перед production обязательно. PUBLIC-доступ отозван, down разрешён только для пустой таблицы, без CASCADE или удаления аккаунтов. Stateless recovery и reuse confirmation были отклонены: нужна проверяемая одноразовость/отзыв и разделение purpose.

Серверный модуль и локальный HTTP подключены, но это **не готовый публичный recovery flow**: браузерная форма и production-доставка остаются следующими инкрементами. Возврат token/null/receipt и разницу времени внутренних DB-веток нельзя напрямую переносить в публичный контракт. Реального SMTP, российских production migrations и cutover нет.

Основания: [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [PostgreSQL time functions](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT), [Read Committed](https://www.postgresql.org/docs/18/transaction-iso.html#XACT-READ-COMMITTED).

## Уточнение: локальный recovery HTTP

Оба действия требуют HTTPS, строгие Host/Origin/custom-header/JSON/body limits и прежний shared PostgreSQL limiter до credential работы. Recover принимает только email, reset только token/password. Recover возвращает 202 до ветки существования аккаунта: два ограниченных задания на процесс, без очереди. Медленный поиск/блокировка/недоставка не меняют accepted response и не добавляют account-dependent задержку в сам handler. Широкая DB/capacity ошибка до admission даёт generic 503 независимо от существования адреса. Job exception поглощается/логируется без ПД, slot всегда освобождается.

Выбор ограничен локальным capture: in-process worker может потерять задания при перезапуске и **не подходит для production**. Долговечная доставка/outbox с испытанием сбоя/restore обязательна отдельным инкрементом до cutover. Синхронный поиск/доставка отвергнуты из-за раскрытия через время ответа; неограниченная очередь — из-за памяти/ПД, искусственный минимальный sleep — из-за медленных хвостов и удержания запросов. Автоматического retry после неизвестного commit нет.

Ссылка идёт только в защищённый loopback sink, token в fragment, не query. Reset выполняется явно POST, 200 password_reset не содержит receipt/identity/credential и не создаёт сессию. Не меняется чужая browser cookie; существующие app/data-subject сессии именно владельца удаляются транзакционно. Уведомление после commit не содержит новый пароль; его недоставка не превращает успешный reset в 503/ложное приглашение повторить.

Runtime-проверка обнаружила, что Next config перезаписывал no-referrer из API и писал запрещённый query token в dev access log. Последние auth-specific headers и узкий ignore auth URL устраняют оба эффекта; unrelated dev logging/общие headers не меняются. Собственные status/code/duration events остаются без URL/body/email/token; requestId и явно заданный entryPoint доходят до capture. Это не разрешает production proxy logging sensitive URLs — его настройка отдельная. Основание: [Next logging](https://nextjs.org/docs/app/api-reference/config/next-config-js/logging).
