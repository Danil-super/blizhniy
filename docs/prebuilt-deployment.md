# Готовая сборка вместо сборки на VPS

`next.config.ts` включает `output: standalone`. Новый opt-in режим `scripts/deploy-release.sh` принимает готовый архив при `PREBUILT_RELEASE=true`, проверяет обязательную SHA256 и Node22 до изменения сервиса, затем проверяет структуру пакета и настройки CAPTCHA. Prebuilt использует umask077; tar не восстанавливает владельцев и permissions сборочной машины. `npm ci` и `next build` на VPS в этом режиме не выполняются. Health, readiness, откат и сохранение предыдущего release остаются обязательными. Старый source deploy пока сохранён.

Пакет собирается на совместимом Linux x86_64/glibc/Node22 без production DB/password/SMTP/payment secrets. Public настройки CAPTCHA, карты и временного legacy SDK поступают из runtime ответа страницы; серверные legacy URL/anon и site URL также используют dynamic lookup. Development/demo flags не становятся production runtime switches. Не передавать закрытые настройки в GitHub. Next standalone не включает public/static автоматически: [официальная документация Next15](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output).

## Runtime CAPTCHA — подготовка 14.10.2026

Для CAPTCHA устраняется build-time зависимость: `getTurnstileSiteKey` читает только `NEXT_PUBLIC_TURNSTILE_SITE_KEY` через dynamic lookup на сервере после существующего request boundary. RootLayout отдаёт публичный ключ в React-escaped `meta[name="blizhniy-turnstile-site-key"]`. Браузер читает только этот элемент; пустой/отсутствующий meta означает отсутствие настройки, без fallback к встроенному значению. Widget и legacy AuthForm используют один getter; required-provider/expiry/error/stale-callback и серверная CAPTCHA-проверка не ослабляются. Это публичная настройка, не авторизация: изменение meta не отменяет проверку токена на сервере. Secret key/DB/SMTP/mail key не сериализуются. Смена настройки требует актуального документа страницы; это не обещание горячей ротации без reload/restart.

Основание: Next15 документирует [build-time inlining и dynamic lookup](https://nextjs.org/docs/15/app/guides/environment-variables#bundling-environment-variables-for-the-browser), а `connection()` оставляет чтение серверных переменных на runtime. Не используется несовместимый со standalone `runtimeConfig`.

Проверено: сборка с **пустым** публичным CAPTCHA key, затем отдельный production Next process с синтетическим runtime key. Настоящий Chromium видит этот ключ в ответе и в аргументе provider render; все21 HTTP/browser проверка успешны, provider/account API изолированы transport fixtures. Это не живая проверка Cloudflare/SMTP/PG и не включение нового аккаунта на VPS. Native1204/1204 и focused21/21; первоначальные private-config/heading/CAPTCHA assertions сохранены, adapters загружают реальный getter. Браузер проверяет mobile/desktop, main-region axe и keyboard; screenshot просмотрен. Это не общий WCAG/нагрузочный допуск.

**CI/source deploy пока не переключаются.** Runtime public settings и упаковка подготовлены ниже; остаются проверка manifest в installer, CI artifact publication и проверка установки/отката актуального готового артефакта. Не отправлять реальные закрытые настройки в builder.

## Остальные публичные настройки

`getPublicRuntimeSetting` принимает только три allowlisted поля: legacy URL, legacy anon key и ключ 2ГИС. RootLayout отдаёт их через React-escaped meta после request boundary. URL/anon meta пусты вне явно выбранного legacy backend; browser SDK сохраняет отдельную проверку backend marker и не создаётся/не переиспользуется в postgres/unknown/missing режиме. Отсутствующий meta не допускает build-env fallback. Service-role key и закрытые настройки не передаются. Legacy совместимость временно нужна действующему сайту, это не отмена решения о полном отказе от Supabase.

Проверено настоящим production Next+Chromium: сборка со stale synthetic SDK URL/key и пустыми CAPTCHA/map keys; отдельный legacy runtime использует другой URL/anon, CAPTCHA и map key. Browser login обращается именно к runtime URL и public anon; транспорт внешнего провайдера заменён fixture, никаких настоящих аккаунтов/писем/платежей нет. PostgreSQL browser suite также сохраняет закрытую legacy границу и private-config assertions. Реальный 2ГИС transport этим сценарием не проверяется, только сериализация ключа и getter.

## Упаковка на доверенном builder

`scripts/package-prebuilt-release.mjs` требует Linux x64/glibc/Node22, полный commit SHA, чистый checkout, совпадение обоих BUILD_ID с commit и точный committed lockfile. `BLIZHNIY_BUILD_COMMIT` задаётся **перед** build; `generateBuildId` проверяет формат. Без этой переменной обычный source deploy использует прежний default ID Next. Основание: [generateBuildId Next15](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/generateBuildId).

В архив входят standalone, public/static, PM2 config, CAPTCHA preflight и committed lockfile. `.env*`, `.pem`/`.key`/`.crt` отфильтровываются на любой глубине; symlink/special files запрещены. Manifest содержит commit/build ID, SHA256 lockfile и сведения Node/platform/arch/glibc, но не переменные окружения. Архив публикуется исключительно в новый файл вне checkout; существующий файл не перезаписывается. Удаляются только собственные временные каталоги упаковщика. CLI не устанавливает зависимости, не запускает build и не меняет VPS/БД.

После успешных quality/security gates, на чистом доверенном checkout, сборка и упаковка выполняются без production конфигурации. Пример для builder с Node22 в PATH и новым путём output:

```bash
task_commit="$(git rev-parse HEAD)"
BLIZHNIY_BUILD_COMMIT="$task_commit" npm run build
task_output_dir="$(mktemp -d /tmp/blizhniy-release.XXXXXX)"
node scripts/package-prebuilt-release.mjs "$PWD" "$task_output_dir/release.tar.gz" "$task_commit"
```

Архив и digest передаются по доверенному SSH-каналу. Manifest/BUILD_ID — consistency checks доверенного builder, не независимая криптографическая аттестация происхождения сборки. SHA256 обнаруживает повреждение/подмену относительно доверенного digest, но не аутентифицирует неизвестный источник. Не распаковывать произвольные сторонние архивы: installer предназначен для собственного проверенного builder. `.env*` остаются вне архива; существующие защищённые env файлы копируются deploy-скриптом только на самом VPS. После cutover старого backend нельзя автоматически копировать старые Supabase credentials как настройки новой БД.

На VPS с Node22 в начале PATH оператор передаёт `SOURCE_ARCHIVE`, `SOURCE_ARCHIVE_SHA256`, `COMMIT_SHA`, `PREBUILT_RELEASE=true` и запускает скрипт. PM2 получает точный Node22 interpreter; standalone слушает только 127.0.0.1:3000. Legacy release сохраняет `next start`. Рабочая БД не мигрируется этим скриптом.

## Проверено 10.10.2026

- На VPS отдельно установлен официальный Node22.23.3 в `/opt/blizhniy-node22`; SHA256 Linux x64 архива проверена по официальному HTTPS `nodejs.org/dist/latest-v22.x/SHASUMS256.txt`. `/usr/bin/node`20.20.2 и активный сайт не менялись.
- В `/etc/blizhniy/staging/runtime.json`0600 и каталоге0700 установлен **только runtime**, не migrator/owner. CA находится рядом. Настройки не включены в окружение текущего сайта. Реальное новое соединение с VPS к staging проверило TLS/имя, counts105/7, отсутствие elevated flags, CONNECT к default_db и EXECUTE app/meta.
- Локально: native1030/1030, types/lint без ошибок (прежний warning сохранён), build58 страниц, production-only audit0. Негативные deploy тесты сначала воспроизвели прежнюю установку/сборку, принятие неправильного digest и доступный другим release-каталог, затем прошли; инверсия Node22 условия поймана и восстановлена.
- Пакет71 МБ передан на VPS и SHA256 повторно проверена. Изолированный loopback-процесс на3001 прошёл настоящий native Sharp и health/ready, RSS около165 МиБ, затем завершён. Копия в `/var/www/blizhniy-prebuilt-rehearsal` сохраняется как известный проверенный пакет; это не второй постоянно работающий сайт. Его env остаётся закрытым0700/0600.
- Readiness этого пакета всё ещё зависит от **старого Supabase backend**. Проверка не доказывает готовность новой авторизации, публикаций, фото или платежей. Публичный сайт не переключён, исходная основная БД не менялась. Новая DB connectivity и проверка приложения — разные доказательства, не end-to-end нового backend.

L21 остаётся открыт: CI ещё не публикует standalone artifact и source deploy остаётся текущим автоматическим путём. Runtime public settings и упаковщик подготовлены; перед заменой нужны manifest validation в installer, проверка настоящего CI artifact и deployment/rollback rehearsal. Новый PostgreSQL контур отдельно требует предметного E2E. Нельзя считать локальный production-only audit заменой всех обязательных release scanners.
