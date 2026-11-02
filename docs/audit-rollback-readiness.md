# F18 — проверка готовности после отката

01.11.2026, основа `e1bd1f9`, реализация `7aaac98`. Изменения и приёмка только локальные: рабочие VPS/БД, SSH, схемы, grants, платёжные режимы и workflows не менялись. Оба существующих script пути исправлены в исходниках, но ещё не опубликованы на сервере. F17 переключение двух разных releases и его production интеграция остаются отдельной задачей.

## Исправление

Отдельный `rollback-release.sh` раньше считал достаточно успешного `/api/health`. Автоматический `rollback()` в `deploy-release.sh` вообще сохранял PM2 state без повторного readiness. Кроме того, вызов функции в `||` context отключает обычное действие `errexit` внутри неё: failed start мог завершиться `pm2 save` и ложным успехом.

Теперь до изменения процесса читается ожидаемый BUILD_ID предыдущего release, а после запуска единый `check-rollback-readiness.mjs` проверяет:

1. health200 и JSON `ok:true`;
2. ready200/`ok:true`/service: этот маршрут выполняет настоящий PostgreSQL preflight и SELECT справочника;
3. HTML200 с PostgreSQL backend и initial Next Flight build identity, совпадающей с ожидаемой;
4. доступность и JavaScript-содержимое manifest этой сборки.

Один deadline45s охватывает все стадии и read-only startup attempts. Нет redirects, внешних адресов или повторов мутаций; используются literal127.0.0.1 и валидный высокий PORT. Настройка HEALTH_URL отдельного rollback больше не выбирает произвольный endpoint: readiness всегда проверяет восстановленный локальный web. HTTP/status/body bounds и HTML parser переиспользуют F17 helper. Parser привязан к проверенному Next15 App Router wire format и закрывает проверку при несовместимом изменении.

BUILD_ID читается ограниченно через один O_NOFOLLOW/O_NONBLOCK descriptor: regular file, правильный UID, nlink1, без group/world write, до129байт. Release и `.next` должны быть каноническими собственными каталогами без небезопасных прав; предки принадлежат root/operator и не writable другими. Root-owned sticky shared ancestor (`/tmp` у собственных fixtures) допустим по правилам защиты owned entry. Допускается одна ASCII safe строка до128символов с необязательным финальным LF. Файл/каталоги symlink, hardlink, неверные режимы, multiline/oversize и alias paths отвергаются без вывода пути/содержимого.

Путь helper фиксируется физически **до** переключения `APP_DIR`: watchdog запускает script через меняющуюся symlink. Старый release не обязан содержать новый helper. Auto rollback теперь явно прерывается при failed metadata/ln/mv/mkdir/start/probe/save; условный вызов не маскирует эти ошибки. После успешного probe active link ещё раз сверяется с восстановленным release. Только затем `pm2 save` и сообщение об успехе.

Failed readiness оставляет запущенный предыдущий release для разбора, возвращает ненулевой статус и не сохраняет его как подтверждённое восстановление. Нет повторного качания releases, удаления истории, DB down-migrations или автоматических списаний. Неподходящие/отсутствующие metadata блокируют восстановительные мутации; не существует fallback к health-only успеху.

## Проверки

Новые независимые RED tests сначала воспроизвели ложный успех и сохранение после failed start. После исправлений:

- Новые native25/25: actual shell paths с приватными filesystem/command fixtures; реальные HTTP stages/deadline/retry и metadata/CLI. Покрыты запуск через `APP_DIR`, отсутствие helper в старой версии, failed ln/mv/mkdir/start, смена active symlink во время probe, failed SHA guard, wrong build, malformed/redirect/hanging responses. Условия существующих tests не ослаблялись.
- Все6 watchdog orchestration scenarios прошли. Добавлены только новые fixture inputs/helper mock: это доказательство shell orchestration, а не настоящего PM2 или HTTP readiness. Настоящий HTTP helper проверяется отдельно.
- Native2435/2435 без skip, настоящий PostgreSQL/browser137/137, bootstrap/ACL/payment349/349, types/lint/floor и production build прошли. Единственное lint warning — прежний `targetType`. Shell syntax check прошёл. Временное удаление auto readiness вызова ломает новый regression; исходник восстановлен побайтово, focused32/32 прошли после восстановления.
- `check-local-rollback-readiness.mjs` проверил настоящий owned primary PostgreSQL/HTML/build; неправильный build отвергается. Отдельный реальный Next с отсутствующей DB-конфигурацией отвечает health200/ready503 и отвергается helper. Это конфигурационная отрицательная проверка, **не** outage/перезапуск production PostgreSQL. Stand/PM2 links и пользовательские записи этим fixture не меняются.
- Финальная сборка привязана к `7aaac98d2cbab213bcb147f385f8f72e354f2179`. Настоящий standalone package80293259байт прошёл SHA256 и inventory/ABI/permissions validator. Новый helper и все его F17 imports присутствуют в manifest; helper **из распакованного пакета** прочитал его BUILD_ID и успешно проверил настоящий primary web этой сборки. Артефакт и доказательства лежат приватно в `~/.cache/blizhniy-audit-f18`, не опубликованы. SHA256: `db7bf3ee6b155bb00943feb0c4b255104976017104d8c4b122329a37966cdf8c`.
- Graphify и Code Graph обновлены для того же корня. Ручной primary стенд перезапущен после окончательной сборки: `https://127.0.0.1:3045`.

Команды приёмки с проверенным Node22.23.1:

```sh
node --test tests/rollback-probe.test.mjs tests/rollback-readiness.test.mjs tests/deploy-readiness.test.mjs
bash scripts/test-deploy-watchdog.sh
bash -n scripts/deploy-release.sh scripts/rollback-release.sh scripts/test-deploy-watchdog.sh
node --experimental-strip-types scripts/check-local-rollback-readiness.mjs
npm test
npm run test:postgres:local
node --experimental-strip-types --test tests/bootstrap-postgres-integration.mjs
npm run build
npm run check:types
npm run lint
npm run check:floor -- --base e1bd1f9
```

PostgreSQL/browser runner очищает `.next`, поэтому окончательная сборка и types выполняются после него. Для packaging требуется чистый checkout и BUILD_ID, связанный с полным commit через `BLIZHNIY_BUILD_COMMIT`; после документационного commit артефакт реализации по-прежнему относится к указанному SHA, а не автоматически к новой вершине ветки.

## До выпуска

Watchdog/caller обязан удерживать существующий release lock. Прямая ручная операция без него не становится безопасной благодаря последней проверке ссылки: другой root, игнорирующий lock, может вмешаться после любого чтения. Необходимо проверить staging rollback двух действительно разных совместимых артефактов на актуальной схеме и совместимых runtime/workers, а также process start failure, БД outage, reboot/PM2 persistence и уведомление оператору. Readiness не гарантирует исправность каждой бизнес-функции, производительность под нагрузкой или rollback несовместимой миграции. Недопустим автоматический обход schema/ACL preflight ради возврата старого кода.

Источник контракта build: [Next15 generateBuildId](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/generateBuildId), изученный через Context7; version skew требует одинакового артефакта/явной совместимости. Descriptor API и O_NOFOLLOW/O_NONBLOCK проверены по [Node22 fs](https://nodejs.org/docs/latest-v22.x/api/fs.html). Дополнительные секреты, привилегии и изменения guard для этого локального исправления не понадобились.
