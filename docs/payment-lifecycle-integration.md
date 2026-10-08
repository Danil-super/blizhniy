# Isolated combined payment lifecycle verification

This opt-in suite loads the actual schema/RLS and the explicit chronological
16-file dependency manifest in its companion fixture. It does not reconstruct
production migration history or run all Supabase Advisors.

Auth is synthetic: `auth.uid()` reads a fixture-owned session setting, not a
verified Supabase JWT. PostgreSQL functions, grants, RLS, triggers and row locks
are real. The synthetic provider boundary is not a real charge or evidence of
live GoTrue, Supabase/PostgREST, merchant delivery or production readiness.

Normal new payment/target lifecycles never disable protective triggers. Owner
TRUNCATE resets only synthetic rows inside the owned disposable database; it
does not authorize production retention/deletion or any financial repair.

Run explicitly with native Node22:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 /home/danil/.cache/blizhniy-node22-pxyRwP/node --test --test-concurrency=1 --test-reporter=spec tests/payment-lifecycle-integration-postgres.mjs
```

The cached pinned PostgreSQL17 image uses `--pull never --network none`, tmpfs,
a read-only repository mount and Unix sockets, with no exposed ports or env
files. Name collision fails without touching the existing container. Cleanup
targets only the newly created container ID after validating its ownership label.

## Verified scope

The frozen source base is `44fe03dc1030b539bbede5180ba2d2a2c5478fa9`.
The fixture reads repository SQL directly, including both raw-location SELECT
revocations. The runner verifies chronological manifest order and the reviewed
checkout migration SHA-256 before creating a container. That artifact check is
not itself behavioral proof of checkout security.

The combined PostgreSQL suite passes 69/69 tests, with no failure, cancellation
or skip. Its independently verified thin groups cover:

- Exact committed intent bytes/hash/time, provider-ID adoption, separately
  committed financial success and actual fulfillment/replay for listing,
  vacancy, work request, fair application, marquee and both application parents.
- All eight public RPCs: actual browser permission denial, service positive
  calls, SECURITY INVOKER and empty search_path after all reviewed blocks load.
- Real payment RLS with synthetic session identities: own financial SELECT,
  denied other-owner rows, private receipt-ledger denial, unchanged browser
  SELECT contract, and denied raw contacts/location reads on five protected
  tables. This is not a test of live JWT verification or all application DTOs.
- Seven full actual provider/store module graphs. Only REST wire translation,
  synthetic vendor response and external clock/timer boundaries are adapted;
  real PostgreSQL handles persistence/RPCs. Each POST sees a committed private
  intent from another connection. Actual verification preserves microsecond
  capture timestamps, original purchase terms, durable marker and safe payment
  DTOs without receipt/email/merchant snapshot PII.
- Immutable input freeze alongside the existing monotonic settlement guard;
  unknown capture/duration, elapsed captured window, changed owner, moderation,
  deletion and unsupported specialist remain sticky-blocked without inventing
  publication or financial failure.
- Original expiry preservation, listing/vacancy published_at refresh and work
  published_at preservation. A current-tariff change cannot renew a purchase.
- Six genuine synthetic marquee checkout lifecycles, capacity five, later
  activation after archive, unchanged initial intervals and activation rollback.
- Real maintenance SQL on public tables, with --single-transaction and actual
  database expiry crossing, never temporary-table shadows or clock overrides.
- Independent prepare/authorize/finance/restore/queue/moderation/application
  connections. Waits require pg_stat_activity Lock plus nonempty
  pg_blocking_pids; ordering is not inferred from sleeping or in-process promises.
  Both financial/restore and financial/queue orders terminate correctly.
  Healthy controls accompany all five expiry-wait refusals.
- Owner/moderation/deletion changes during restore waits; concurrent preparers;
  duplicate application fulfillment with exactly one physical delivery and
  payment-bound notification; notification SQL error rolling target/notice/
  marker back while committed financial truth/private intent remain unchanged.

No business eligibility function is copied into the runner. Its SQL is fixture
data setup, wire translation, observation or calls to actual repository RPCs.
Normal rows never disable any protective guard. Earlier historical rows are
inserted before the new migrations; those migrations must not backfill windows,
capture timestamps or private request bodies.

## Refund and rollout limits

Financial/restore interoperation tests prove fulfillment lock compatibility,
not a complete refund policy. Work restore retains its applied same-owner
financial provenance gate and refuses refunded financial rows. Listing and
vacancy restore intentionally retain the existing current is_paid/known-window
legacy contract: they do not read payments or introduce a refund/payer gate.
Their sort-order behavior refreshes published_at but never expires_at.

Automatic unpublication after refund is **not implemented or proved**, including
already-active marquee placements. An operator-approved business contract and
any implementation/reconciliation remain separate pending work. No expectation
or migration was changed to hide this limitation. Fair and application paths
also must not be represented as finite-expiry publication restores.

The selected manifest is not all historical migrations, every RLS policy, all
Supabase Advisors, live Auth/PostgREST, production deployment, real YooKassa
charging/webhook delivery or a complete operator reconciliation/retention policy.
The private ledger contains synthetic receipt PII in these tests; production
retention/export/erasure and coordinated application/schema release need their
existing separate reviews. No production data, merchant configuration, secrets,
live connection, migration history or original workspace was changed.

## Verification results and reproduction

2026-10-08, native Node22 and the approved cached pinned PostgreSQL17 image:

- Full combined PG suite: 69/69, exit 0, about 90 seconds including a concurrent
  native source check. Each invocation removes only its newly owned container.
- Existing complete native source suite: 622/622, exit 0, no cancellation/skip.
  The explicit opt-in PG filename remains outside its default test glob.
- Targeted ESLint on the new runner: exit 0, no warnings. Three-file whitespace
  and unchanged tracked-source checks are part of frozen handoff.
- No TypeScript/build change is introduced; root's independently verified
  application build remains a separate baseline result, not a new claim here.

```sh
env -i PATH=/home/danil/.cache/blizhniy-node22-pxyRwP:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 NODE_ENV=test /home/danil/.cache/blizhniy-node22-pxyRwP/node --experimental-strip-types --test --test-reporter=spec tests/*.test.mjs tests/*.test.cjs scripts/test-*.mjs
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 /home/danil/.cache/blizhniy-node22-pxyRwP/node node_modules/eslint/bin/eslint.js tests/payment-lifecycle-integration-postgres.mjs
```

Lock/clock contracts follow [PostgreSQL17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html)
and [date/time functions](https://www.postgresql.org/docs/17/functions-datetime.html).
Role checks follow [Supabase PostgreSQL roles](https://supabase.com/docs/guides/database/postgres/roles),
without treating a disposable PostgreSQL process as the full Supabase service.
