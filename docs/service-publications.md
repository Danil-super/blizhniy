# Специалисты, ярмарка и реклама: следующий этап переноса

18.10.2026. Подготовленный локальный инкремент L13/L14, не заявление о доступности этих функций на рабочем сайте. Миграция0017 ещё не применена; отдельное разрешение владельца на schema/grants запрошено. Рабочие страницы пока не подключаются к отсутствующим таблицам и не объявляют сохранение/оплату успешными. Прежние0016 и все более ранние миграции неизменны.

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

Следующая реализация: owner HTTP/client/UI, revision-bound submit/queue/inspect/decision/photo; публичные каталоги; lifecycle; финансовое исполнение/очередь рекламы. Только после этих частей и проверенного деплоя L13/L14 можно считать подключёнными. Таблицы/приватный repository сами по себе не завершают перенос.
