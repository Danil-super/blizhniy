# Транзакционная почта Timeweb

## Статус

SMTP-адаптер и отдельная операторская проверка реализованы. Регистрация и восстановление пока не используют этот адаптер: локальный capture-контур и действующая авторизация не переключены. Постоянная очередь, её worker и production-safe HTTP-граница — следующие инкременты L05–L07, не завершённая функциональность.

12.10.2026 новый модуль проверен на VPS через Node22.23.3: TLS/authentication успешны; SMTP принял одно техническое письмо на собственный ящик notifications. Это подтверждает SMTP acceptance, но не доставку в папку входящих. Сообщение не содержит пользовательских данных или одноразовых токенов. Production-процесс, его environment и схема БД не изменены.

## Контракт

- `src/lib/timeweb-mail.ts` — только серверный код; disabled-by-default, без dotenv/legacy fallback.
- Режим `BLIZHNIY_MAIL_MODE=timeweb`, логин `BLIZHNIY_SMTP_USER` и пароль `BLIZHNIY_SMTP_PASSWORD` задаются явно. При отсутствии всех трёх переменных модуль отключён; частичная/неправильная настройка отказана.
- Разрешён только уже выбранный ящик `notifications@ближний-ру.рф`. Логин и SMTP-envelope используют ASCII/Punycode-домен; пароль сохраняется побайтово, включая обратную косую черту и пробелы.
- Endpoint фиксирован: `smtp.timeweb.ru:465`, implicit TLS, проверка сертификата/имени, минимум TLS1.2. Connection/greeting/DNS timeout 5 секунд, idle socket timeout 15 секунд. Небезопасный ambient `NODE_TLS_REJECT_UNAUTHORIZED=0` отказан.
- Письмо — ровно один адрес, UUID намерения, ограниченные subject/text; без подмены from, произвольных заголовков, вложений, чтения файлов или URL. CRLF в адресе/subject отказаны. Кириллический текст кодирует Nodemailer.
- TLS/auth проверить можно без отправки. `send()` означает принятие SMTP-сервером, а не доставку получателю. Каждый вызов делает одну попытку. Стабильный Message-ID **не** обеспечивает exactly-once: сервер может принять письмо до потери ответа.
- Ошибки наружу: `AUTH_FAILED`, `TEMPORARY`, `REJECTED`, `UNKNOWN`; без raw SMTP response, адресов, тела, токенов, пароля или exception cause. Unknown нельзя считать доказанным отказом доставки.

## Хранение и проверка конфигурации

Секреты находятся вне Git. На VPS подготовлен `/etc/blizhniy/staging/smtp.json` (root, 0600) под каталогом 0700. Это конфигурация отдельной проверки, **не** активное окружение сайта. Перед будущим worker нужны явно назначенная непривилегированная runtime-учётная запись и минимальный доступ к её конфигурации.

Формат JSON — ровно три строковых ключа:

```json
{
  "BLIZHNIY_MAIL_MODE": "timeweb",
  "BLIZHNIY_SMTP_USER": "notifications@xn----9sbphbgks4a4a.xn--p1ai",
  "BLIZHNIY_SMTP_PASSWORD": "<пароль из защищённого канала>"
}
```

Диагностика из корня проекта на Node22, без отправки:

```sh
node --experimental-strip-types scripts/check-timeweb-mail.mjs /etc/blizhniy/staging/smtp.json
```

CLI принимает только абсолютный путь, проверяет regular file/владельца/0600, не следует final symlink и читает максимум 4097 байт с отказом при >4096. Не переносит содержимое JSON в process.env. Успех: `{"smtp":"authenticated","messageSent":false}`; ошибка — только обезличенный код. На VPS диагностическая копия расположена в существующем `/var/www/blizhniy-prebuilt-rehearsal`, отдельно от активного релиза.

## Проверки и оставшиеся границы

33 focused-теста: opt-in/config, IDN, injection/URL-shaped адреса, границы длины, запрещённые вложения, безопасные ошибки, ambiguous acceptance, отсутствие retries, real MIME и private config loader. RED→GREEN; временное отключение TLS certificate validation обнаружено тестом и отменено. Native1063/1063, сборка58 страниц, types после сборки успешны; lint0 errors/одно прежнее предупреждение. Clean frozen `npm ci --ignore-scripts` успешен; установка не запускает dependency lifecycle scripts (существующая `.npmrc` также задаёт ignore-scripts). Nodemailer10.1.0 закреплён lockfile; новых транзитивных runtime dependencies нет. `npm audit signatures`: 402 package registry signatures и 70 attestations подтверждены. Production-only advisory audit0; отдельные прежние build/dev риски и CI scanners не считаются закрытыми этим результатом.

Следующий этап: атомарная запись задания вместе с регистрацией/recovery; зашифрованный payload с recipient/token, сроки и удаление, bounded worker с claim/lease и backoff, тесты restart/конкуренции/unknown outcomes. Не подключать SMTP непосредственно вместо локального capture и не снимать local-only guards, выдавая это за production Auth.

## Официальные источники

- [Timeweb Cloud: SMTP-параметры](https://timeweb.cloud/docs/mail/email-clients-configuration).
- [Nodemailer: SMTP/TLS, таймауты, verify и ограничения источников](https://nodemailer.com/smtp).
- [Nodemailer: поля сообщения](https://nodemailer.com/message).
