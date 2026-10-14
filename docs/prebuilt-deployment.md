# Готовая сборка вместо сборки на VPS

`next.config.ts` включает `output: standalone`. Новый opt-in режим `scripts/deploy-release.sh` принимает готовый архив при `PREBUILT_RELEASE=true`, проверяет обязательную SHA256 и Node22 до изменения сервиса, затем проверяет структуру пакета и настройки CAPTCHA. Prebuilt использует umask077; tar не восстанавливает владельцев и permissions сборочной машины. `npm ci` и `next build` на VPS в этом режиме не выполняются. Health, readiness, откат и сохранение предыдущего release остаются обязательными. Старый source deploy пока сохранён.

Пакет собирается на совместимом Linux x86_64/glibc/Node22 без production DB/password/SMTP/payment secrets. Public build-time настройки должны соответствовать целевому сайту: runtime env не переписывает уже встроенные `NEXT_PUBLIC_*` значения. Не передавать закрытые настройки в GitHub. Next standalone не включает public/static автоматически: [официальная документация Next15](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output).

## Runtime CAPTCHA — подготовка 14.10.2026

Для CAPTCHA устраняется build-time зависимость: `getTurnstileSiteKey` читает только `NEXT_PUBLIC_TURNSTILE_SITE_KEY` через dynamic lookup на сервере после существующего request boundary. RootLayout отдаёт публичный ключ в React-escaped `meta[name="blizhniy-turnstile-site-key"]`. Браузер читает только этот элемент; пустой/отсутствующий meta означает отсутствие настройки, без fallback к встроенному значению. Widget и legacy AuthForm используют один getter; required-provider/expiry/error/stale-callback и серверная CAPTCHA-проверка не ослабляются. Это публичная настройка, не авторизация: изменение meta не отменяет проверку токена на сервере. Secret key/DB/SMTP/mail key не сериализуются. Смена настройки требует актуального документа страницы; это не обещание горячей ротации без reload/restart.

Основание: Next15 документирует [build-time inlining и dynamic lookup](https://nextjs.org/docs/15/app/guides/environment-variables#bundling-environment-variables-for-the-browser), а `connection()` оставляет чтение серверных переменных на runtime. Не используется несовместимый со standalone `runtimeConfig`.

Проверено: сборка с **пустым** публичным CAPTCHA key, затем отдельный production Next process с синтетическим runtime key. Настоящий Chromium видит этот ключ в ответе и в аргументе provider render; все21 HTTP/browser проверка успешны, provider/account API изолированы transport fixtures. Это не живая проверка Cloudflare/SMTP/PG и не включение нового аккаунта на VPS. Native1204/1204 и focused21/21; первоначальные private-config/heading/CAPTCHA assertions сохранены, adapters загружают реальный getter. Браузер проверяет mobile/desktop, main-region axe и keyboard; screenshot просмотрен. Это не общий WCAG/нагрузочный допуск.

**CI/source deploy пока не переключаются.** Остаются legacy browser SDK и другие public build settings, clean package/commit+lockfile manifest и проверка установки/отката готового артефакта. Не отправлять реальные закрытые настройки в builder и не применять пакет, у которого browser settings расходятся с VPS.

После успешных quality/security gates и `npm run build` упаковка выполняется в собственной временной папке, не в новой копии репозитория:

```bash
task_release_dir="$(mktemp -d /tmp/blizhniy-release.XXXXXX)"
cp -a .next/standalone/. "$task_release_dir/"
mkdir -p "$task_release_dir/public" "$task_release_dir/.next/static" "$task_release_dir/scripts"
cp -a public/. "$task_release_dir/public/"
cp -a .next/static/. "$task_release_dir/.next/static/"
cp ecosystem.config.cjs "$task_release_dir/ecosystem.config.cjs"
cp scripts/check-auth-captcha-env.cjs "$task_release_dir/scripts/check-auth-captcha-env.cjs"
tar --exclude='.env' --exclude='.env.*' --exclude='*.pem' --exclude='*.key' \
  -czf "$task_release_dir/release.tar.gz" --exclude='release.tar.gz' -C "$task_release_dir" .
sha256sum "$task_release_dir/release.tar.gz"
```

Архив и digest передаются по доверенному SSH-каналу. SHA256 обнаруживает повреждение/подмену относительно доверенного digest, но не аутентифицирует неизвестный источник. Не распаковывать произвольные сторонние архивы: installer предназначен для собственного проверенного builder. `.env*` остаются вне архива; существующие защищённые env файлы копируются deploy-скриптом только на самом VPS. После cutover старого backend нельзя автоматически копировать старые Supabase credentials как настройки новой БД.

На VPS с Node22 в начале PATH оператор передаёт `SOURCE_ARCHIVE`, `SOURCE_ARCHIVE_SHA256`, `COMMIT_SHA`, `PREBUILT_RELEASE=true` и запускает скрипт. PM2 получает точный Node22 interpreter; standalone слушает только 127.0.0.1:3000. Legacy release сохраняет `next start`. Рабочая БД не мигрируется этим скриптом.

## Проверено 10.10.2026

- На VPS отдельно установлен официальный Node22.23.3 в `/opt/blizhniy-node22`; SHA256 Linux x64 архива проверена по официальному HTTPS `nodejs.org/dist/latest-v22.x/SHASUMS256.txt`. `/usr/bin/node`20.20.2 и активный сайт не менялись.
- В `/etc/blizhniy/staging/runtime.json`0600 и каталоге0700 установлен **только runtime**, не migrator/owner. CA находится рядом. Настройки не включены в окружение текущего сайта. Реальное новое соединение с VPS к staging проверило TLS/имя, counts105/7, отсутствие elevated flags, CONNECT к default_db и EXECUTE app/meta.
- Локально: native1030/1030, types/lint без ошибок (прежний warning сохранён), build58 страниц, production-only audit0. Негативные deploy тесты сначала воспроизвели прежнюю установку/сборку, принятие неправильного digest и доступный другим release-каталог, затем прошли; инверсия Node22 условия поймана и восстановлена.
- Пакет71 МБ передан на VPS и SHA256 повторно проверена. Изолированный loopback-процесс на3001 прошёл настоящий native Sharp и health/ready, RSS около165 МиБ, затем завершён. Копия в `/var/www/blizhniy-prebuilt-rehearsal` сохраняется как известный проверенный пакет; это не второй постоянно работающий сайт. Его env остаётся закрытым0700/0600.
- Readiness этого пакета всё ещё зависит от **старого Supabase backend**. Проверка не доказывает готовность новой авторизации, публикаций, фото или платежей. Публичный сайт не переключён, исходная основная БД не менялась. Новая DB connectivity и проверка приложения — разные доказательства, не end-to-end нового backend.

L21 остаётся открыт: CI ещё не публикует standalone artifact и source deploy остаётся текущим автоматическим путём; до его замены нужны чистая CI-упаковка, public build settings, commit/lockfile manifest и deployment rehearsal самого нового контура. Нельзя считать локальный production-only audit заменой всех обязательных release scanners.
