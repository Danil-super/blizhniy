# Atomic fulfillment: server integration, not deploy-ready

The original SQL checkpoint added database invariants and isolated PostgreSQL17
tests. The follow-up now integrates server checkout duration snapshots, verified
financial persistence, the service-only RPC, confirm/webhook, and cabinet listing
sync. It removes legacy payment dispatchers and browser-return success shortcuts.
Expiry readers, marquee queue activation, refunds/reconciliation and operational
manual-review UX remain separate prerequisites. Passing this slice is not a
claim that all payment findings are resolved. Do not deploy independently of
the prerequisites below.

## План публикации: 2026-10-08, ещё не выполнен

Кандидат с прикладными исправлениями — `d7bcd61` в
`fix/security-recovery-20261007`, 41 коммит после `c5d451c`.
Основная рабочая папка переключена на эту ветку; локальный и GitHub `main`
остаются на `c5d451c`. Пуш в `main` запускает production Deploy. Его архив
исключает `supabase/migrations`, а workflow не применяет SQL: пуш не является
обновлением схемы БД. Этот план не разрешает production DDL, backfill, списания
или автоматический возврат средств.

### Что проверено только чтением

В Supabase `jzdhpphcelljmjfwrxfi` последняя зарегистрированная миграция —
`20261006164738_harden_yookassa_payment_idempotency`; соответствующий локальный
файл имеет версию `20261006163000`. У старых локальных файлов также повторяются
восьмизначные даты, тогда как история сервера содержит другие полные timestamps.
Не запускать общий `supabase db push` и не исправлять историю вслепую: сначала
сопоставить уже применённые изменения по содержимому и фактической схеме.
Это соответствует [правилам истории миграций Supabase](https://supabase.com/docs/guides/deployment/database-migrations).

Шесть новых миграций не зарегистрированы. В фактической схеме отсутствуют
`payments.purchased_duration_days`, `fulfillment_status`, `fulfillment_reason`,
`work_requests.is_paid`, `work_requests.expires_at`, `notifications.payment_id`,
новые fulfillment/queue/restore RPC, таблица `private.payment_checkout_intents`
и оба checkout RPC. Есть прежние `paid_at` и `target_applied_at`.

Агрегатный снимок: 57 платежей, из них 55 со **сохранённым** статусом
`succeeded`; это не новая проверка у провайдера. Ни у одного платежа нет
`target_applied_at`; один `created`/`pending` платёж не имеет provider ID.
У settled записей нет NULL `paid_at`. Заказов 7, опубликованных и архивных — 0.
Сроки покупки, привязки и уже исполненные услуги остаются предметом отдельной
сверки; эти числа не разрешают массовое исправление старых записей.
Рабочая БД — PostgreSQL 17.6 (`btree_gist` 1.7, `pgcrypto` 1.3), тогда как
сохранённые изолированные PG-проверки выполнены на 17.11. Проверка на стенде
с фактической схемой и данными нужна до production.

### Порядок продвижения

1. Сопоставить историю миграций с фактической схемой и зафиксировать способ
   применения **только** новых изменений с учётом версий. Не переисполнять
   исторические SQL и не помечать непроверенные изменения как applied.
   Снять резервную копию схемы/данных и проверить восстановление на изолированном
   стенде; согласовать короткое окно без новых checkout и конкурентных settlement.
2. На стенде разобрать существующие платежи и публикации: доказуемые сроки,
   владелец/цель, исполнение услуги, незавершённый checkout. Не подставлять
   сегодняшний день или текущий тариф, не выдавать новые оплаченные окна,
   не сбрасывать `blocked` и не оформлять автоматические возвраты.
3. Проверить шесть SQL в следующем порядке, сохраняя исходные файлы и SHA:

   | № | Миграция | Назначение |
   | --- | --- | --- |
   | 1 | `20261007150000_preserve_payment_settlement_state.sql` | Защита сохранённого финансового состояния |
   | 2 | `20261007180000_apply_payment_fulfillment_atomically.sql` | Атомарное исполнение оплаты, сроки и уведомления |
   | 3 | `20261007193251_atomic_ad_marquee_queue.sql` | Очередь и модерация бегущей строки |
   | 4 | `20261007194452_restore_work_request_within_paid_window.sql` | Восстановление заказа в прежнем оплаченном окне |
   | 5 | `20261008062202_snapshot_yookassa_checkout_intents.sql` | Приватный неизменяемый checkout и безопасный повтор |
   | 6 | `20261008063110_restore_listing_and_vacancy_within_paid_window.sql` | Восстановление объявления и вакансии без продления срока |

   Не считать весь набор одной транзакцией без проверки способа исполнения:
   файл очереди содержит собственные `BEGIN`/`COMMIT`. Первая миграция имеет
   промежуточный settlement guard, заменяемый второй; трафик не должен увидеть
   этот промежуточный контракт. Не вызывать mutating RPC как «проверку» production.
4. Проверить ограничения, RLS, отсутствие доступа anon/authenticated к новым
   RPC/checkout PII, права service role и обновление схемы PostgREST. Выполнить
   сценарии успешной/отменённой оплаты, потерянного ответа, повтора уведомления,
   смены пользователя и истечения срока на изолированном TEST-магазине.
5. После проверки стенда и **отдельного подтверждения production-операций**
   сделать свежий backup, применить согласованные миграции и сверить реальные
   версии/схему. Только затем fast-forward `main`, пуш и наблюдение за CI/Deploy.
   Проверить сайт, отсутствие утечек контактов, кабинет и платёжные исходы.
6. При сбое остановить новые платежи и проверить durable truth. Откат приложения
   не равен откату схемы: совместимость старого кода с новыми guards/RPC и
   восстановление БД должны быть проверены на стенде заранее. Не удалять новые
   финансовые записи и не откатывать working DB к backup после новых оплат
   без отдельного согласованного разбора.

Дополнительные открытые gates: реальная настройка уведомлений изолированного
TEST-магазина ещё не подтверждена; причины ранее отменённых RSC-запросов
не установлены; полный dev/build dependency audit не зелёный
(см. [ограничения зависимостей](dependency-security.md)). Подготовленный план,
локальные тесты и успешная сборка не закрывают эти проверки и не означают
разрешение на production-публикацию.

## Preconditions for a later rollout

1. Server checkout creation must persist `payments.purchased_duration_days`
   from the purchased offer, before calling the provider. The snapshot is an
   integer from 1 through 365 for listing, vacancy, workRequest and ad_marquee;
   application and fair_application do not require a duration. Do not accept
   owner, duration, or target substitutions from an untrusted settlement body.
   A once-set duration cannot be changed by an ordinary update.
2. Fetch and validate the YooKassa payment **outside** the RPC transaction:
   provider ID, genuine succeeded state, amount/currency and the stored payment
   association. Persist genuine financial success in its own committed short
   operation with the verified settlement timestamp. The RPC deliberately does
   not fetch a provider or turn a pending financial payment into succeeded.
   Existing trusted `paid_at` wins; otherwise use only the validated optional
   provider `captured_at`. Missing capture stays NULL even on a first financial
   success; neither the SQL trigger nor TypeScript fills arrival time or
   `created_at`. PostgreSQL's returned timestamp precision is authoritative.
3. Audit legacy pending/succeeded rows before their first fulfillment. Duration
   and settlement time are nullable historical unknowns, not current tariff
   lookups. A duration may be established from an existing paid window, or an
   explicitly audited historic offer (for example the historic 30-day
   publication or 7-day marquee offer), with a known historical settlement
   anchor. Document the evidence and reconcile before first fulfillment; never
   derive a new window from today. This migration performs **no automatic
   backfill** and grants no old work request a paid flag or expiry window.
4. Unknown duration or `paid_at` causes sticky `blocked`, not publication.
   Ordinary PATCH/replay cannot reset it. Establishing a previously NULL
   duration does not reset a blocked outcome. Historical NULL settlement times
   on already-succeeded/refunded rows are preserved by the guard. Any repair
   after blocking needs a separately reviewed, explicitly controlled admin
   operation or migration with audit evidence; this runbook does not authorize
   bypassing the guard, disabling triggers, or automatically retrying a reset.
5. Integrate all six supported target paths and their read/expiry behavior, and
   implement marquee queue activation separately. Queue code must honor the
   persisted purchased duration and existing start/end dates. Do not acquire
   queue locks inside settlement. The mock/demo path requires a separate
   explicit implementation; this RPC accepts YooKassa only. Stored mock
   settlement fails safely before financial success or target writes. Only the
   explicit nonproduction, storage-free in-memory demo creates synthetic dates
   and markers. Real and development test-shop browser returns both require
   the authoritative provider GET; the old argument is ignored, not settlement
   evidence. The admin-only free fair waiver on a just-created owned target is
   a separate authorized workflow, not a successful payment.
6. Review migration ordering, privileges, historical data and application
   notifications against the deployment schema. Exercise integration and
   operational manual-review handling before rollout. No production SQL or
   deployment is performed by the test command below.

## Server outcome and retry contract

`Payment` exposes the original full `createdAt`, nullable purchased duration,
fulfillmentStatus and a bounded optional fulfillmentReason. Unknown outcome is
pending, never published. Verified financial success commits before the RPC;
the financial PATCH never supplies a fulfillment marker. The returned database
state, including refunded, historical NULL and sticky blocked, wins over a
stale process snapshot. In-process coalescing is only an optimization; independent
workers depend on the database lock and immutable marker.

Only successful **and applied** outcomes can return the RPC's actual nextStatus.
Early returns/replays or a reread of only payment metadata cannot assert a current
target status. Blocked/pending successes never report publication or a failed
charge. A failed RPC attempts a read of durable truth (its response may have
been lost after commit); otherwise success remains pending. The webhook returns
503 for unresolved success so the genuine provider retries, but acknowledges
durable applied/blocked with200. Financial-save errors never invoke fulfillment.
The service-only call supplies only persisted payment ID and expected provider
ID, never HTTP owner/target/duration/time. Cabinet sync uses that same verified
path for unsettled Yoo payments and skips applied/blocked outcomes.

The pure server `validatePaymentCreationPrerequisites({customerEmail})` export
checks existing provider/merchant/receipt requirements without store/fetch/tariff
or charge side effects. A separate route slice must call it before saving an
unpaid checkout target; draft, already-paid and admin-waiver paths are preserved.
No vendor parsing, transport budget or original-amount rules are relaxed here.

## RPC contract

Call `public.apply_payment_fulfillment(uuid, text)` with only the internal
payment ID and its expected persisted YooKassa provider payment ID. The RPC is
`VOLATILE SECURITY INVOKER` with an empty `search_path`, and EXECUTE is revoked
from PUBLIC, anon and authenticated and granted only to service_role. Keep the
service bearer on the server. Provider mismatch raises SQLSTATE `22023`;
unknown payment raises `P0002`. Neither error publishes a target.

The one-row result contains:

| Field | Meaning |
| --- | --- |
| `payment_id` | Locked internal payment ID |
| `financial_status` | Persisted payment status; never fabricated by fulfillment |
| `fulfillment_status` | `pending`, `applied`, or sticky `blocked` |
| `fulfillment_reason` | NULL unless blocked; bounded code, not a raw exception |
| `paid_at` | Original persisted financial settlement anchor; legacy NULL stays NULL |
| `target_applied_at` | Immutable fulfillment marker, including historical markers |
| `applied_now` | True only for a target applied in this transaction |
| `target_status` | Locked target status when inspected; nullable on early return/replay |

`blocked` is a **separate fulfillment outcome**, not payment failed/refunded,
and is **not grounds for an automatic refund**. A genuine succeeded payment
with a missing, foreign, terminal or expired target remains financially
succeeded for manual review. Repeated calls do not republish or grant a new
period. A historical `target_applied_at` prevents every target write, even a
no-op write, and may only normalize its fulfillment metadata to applied.

Blocked reasons are `payment_owner_missing`, `unsupported_target_type`,
`payment_missing_paid_at`, `duration_missing`, `target_missing`,
`target_owner_mismatch`, `target_not_eligible`, `entitlement_expired`,
`parent_missing`, `parent_not_eligible`, and `target_changed`. Unsupported
specialist fulfillment is intentionally fail-closed. Financial states other
than succeeded grant nothing and retain their existing fulfillment outcome.

## Transaction and target invariants

Lock order is payment FOR UPDATE, then the actual target FOR UPDATE. Owner
identity comes from locked `payments.user_id`, never caller-supplied owner
data. Listing/vacancy/workRequest must belong to that owner, be unpaid and
strictly `pending_payment`; publication dates anchor to `paid_at`, and expiry
is `paid_at + purchased_duration_days * 24 hours`. An already elapsed window
is blocked. No current tariff read or today-based renewal occurs.

Fair applications must match the payment owner, remain pending_payment and
not be financially succeeded/refunded. Marquee placements additionally need
moderation approval and an empty/matching payment binding; only paid status,
the original paid_at, payment binding and updated_at are set. Starts/ends and
queue state are untouched, including on an already-applied active placement.

Applications read the tentative relation, lock the parent FOR SHARE before
the application FOR UPDATE, then recheck owner, relation and eligible state.
This follows the parent-before-child direction of FK CASCADE deletion. The
parent must be published, paid and have a non-NULL live expiry; eligibility
uses `clock_timestamp()` **after** the row locks, not transaction-start time.
Its locked author must differ from the applicant/payment owner, preserving
the existing self-response prohibition in
`ensureVacancyCanReceiveApplication` / `ensureWorkRequestCanReceiveApplication`.
This is rechecked even if ownership changed after checkout; a self-response
is `blocked` with `parent_not_eligible`, not a new charge or refund.
The existing `application_paid` event, Russian subject/body and employer
recipient are inserted in the same transaction. A nullable notification
`payment_id` plus a partial UNIQUE `(payment_id, event)` key provides durable
deduplication; unrelated legacy notifications are unchanged. Notification
insertion errors are not swallowed: target, notice, marker and outcome all
roll back, while independently committed financial success remains intact.

Every conditional target UPDATE checks an immediate `ROW_COUNT = 1`; a
suppressed/zero-row target write becomes `blocked` with `target_changed`
before a notice or marker can be written. Notification INSERT also requires
one actual row; suppression raises a bounded error (SQLSTATE `40001`) and
rolls the transaction back. Payment marker/outcome UPDATEs use
`RETURNING ... INTO STRICT`: a suppressed metadata write raises `P0002`
and rolls back any target/notice mutation rather than committing an unmarked
target or returning a NULL result. Do not interpret `P0002` alone as proof
that a payment was never found; distinguish the explicit `Payment not found`
case from an unexpected metadata write failure. A PostgreSQL BEFORE trigger
returning NULL can legally suppress a write without raising an error, so a
row lock alone is not proof of an affected row. No such suppressing paid-target
trigger was found in the existing repository; this is contract hardening,
tested with synthetic triggers, not a claim of a deployed suppression exploit.

The migration extends the existing private monotonic UPDATE guard rather
than creating a competing trigger. It preserves succeeded/refunded financial
state, once-known paid_at and duration, historical markers and terminal
fulfillment outcomes. A first pending-to-succeeded financial transition may
record an explicitly verified timestamp, not statement/arrival time. A missing
first-success anchor stays NULL, as do metadata updates of an already-settled
historical NULL.

## Synthetic backend verification

The real transpiled-source adapter tests run store, provider, routes, tariffs,
and target modules with only REST/provider HTTP/auth/framework boundaries
replaced. They cover the six server snapshots and RPC targets, deferred
financial commit, refund/sticky NULL/blocked truth, lost/outage RPC responses,
webhook retry versus terminal ACK, confirm/cabinet bypass removal, verified
development returns, and the distinct admin waiver/in-memory demo controls.
The adapter fake is not evidence of SQL locking: those guarantees use the
separate real PostgreSQL suite below.

```sh
node --test --test-reporter=spec tests/payment-fulfillment-server.test.mjs tests/payment-settlement-timestamp.test.cjs tests/payment-confirm-route-binding.test.mjs
node --test --test-reporter=spec tests/payment-provider-boundary.test.cjs tests/payment-confirmation-security.test.cjs tests/payment-receipt-route-email.test.cjs
```

Backend checkpoint: 35 adapter tests plus9 timestamp/route regressions, and181
inherited boundary/receipt tests pass. The real PostgreSQL follow-up passes57
tests, including explicit capture-date preservation and first-success NULL.
RED demonstrated the original dispatcher/date/snapshot behavior and two
browser-return pending/failed overrides; the new real-PG NULL test failed on
the previous first-success `statement_timestamp()` fill. Actual on-disk source
mutation experiments killed capture-to-today, webhook503-to200, omitted four
duration snapshots (application/fair controls stayed green), omitted financial
await with a deferred response, and SQL first-success-now mutations. All source
was restored before final verification. No production credentials, database,
provider requests, migrations, commits or deployment are part of these tests.

## Isolated real PostgreSQL tests

Prerequisites: Node supporting `node:test`, Docker, and an already-cached
`postgres:17-alpine` image. Tests use `--pull never --network none`, no port
mapping, an in-container Unix socket, a tmpfs database, a read-only worktree
mount and synthetic users only. They do not read `.env` or contact Supabase,
Auth, YooKassa, or another database. The fixture uses the real schema and the
real marquee/idempotency/settlement/client-grant prerequisite migrations;
only the unavailable Auth role infrastructure is synthetic.

From this worktree:

```sh
node --test --test-reporter=spec tests/payment-fulfillment-postgres.mjs
```

The runner owns only container
`blizhniy-fulfillment-pg17-worker-20261007` and database
`blizhniy_fulfillment_fixture`. A pre-existing name collision fails without
removing that container. Cleanup checks the ownership label before removing
the created synthetic tmpfs fixture; no other containers are inspected or
modified. If an externally killed runner leaves its container behind, confirm
that exact name and ownership label before requesting/removing that disposable
fixture. Do not use broad container cleanup commands.

Tests execute real RPC statements as service_role, exercise real permission
denials as anon/authenticated, and use independent PostgreSQL connections and
actual lock barriers (not mocked REST responses or timing sleeps). Controls
cover all six targets, owner/moderation/parent-delete/relation races, stale
snapshots, separate payments for one target, bounded outcomes, expiry,
historical migration observations, legacy markers, sticky blocked states,
exactly-once notification semantics and forced backend-crash rollback.
The review regressions additionally cover self-response for both parent
kinds, parent ownership changed under an actual competing lock, stable
distinct-parent controls, silent suppression of all six target updates,
all three marker/outcome update branches and notification insertion. A nested
runner also verifies that a container-name collision fails without deleting
or changing the existing owned fixture.

For the reproducible **expected-failure** pre-migration contract check:

```sh
BLIZHNIY_FULFILLMENT_BASELINE=1 node --test --test-name-pattern='RPC is invoker-only|applies exactly once' --test-reporter=spec tests/payment-fulfillment-postgres.mjs
```

This skips the new migration and demonstrates the missing atomic RPC for
seven selected contract cases. It does not purport to execute the old
TypeScript provider workflow. The separate normal Node test suite does not
automatically run this Docker-dependent opt-in file.

### Reviewed verification snapshot (2026-10-07)

- Actual cached PostgreSQL 17.11, image
  `sha256:1bea307dfb3ee30541a7acf7de14b58bcd6948da98e5d31a04c627c4d35ec64b`:
  the final explicit PostgreSQL command above passed **56/56**, no skips.
- Pre-migration contract RED: seven selected missing-RPC failures. Review RED
  against the first RPC implementation: 12 failures (four self-response,
  six silent target UPDATEs, one metadata UPDATE, one notice INSERT), with
  two stable distinct-parent controls passing before the fixes.
- Actual SQL mutation experiments detected missing fair owner checks,
  missing initial payment lock and a stale pre-lock clock. Review mutation
  removing the self-response check produced four failures while both
  distinct-parent controls passed; removing the application affected-row
  check produced one failure while ordinary application fulfillment passed.
  Every mutation was restored before the final GREEN run.
- The normal read-only Docker Node22 offline suite passed **200/200**;
  `npm run lint` and `node node_modules/typescript/bin/tsc --noEmit --incremental false`
  exited zero. No TypeScript/UI/provider source was changed in this SQL slice.

These counts attest to this isolated contract and repository regression
suite, not production deployment, provider integration, or closure of every
payment/security finding. The dedicated synthetic tmpfs container was
removed after each completed run; the checked-in fixture can reproduce it.

## Design references

The privilege/search-path design follows [Supabase database functions](https://supabase.com/docs/guides/database/functions).
The lock behavior and ordering follow [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html).
Typed RPC arguments/results and schema reload follow [PostgREST functions](https://docs.postgrest.org/en/stable/references/api/functions.html).
Affected-row checks follow [PostgreSQL 17 PL/pgSQL result status](https://www.postgresql.org/docs/17/plpgsql-statements.html#PLPGSQL-STATEMENTS-DIAGNOSTICS),
including [BEFORE-trigger write suppression](https://www.postgresql.org/docs/17/plpgsql-trigger.html).
