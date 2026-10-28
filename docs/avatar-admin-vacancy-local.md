# Локальная проверка: аватар, админка, вакансия — 21.10.2026

Область: https://127.0.0.1:3045, собственный PostgreSQL18 и только синтетические
аккаунты/фото/письма. Нет push/deploy, production SQL, новых ACL, внешнего SMTP
или реальных платежей. Ручное внешнее финансовое ревью предыдущего этапа не
считается выполненным и остаётся условием отдельного решения о rollout.

## Исправления

- Выбор аватара регистрируется в owner-scoped памяти до FileReader/decode.
  Временная проверка сессии скрывает UI, но не теряет выбор; logout/другой
  пользователь/отмена/новый выбор инвалидируют старое async-завершение.
  Ошибка декодирования видима. Прежние unknown-write/revision guards сохранены.
- Админский список — отдельная keyboard-scroll область до65vh. «Подробнее»
  ведёт на `/admin/obyavleniya/[id]`; полная форма, все фото и обязательная
  причина блокировки. Существующая атомарная запись уведомления и локального
  письма не изменена. Нижние повторные ссылки разделов удалены, верхние11 есть.
- Локальная вакансия: выбор работодателя сразу раскрывает реквизиты и контакты;
  «Продолжить к вакансии» проверяет их. Оба шага и три варианта работодателя
  остаются mounted, поэтому возврат не стирает ввод/фото. Сохранённая форма
  открывается с реквизитов. Профессия — обычный доступный native select.
- Purchase validator отдельно от partial draft parser: ИНН10/12 с checksum,
  ОГРН13/ОГРНИП15 при наличии, имя/контакт/телефон/email/http(s), зарплата
  положительна при заполнении. Частное лицо не требует ИНН/мессенджер.
- Выявленная браузером ошибка суммы исправлена: canonical `45000.00` нельзя
  передавать digits-only маске. Отдельное decimal поле сохраняет и копейки,
  в том числе при повторном открытии черновика вакансии/заказа.

## Локальная оплата вакансии

Reuse orders/intents/dispatch/verification/immutable fulfillment receipt;
targetType выбирается только серверным enum, не строкой запроса. Конструкторы
vacancy разрешены только в строго проверенном локальном TEST-режиме.
`/api/account/vacancy-checkout` обслуживает исключительно local proxy; отдельной
production route нет. Страница `/oplata/[id]?type=vacancy` разделяет чтение и
dispatch от listing-заказа. Неизвестный результат prepare требует readback
исходного ключа, автоматического второго заказа нет.

Runtime может только подготовить intent; is_paid/status/dates меняет доверенный
симулятор после authoritative fake-provider capture. Он удерживает owner,
intent/order, work и SHARE города/профессии/media до commit; проверяет revision,
канонические названия, активность и все сохранённые фото. Исторический receipt
не продлевает срок и не повторяет UPDATE при replay. Default production и
workRequest сохраняют старое approval-требование. Локальная публичная vacancy
требует точный binding receipt/dates/revision/owner, succeeded order и TEST
merchant; refund скрывает из каталога и public photo endpoint. Решение
модератора не фабрикуется. Для откликов прокинут тот же local eligibility policy.

## Доказательства

- `check-local-avatar-preparation-ui.mjs`: до фикса actual-browser RED с
  задержанным чтением во время focus recheck; после — тот же выбор и Apply200.
  SVG, EXIF orientation6 JPEG, PNG4608×3456, broken-file error; pageerrors0.
- `check-local-admin-detail-ui.mjs`: native keyboard и4ширины, отдельный
  URL/reload,9фото с pixel checks, обязательная причина, lost-write/readback,
  скрытие на recheck/смене аккаунта, уведомление+локальное письмо,11вкладок.
- `check-local-vacancy-payments.mjs`:7групп настоящего PostgreSQL18, запросы
  prepare под `blizhniy_runtime`, все fixtures rollback. Три типа, partial и
  invalid поля, type/key/owner isolation, pending/cancel, capture/replay/refund,
  rename/deactivation, edit/delete послеdispatch с durable capture без публикации.
- `vacancy-checkout-validation`, `vacancy-checkout-isolation`, `work-amount-field`
  focused тесты. In-memory мутация инвертированной проверки ИНН убита suite;
  исходные файлы при этом не изменялись. Существующие assertions не ослаблены.
- Первый независимый разбор выявил refund/reference locking/name matching;
  второй — ожидаемый stale target послеcapture, превращавшийся в503. Все
  замечания приняты и исправлены с отрицательными проверками. Дополнительная
  модель предложена владельцу, внешняя CLI не запускалась.

Финальный `check-local-vacancy-ui.mjs` прошёл на обновлённой сборке: организация,
ИП и частное лицо; checksum-ошибки до перехода, возврат/смена типа без потери
ввода и фото; все поля в сохранённом snapshot; person draft reopen сохраняет
`45000.50`; public detail, каталог и реальный public photo200 после capture.
320/768/1440px без overflow, scoped axe serious/critical0, pageerrors0. Потеря
сети ДО prepare: явный readback=null, повторная кнопка доступна и использует
прежний creationKey; сохранение черновика не подменяет зафиксированное действие
оплаты. Действия вынесены за frozen fieldset, чтобы после readback не застревать.

Общий итог: native1764/1764, `check:fast` (floor/types/lint), production build
и `git diff --check` прошли. Одно прежнее lint warning
`tests/checkout-prerequisites.test.cjs:30` не скрыто. Listing payment regression:
три группы PG прошли без изменения его поведения. Graphify code-only и Code
Graph обновлены; Graphify MCP отсутствует, использован CLI правильного корня,
SQL-граф неполон и не подменяет реальные PostgreSQL-проверки. Стенд3045 оставлен
доступным с синтетическими тестовыми публикациями для ручной проверки.
Дополнительно прежний `tests/work-publication-browser.mjs`:7/7, включая
default premoderation, потерю ответа и смену владельца. Его assertions сохранены.
