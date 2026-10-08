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

Prerequisites: native Node22, Docker access to the already-cached pinned image,
and **real local dependencies installed from package-lock.json** in the checkout
being tested. The complete-module harness requires local `typescript`; the
sanitized environment command is not self-contained in a fresh checkout.
Do not substitute NODE_PATH or a shared/symlinked node_modules directory.
The local installation used for this increment was:

```sh
env -i PATH=/home/danil/.cache/blizhniy-node22-pxyRwP:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 /home/danil/.cache/blizhniy-node22-pxyRwP/node /usr/share/nodejs/npm/bin/npm-cli.js ci --ignore-scripts --no-audit --no-fund
```

Then run explicitly with native Node22 from that checkout:

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 /home/danil/.cache/blizhniy-node22-pxyRwP/node --test --test-concurrency=1 --test-reporter=spec tests/payment-lifecycle-integration-postgres.mjs
```

The cached pinned PostgreSQL17 image uses `--pull never --network none`, tmpfs,
a read-only repository mount and Unix sockets, with no exposed ports or env
files. Name collision fails without touching the existing container. Cleanup
targets only the newly created container ID after validating its ownership label.

## Verified scope

The source base for the post-payment marquee event increment is
`6a34310b227241021ab9d9149396b4d575a39a68`.
The fixture reads repository SQL directly, including both raw-location SELECT
revocations. The runner verifies chronological manifest order and the reviewed
checkout migration SHA-256 before creating a container. That artifact check is
not itself behavioral proof of checkout security.

The combined suite's verified groups cover:

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
- Genuine marquee financial/fulfillment commits followed by the separate actual
  queue RPC and a narrow owner/payment/status-bound placement GET. Its exact wire
  OR is `(status.eq.paid,and(status.eq.active,starts_at.lte.now,ends_at.gt.now))`.
  The adapter translates these predicates only: PostgreSQL converts
  `'now'::timestamptz` in a fresh statement for each GET, not an application clock
  or cached prepared timestamp. Eligibility/capacity stays in the repository RPC.
  First activation produces one fulfillment write plus one activation write;
  confirmed replay remains active without resetting established intervals.
- Two further full actual marquee module cases: five occupied slots keep the
  sixth paid with NULL intervals; a real independent advisory lock causes the
  actual RPC's lock timeout. The latter returns unknown delivery/queue_pending,
  not false success or financial failure, then activates once after release and
  a verified retry. Payment/intent and existing intervals remain unchanged,
  with exactly one synthetic provider POST throughout.
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

SQL fulfillment alone still produces paid marquee state; immediate activation
is a post-commit application event, not an alteration of financial SQL. The
placement adapter is not a running PostgREST parser/server. Corrected logic wire
follows the [PostgREST13 parser](https://github.com/PostgREST/postgrest/blob/v13.0.7/src/PostgREST/ApiRequest/QueryParams.hs);
database literal semantics follow [PostgreSQL17 date/time input](https://www.postgresql.org/docs/17/datatype-datetime.html).
This does not identify the separate legacy homepage `gt.now()` scalar as a bug.

Periodic queue operation and expiry of already-active placements are separate
coverage/operation boundaries. This two-file increment adds no historical expiry
fixture, backdated interval, protective-guard bypass or automatic worker. It
does not turn the existing separate historical queue-expiry tests into combined
full-module expiry proof.

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

Historical snapshot, source base `44fe03dc1030b539bbede5180ba2d2a2c5478fa9`:

- Child verification was 69/69 PG and 622/622 native. Its ignored dependency
  setup used cp -as from the then-current audit node_modules, with no NODE_PATH;
  it was not part of the three frozen files and was not a self-contained clean
  checkout reproduction. A later reviewer startup failed to resolve typescript,
  not a test assertion. Root then independently verified 69/69 with real own
  dependencies. Those counts are historical, not current event-suite counts.

Post-event increment, 2026-10-08, source base `6a34310b`, native Node22 and cached PG17:

- Full combined PG suite: 71/71, exit 0, about 102 seconds. Complete native
  source suite: 676/676, exit 0, about 26 seconds; neither has cancellations or
  skips. Targeted runner ESLint: exit 0, no warnings. Two-file diff/check and
  unchanged fixture/source checks accompany the frozen handoff.
- Strict adapter/module slice: 7/7, exit 0; capacity/real timeout slice: 2/2,
  exit 0. No tests are cancelled or skipped.
- Meaningful actual on-disk provider event-guard mutant: 6 unaffected graph
  controls pass, marquee fails its paid-versus-active assertion, exit 1. Provider
  restored exactly to SHA-256
  `40cf0f821d8c9ca3ed5fa76820a357c53200e745016ed88ec0908f24509fb658`;
  restored 7/7 follows. Root's old-adapter compatibility RED (6 pass, marquee
  undefined-versus-paid failure) is a separate adapter mismatch, not a production
  or security discovery.
- The explicit opt-in PG filename remains outside the default native test glob.
  Each PG invocation cleans up only its newly owned labelled container ID.
- No application source, TypeScript or build change is introduced by these two
  files. Root's independently measured base build58/type0 results remain separate
  evidence, not a new child build claim. Frozen handoff records the two final file
  hashes; fixture and SQL remain unchanged.

Focused commands (the first also exercises the approved temporary guard mutant,
restored before the full run; no permanent source mutation is part of this patch):

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 /home/danil/.cache/blizhniy-node22-pxyRwP/node --test --test-concurrency=1 --test-reporter=spec --test-name-pattern='whole actual provider/store graph' tests/payment-lifecycle-integration-postgres.mjs
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 /home/danil/.cache/blizhniy-node22-pxyRwP/node --test --test-concurrency=1 --test-reporter=spec --test-name-pattern='actual marquee event' tests/payment-lifecycle-integration-postgres.mjs
```

```sh
env -i PATH=/home/danil/.cache/blizhniy-node22-pxyRwP:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 NODE_ENV=test /home/danil/.cache/blizhniy-node22-pxyRwP/node --experimental-strip-types --test --test-reporter=spec tests/*.test.mjs tests/*.test.cjs scripts/test-*.mjs
env -i PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 /home/danil/.cache/blizhniy-node22-pxyRwP/node node_modules/eslint/bin/eslint.js tests/payment-lifecycle-integration-postgres.mjs
```

Lock/clock contracts follow [PostgreSQL17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html)
and [date/time functions](https://www.postgresql.org/docs/17/functions-datetime.html).
Role checks follow [Supabase PostgreSQL roles](https://supabase.com/docs/guides/database/postgres/roles),
without treating a disposable PostgreSQL process as the full Supabase service.
