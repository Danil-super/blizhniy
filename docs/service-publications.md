# Специалисты, ярмарка и реклама: следующий этап переноса

18.10.2026. Инкремент L13/L14, не заявление о завершении всего переноса. Владелец отдельно одобрил0017 и точечные права после проверок. Явный apply выполнил одну миграцию/три таблицы, журнал17, prefix16/SHA сохранён, начальные forms/photos/reviews0. Свежий runtime login прочитал три таблицы и получил42501 на четыре запрещённые операции owner/paid/status/delete. Следующий код подключает owner-формы и модерацию; выкладка и live-проверка фиксируются ниже отдельно. Прежние0016 и все более ранние миграции неизменны.

## Схема и права

Три таблицы `service_publications`, `service_publication_photos`, `service_moderation` хранят три реальные разновидности сервисных материалов с отдельными строгими формами. Анкета специалиста одна на аккаунт, это обеспечено partial unique index; заявки ярмарки и рекламные тексты имеют собственные creation intents. Общими являются только владелец, CAS, фото, модерация, paid/status/window. При старте приложения/деплое DDL и grants не выполняются.

Операторские команды: `bootstrap-postgres.mjs --plan-service-publications | --apply-service-publications HOST:DATABASE`; отдельно `grant-service-publications.mjs --plan | --apply HOST:DATABASE`. Проверяются PostgreSQL18, точная цель и все17 имён/SHA журнала, отсутствие повышенных атрибутов runtime. Предыдущие планы7/10/11/12/13/14/15/16 не расширяются автоматически. Down блокирует потерю любой строки трёх новых таблиц.

Grants: SELECT трёх таблиц; INSERT идентичности/формы/ссылок нового материала; UPDATE только form/references/revision/updated_at; INSERT/DELETE связей фото; INSERT заявки и UPDATE решения модерации. Нет UPDATE owner/paid/status/published/expires, DELETE материалов, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN или grant options. Неожиданные существующие права отказываются, не принимаются/исправляются молча. Потерянный COMMIT не повторяется автоматически.

## Формы и частное хранилище

Specialist: имя/название, профессия, навыки, опыт, описание, точная десятичная цена, город/район/точка/согласие на показ, телефон/email/мессенджер, до12 owner-ready фото, ссылка на видео. Fair: мастерская/ФИО, категория, описание, город/точка, телефон/email, до10 фото, видео и приватный комментарий. Marquee: текст10–140 символов при отправке на модерацию, допустимая http(s)-ссылка без credentials. В черновике допускается неполнота, но не произвольные поля, malformed Unicode, управление, клиентские пути/цены-number/флаги оплаты. Право размещения — явный boolean, не truthiness.

`PostgresServicePublicationStore` проверяет текущую cookie-сессию через общий user→session→resource transaction; expected owner не является авторитетом. Полная форма и ordered photo associations записываются атомарно. При неизвестном результате сначала read-only intent/read, без второго create. Для specialist другой creation intent возвращает существующий профиль, не перезаписывает его. CAS хранит bigint как decimal string, включая значения выше2^53; list20+1 использует microsecond keyset и не выдаёт приватную форму массово. Смена/подделка owner, revoked session, чужие/неготовые фото и неизвестные references отказываются.

Явная public form projection не включает телефон/email/мессенджер, приватный комментарий или неразрешённую точку. Это лишь будущая DTO-граница: public runtime, current-approved/payment/window SQL и фото должны быть подключены отдельно до выдачи данных наружу.

## Проверено и осталось

Локальные contract/plan/CLI6/6; общий native1430/1430 без skips; собственный PostgreSQL18 suite190/190 (schema/grants, реальная ограниченная роль, CAS/concurrency, owner/session, photo rollback, recovery, pagination); build63static pages, types/lint/floor проходят. Одно прежнее checkout lint warning сохранено. Инверсия boolean-проверки согласия вызвала3 отказа; исходник восстановлен и focused suite зелёный. Secrets проверяются перед каждым commit; реальные ключи/аккаунты не входят в fixtures.

## Owner HTTP, формы и модерация

Новые cookie-only маршруты: `/api/account/service-publications`, `/api/account/service-moderation`, `/api/admin/service-moderation`. Kind всегда явный: specialist/fair/marquee. POST читает, PUT изменяет; strict envelopes, Host/Origin/CSRF, trusted ingress, bounded body и общие ограничители. Expected owner/admin сверяется с текущей сессией в SQL, а не является доказательством прав. Массовые списки ограничены20+1 и microsecond cursor; журналы не содержат форм, контактов и токенов.

Клиент проверяет полный ответ и точную строковую revision, ограничивает JSON262144bytes/фото2MiB/время15s; нет Bearer, legacy storage или автоматического write retry. Сохранение загружает фото до атомарной формы. При потерянном ответе — только явный read intent/read; другой результат CAS требует сверки и явного выбора локальных правок. Подтверждённый422 разблокирует исправление формы; неизвестный503 не объявляется отказом записи. Конкурентный отказ модератора возвращает сохранённую редактируемую форму с причиной, не блокирует первоначальную отправку навсегда.

Подключены анкета в кабинете, заявка ярмарки, рекламный текст, кабинет заявок и три kind-specific admin-очереди. Начальная отправка и отдельная отправка сохранённой версии работают через тот же revision-bound review. Модератор видит все поля и по одному приватному фото, может отказать с причиной или одобрить текущую полную версию. Самопроверка запрещена. Авторизация повторно проверяется при каждом запросе; редактирование делает старое решение неактуальным. Одобрение не меняет paid/status/срок и не списывает деньги.

Независимые browser RED выявили размонтирование редакторов старым внешним CabinetAuthGate при503. Новый `CabinetPublicationWorkspace` оставляет primary-панелям собственную owner-scoped границу: во время перепроверки данные hidden/inert и запись запрещена, при том же владельце ввод восстанавливается, при подтверждённой смене аккаунта уничтожается. Legacy-контур продолжает использовать старый gate. Проверены специалист, заявка ярмарки, вакансия и заказ; PUT0 при потере/восстановлении связи.

Текущие native1448/1448, PostgreSQL197/197 без skips; build63, types/lint/floor проходят (старое checkout lint warning сохранено). Клиентская инверсия revision-условия вызвала2 отказа тестов, затем исходник восстановлен и focused10/10. Production-build Chromium: service forms5/5, service admin4/4, offline4/4; формы и админка проверены axe320/768/1440 без serious/critical. Низкий контраст общей подсказки загрузки фото исправлен без исключений в тестах.

Осталось: публичные каталоги и допустимые публичные фото; lifecycle; финансовое исполнение/очередь рекламы и взаимодействия. Только после этих частей и проверенного деплоя L13/L14 можно считать завершёнными. Таблицы, сохранение и модерация сами по себе не завершают перенос. При откате кода сохраняется0017 и накопленные данные; автоматический Down/удаление не выполняются.

## Рабочая установка owner/forms/moderation

Релиз `63d1c8525d72` активен на VPS `/var/www/blizhniy-releases/20261018152311-63d1c8525d72`, проверены health5ms/ready6ms. Actual HTTPS smoke выполнил для specialist/fair/marquee create/replay/read-intent/list, полный update/CAS409, owner submit/read и foreign404; обычная роль получила admin403. Все3 формы сохранились в неоплаченном draft, два собственных синтетических аккаунта удалены cascade без файлов; roleChanges0/paymentCalls0/mediaWrites0. Реальные пользователи/платежи не менялись. Итог всего CI/deploy фиксируется отдельно, не подменяется одним переключением symlink.

Во время source build повторно наблюдались таймауты5s на loopback health/ready; следующая диагностика дала18ms/107ms при build Node RSS519MiB и swap1022MiB. После переключения5ms/6ms. Это повторяемая корреляция со сборкой, не доказанная полная причинность; L21/prebuilt остаётся открытым. Проверки/откат не отключены, SSH/другой бот не менялись.

## Подготовлено публичное чтение

Следующий код читает service-таблицы для каталога специалистов, фильтра профессии, карточки, ярмарки и рекламы главной. SQL допускает только published+paid+текущее approved revision+проверенный незаблокированный автор+действующее окно и актуальные references. При ошибке primary нет старого fallback/выдуманного пустого каталога. Реклама read-only, не активирует очередь и не продлевает срок; максимум5 элементов. Информационные тексты самой платформы при отсутствии рекламы не являются оплаченной рекламой.

Final DTO не копирует owner/контакты/комментарии/неразрешённую точку. Required legacy поля FairApplication phone/email передаются пустыми, не значениями формы. Фото — `/api/service-publications/{id}/photos/{fileId}`: переиспользуется существующая public-photo policy с SQL before/after FS, точной association/revision, bounded WebP/no-store/shared admission4. Ярмарка не преобразует эти URL в старый storage. Client-only admin импортирует общую константу вместимости из безопасного модуля, а не из server storage; существующие queue assertions сохранены, fixtures получили перенесённую константу5.

Проверено native1459/1459, PG202/202, public service Chromium5/5, регрессии account/public work/service owner/admin/offline88/88, build63/types/lint/floor. Инверсия paid-condition поймана3 тестами, исходник восстановлен и focused3/3. Production HTML/RSC/JSON не содержат sentinel-контактов и приватного адреса; карточки/фото гидратируются, истёкшая карточка даёт404. Actual local photo GET с точным Host даётJSON404/MEDIA_NOT_FOUND до FS, query400. Первый Node-fetch test выявил игнорирование пользовательского Host в тестовом транспорте; заменён на bounded node:http без ослабления assertions. Этот публичный инкремент ещё не объявлен установленным до отдельной CI/VPS проверки.

Рабочий public-read релиз `85039fdbc30c` переключён на `/var/www/blizhniy-releases/20261018153906-85039fdbc30c`. Loopback health10ms/ready32ms; реальные HTTPS главная, каталог специалистов, ярмарка и public API отвечают200. API вернул0 допустимых участников, а не подставленные записи; никакие paid/published флаги для проверки не выставлялись. Несуществующее фото через новый production handler вернулоJSON404/MEDIA_NOT_FOUND и no-store. Схема БД остаётся0017; read-only preflight следующего этапа подтвердил TLS/PostgreSQL18/полный SHA prefix17. Заключительные CI/Confirm checks фиксируются отдельно после завершения.

CI39140874740: все validate/security/CodeQL/deploy jobs завершились success, включая post-deploy layout/SEO/headers и Confirm deployed release. Полный перенос этим не завершён: следующий L15 — `docs/interactions.md`,0018 ожидает согласования; финансовый lifecycle/очередь и остальные пункты L17–L25 остаются открытыми.
