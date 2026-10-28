# Два ряда карточек и оплата заказа — локальная проверка

23.10.2026. Только изолированный стенд https://127.0.0.1:3045/__local,
синтетические данные и локальный симулятор. Production, SSH, рабочая БД,
DDL/ACL, LIVE, реальные merchant-запросы и списания не менялись.

## Интерфейс

- Объявления/вакансии/заказы: область ограничена двумя полными рядами
  карточек. Высота измеряется по реальному размеру строки, gap и padding,
  пересчитывается при изменении ширины/контента. При числе карточек меньше
  двух рядов пустая высота не добавляется. До измерения действует прежний
  SSR fallback65vh; измеренная inline-высота имеет приоритет.
- Кнопки «Следующая страница» нет. Cursor-страницы по20 записей добавляются
  при достижении конца прокрутки, без замены предыдущих карточек и дублей.
  Это не единовременная загрузка всей БД. Pending ref ограничивает параллельные
  запросы; ошибка приостанавливает автоподгрузку до явного retry. Retry
  повторяет именно неудачную операцию, а не случайный следующий cursor.
- У вакансий в списке нет Details, в том числе у заголовка. «Редактировать»
  ведёт к исходной форме; «Посмотреть» доступно для published. Существующий
  компонент карточки сохранил опциональный Details для других потребителей.
- В заказе используется общий поисковый ProfessionSelect с клавиатурой и
  валидацией выбора. Внизу — «Сохранить черновик» и «Оплатить»; заполненный
  заказ и фото сохраняются до перехода на страницу исходной оплаты.

## Локальная оплата

Существующие session/checkout/dispatch/verification/fulfillment переиспользованы
для `workRequest`, тариф `work-request-publication`, action
`work_request_publication`, return `?type=workRequest`. Endpoint
`/api/account/work-request-checkout` обслуживается только локальным proxy;
production route не добавлен. Допуск требует validated local mode и TEST.
Схема уже поддерживает этот targetType; новые права не потребовались.

До первого capture действуют точные owner/type/revision, согласованные
tariff/amount/duration и валидация полей/ссылок/фото. Pending/cancel не публикуют.
При неизвестном prepare сначала явный readback, без нового платежа.
После capture публикация и immutable receipt фиксируются один раз.

Независимая проверка обнаружила, что последующая правка оплаченного материала
могла скрыть его из-за revision mismatch. Исправлено для локальных work kinds:
после первого fulfillment последующие валидные ревизии используют прежний
подтверждённый срок, без изменения заказа/чека/оплаты/status/дат. Public gate
сопоставляет owner/type/период receipt, succeeded order, текущие действующие
справочники и поля; refund скрывает и отредактированную публикацию. Runtime
проверяет полноту paid edits, но не получает дополнительных UPDATE/lock-прав
на справочники. До первого capture проверка revision остаётся строгой.

## Доказательства

- Native **1818/1818**, fail0/skipped0.
- `check:fast` после сборки: floor/types/lint успешно; прежнее lint warning
  `checkout-prerequisites.test.cjs:30 targetType` сохранено. Один промежуточный
  запуск tsc пересёкся с перегенерацией `.next/types`; после завершения build
  повторная проверка прошла без изменения tsconfig или подавлений.
- Build Next15.5.27 успешен. Новых dependencies нет.
- Новые8 scroll-регрессий сначала воспроизвели старое поведение. Инверсия
  error-условия подгрузки даёт4 ожидаемых падения; после восстановления8/8.
- Новые2 form-регрессии сначала показали datalist/отсутствие Pay у заказа,
  теперь проходят. Isolation2/2 доказывает local TEST-only/default-off/LIVE ban.
- `scripts/check-local-two-row-cabinet-ui.mjs`: настоящий Chromium, реальные
  synthetic cookie-auth и controlled owner DTO. Для всех3 типов20→39 уникальных
  карточек (с перекрытием страниц), два ряда на320/768/1024/1440 с погрешностью
  ≤2px, wheel/PageDown, next503→сохранённые20→явный retry→39, без автоповторов,
  потери позиции и лишних кнопок. Axe serious/critical0 в проверенных списках,
  pageerrors0. Скриншоты desktop/mobile просмотрены. Смена аккаунта этим
  browser runner не проверялась; прежние native session/private-card проверки
  сохранены и проходят.
- `scripts/check-local-work-request-ui.mjs`: реальная исходная форма, dropdown
  и native validity, все сохранённые поля/фото, повторное открытие, потеря уже
  committed prepare-ответа→readback без дубля, локальный capture→публичная
  страница с фото, paid edit→сохранение публичной видимости. Ширины320–1440,
  axe serious/critical0, pageerrors0, никаких реальных платежей.
- `scripts/check-local-work-request-payments.mjs`: **13** групп проверок на
  собственной PostgreSQL18 с restricted runtime и rollback fixtures. В том
  числе ownership/cross-kind, immutable replay, refund, stale/deleted draft,
  disabled/renamed references, изменённый тариф до/после dispatch,
  blocked/unverified user, paid edits и атомарный отказ для невалидных правок.
  Независимый инженерный review и повторный запуск прошли без оставшихся
  блокирующих замечаний в проверенном локальном контуре.
- Прежний `scripts/check-local-vacancy-payments.mjs`: **7** групп проходят.

Существующие assertions/guard не ослаблены. Native harness адаптирован к
новому импортируемому viewport и scroll callback вместо удалённого Next;
проверки privacy/session/состояний сохранены. Старые ad-hoc browser scripts,
ожидающие Next/Details, не объявляются проходящими: новые runner проверяют
заменённый процесс отдельно. Ранее подготовленный diff старого offline-теста
по-прежнему только для просмотра, guard не изменён.

Graphify обновлён code-only с прежними исключениями; Code Graph обновлён.
Это не полный WCAG/security/performance аудит, не закрытие отложенного
внешнего финансового ревью и не завершение всего production-переноса.
