# ADR-009: Node22 и отдельные системные identity сайта и decoder

## Статус

Принято владельцем15.10.2026: «Да, подготовить и применить после проверок». Это разрешение на runtime сайта и подготовку изолированной обработки фото на существующем VPS. SSH, другой бот, БД, Auth-mode и включение HTTP upload не меняются.

## Контекст

Рабочий Next-процесс запускается root/Node20, тогда как CI и подготовленные worker используют Node22. Нельзя запускать пользовательский native decoder в root web-процессе или включать local-only supervisor через NODE_ENV=test. Новые VM/услуги для этого не нужны.

## Решение

Корневой PM2 broker остаётся прежним, но только приложение `blizhniy` получает отдельные UID/GID `blizhniy-web` и абсолютный `/opt/blizhniy-node22/bin/node`. Другие процессы не перезапускаются. Системный пользователь без login shell, домашний каталог `/var/lib/blizhniy-web`0700. Code/release остаётся root-owned и недоступен приложению для записи. Env сохраняет те же байты, получает root:blizhniy-web0640; отдельный пустой `.next/cache` принадлежит web0700, прежний build cache перемещается внутри release, а не удаляется и не chown-ится рекурсивно.

Включение — только операторский root0600 `/etc/blizhniy/web-runtime.json` из `ops/web-runtime.json.example`. `scripts/web-runtime.cjs` проверяет защищённые parents, no-follow FD/file owner/mode/nlink/size, точную форму config, actual Node22≥22.18 и отдельную system identity. Ошибка конфигурации не превращается в root fallback. При отсутствии config сохраняется прежний режим; удаление config — отдельная root-операция отката, не доступная приложению. Deploy готовит права **до** замены процесса и сохраняет health/ready/post-deploy rollback. Prebuilt packager включает helper; managed runtime пока требует readable root-managed source release и отказывает на закрытом0700 prebuilt, вместо расширения его прав без отдельной проверки L21.

Decoder proof — отдельный `blizhniy-media` и manual oneshot `blizhniy-media-check.service`, без scheduler и HTTP входа. `NODE_ENV=production`, без Auth/DB/SMTP environment; private network, AF_UNIX only, read-only system, invisible foreign processes, inaccessible secret/web-data paths, no capabilities/privilege escalation/core. Пределы512MiB/no swap/1CPU/32tasks; реальный deadline oneshot задаёт TimeoutStartSec8, не неработающий для oneshot RuntimeMaxSec. CLI читает собственный kernel cgroup и NoNewPrivs/CapEff/CapAmb, затем преобразует только сгенерированное JPEG/EXIF в WebP без metadata. Это доказательство конкретной изоляции на VPS, **не готовый production upload worker**, transport, cleanup или миграция фото.

## Альтернативы

Глобальная смена Node/PM2 затронула бы посторонние процессы. Recursive chown всего release дал бы приложению право менять исполняемый код. Работа decoder под web UID открыла бы ему секреты сайта. Снятие local-only guards или NODE_ENV=test в рабочем сервисе подменило бы ранее проверенную границу.

## Последствия и откат

Перед первым переключением дождаться текущего deploy, сохранить protected rollback metadata, сверить env bytes, выполнить Node22/UID probe на loopback3201 и закрыть его. Затем заменить только `blizhniy`, проверить фактические UID/GID/Groups/interpreter, health/ready/public HTTPS и отсутствие доступа media к env/DB config. `pm2 save` сохраняет конкретный interpreter/identity для reboot. Провал проверки — stop only this app, переместить operator config в protected rollback directory, запустить прежний release/root/Node20, сверить health/ready; данные/БД/SSH не откатываются и не удаляются.

Проверки: native `web-runtime.test.cjs`, `media-sandbox-check.test.mjs`, дополненные deploy-readiness/package-prebuilt tests; реальные Linux permissions/Node22/PM2 identity и systemd cgroup proof проверяются оператором отдельно от fake FS/identity unit fixtures. Нулевой production audit не закрывает прежний полный9 build/dev advisory.

Основание PM2 interpreter: [официальная конфигурация](https://pm2.keymetrics.io/docs/usage/application-declaration/); UID/GID дополнительно проверены в установленном `/usr/lib/node_modules/pm2/lib/God/ForkMode.js` до применения. Systemd unit проверяется настоящим `systemd-analyze verify`, а ограничения — kernel readback, не только текстом шаблона.

## Проверка на VPS15.10.2026

Прежний Node22 bundle сохранил archive UID1000 в bin и executable; operator guard остановил preflight до смены процесса. Весь установленный tree побайтно совпал с официальным `node-v22.23.3-linux-x64.tar.xz`, SHA256 архива `df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de`, SHA256 node `fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48`. После metadata checkpoint владелец5866 entries исправлен на root; tree/bytes не менялись. Это не ослабление root-owned проверки. Дополнительно native fixture явно отказывает archive-owned bin/executable.

Затем actual Next probe на127.0.0.1:3201 под994:985 прошёл health/ready200, env hashes совпали. Основной PM2 `blizhniy` на5466f14 переключён на22.23.3/994:985: `/proc` подтвердил UID/GID/interpreter, отсутствие root supplementary groups и effective capabilities, публичный ready200/TLS verify0. PM2 dump сохранён; private rollback metadata и прежний build cache сохранены. БД, Auth-mode, SSH и другой бот не переключались.

Первый manual media oneshot завершился0 **без** `media_sandbox_check` JSON. Это не засчитано как proof: entrypoint сравнивал canonical import.meta с symlink argv и пропускал исполнение. Сценарий воспроизведён на VPS: symlink CLI exit0 без вывода, physical CLI вне sandbox exit1/unavailable. Исправление канонизирует оба пути; новый subprocess test проверяет symlink также с `--preserve-symlinks-main`. После публикации нужно повторить unit и получить явный `status:ok` из actual child; один systemd Result=success не доказывает проверку cgroup/пикселей.
