# Durable YooKassa checkout intent

## Scope and safety contract

The approved offline change keeps complete provider POST/receipt data in a
private, server-only intent ledger, never in public payment rows or DTOs.
The existing authenticated browser payment SELECT contract is unchanged.
No API/UI, waiver/demo, queue, expiry or live merchant configuration changes
are authorized by this increment.

Each new checkout stores exact request bytes, SHA-256, original merchant/test
binding and the committed owner/target/tariff/amount/duration before dispatch.
Replay is limited to an exclusive 23h55m interval from immutable database
authorization time. UNKNOWN legacy/body-less or expired intents remain active
for manual reconciliation, never silently replaced by a new UUID/charge.
Known provider IDs permit authoritative GET recovery only, not POST fallback.

The snapshot uses UTF-8 bytes (maximum 16KiB), not a rebuilt JSON object. It
includes capture, amount/currency, confirmation/return URL, title, receipt and
metadata. The database computes SHA-256; the actual store verifies it before
dispatch. No API secret is persisted. Same-shop, same-mode secret rotation is
allowed; a new snapshot's original shop/test binding is checked before every
GET or POST. Current title, verified payer email, VAT, receipt-enabled flag,
public URL, tariff price and duration cannot change replayed bytes. Fresh
checkout prerequisites are unchanged; existing complete receipts need not
meet subsequently changed receipt configuration. Missing/inactive tariffs
fail closed rather than guessing a deleted offer.

Root explicitly authorizes a historical compatibility exception: a stored
provider ID without a private snapshot can be queried with current trusted
merchant credentials. Original merchant provenance cannot be proved for those
rows. Wrong-shop/404 or response binding failures must precede finance writes.
Rollover requires operator inventory/review; the exception never authorizes a
new charge, reconstruction, invented ledger or new idempotence key.

The parent payment row precedes the private intent in lock order. Database
checks use post-lock clock_timestamp(); external HTTP begins only after the
authorization transaction commits. Receipt fields and snapshot timing cannot
be overwritten; legitimate finance/provider-ID adoption/fulfillment remain
mutable under the existing monotonic settlement controls.

Each transport POST attempt obtains a fresh committed authorization. Its
remaining DB interval is reduced by the complete monotonic RPC round trip,
including decoding/hash verification, then clamps the existing shared 35s
headers/body/backoff budget. Neither application wall time nor a transport
retry extends the earliest DB anchor. Maximum three provider attempts and
64KiB decoded response limits remain in force. The anchor is an earliest
committed authorization, not a claim that the remote merchant received it;
the 23h55m exclusive cutoff intentionally leaves a conservative five-minute
margin under the vendor's 24h idempotence contract.

Only the process whose new payment INSERT succeeded prepares its body. A
losing concurrent process reads the winning committed snapshot or returns the
manual gate; it never prepares its own receipt for that payment. Preparation
also requires a newly created, still-created, unknown-ID payment no older than
five minutes. A crash/lost response between payment insertion and preparation
may therefore leave a body-less active row deliberately needing reconciliation.
There is no automatic backfill, failure reset, new UUID or retry-window reset.
Schema and application release must be coordinated; missing RPCs fail closed
and can leave such availability/manual-review cases. No financial safety
claim implies that automatic checkout remains available during that gap.

Ledger immutability applies even to service-role no-op UPDATE/DELETE, as well
as ordinary owner SQL. PostgreSQL FOR UPDATE requires UPDATE privilege on a
column: service_role receives only payment_id UPDATE for locking, and the
trigger still rejects every UPDATE. The private table has RLS and no browser
grants; new RPCs are service-only SECURITY INVOKER with empty search_path.
Parent input freeze preserves owner/target/tariff/provider/amount/duration/
creation time while allowing existing financial status, provider-ID adoption,
verified paid_at and owner-bound fulfillment guards to operate.

## Initial RED evidence

Baseline is immutable commit 2253df55793b09a318336bf2c38e4035de73e14e.
Native Node22 executed the full actual provider/store/tariff/runtime/mock/data
module graph, with only REST/vendor/time boundary adapters. Initial suite:
6 tests, 2 stable controls pass, exactly 4 regressions fail, exit 1.

- Full body changed with title/email/VAT/base URL drift despite the same key.
- A synthetic remotely created object with lost first response was POSTed again
  by a new server graph after 25h. This is not proof of a real double charge.
- Known-ID/no-URL recovery performed GET then POST instead of GET only.
- Body-less legacy UNKNOWN resolved instead of remaining manual-gated.

Fresh committed amount 199.99/duration9/owner and authoritative pending
non-publication controls passed. No missing planned helper/module was used as
the behavioral RED. The CLI-created migration was still empty and production
source unchanged for this run.

## Verification boundaries

The Node REST/RPC adapter does not assure live Supabase/PostgREST/Auth or SQL
locking. A separately owned network-isolated PostgreSQL17 suite must execute
the actual migration/RPC/trigger controls and independent transactions.
No offline provider fixture proves genuine YooKassa delivery or real charging.
No live merchant POST, credentials, production DB or webhook settings belong
to this increment. Genuine TEST merchant E2E remains a later, separately
authorized gate with production-isolated webhook configuration.

Complete receipt snapshots contain server-only PII for exact operation replay
and reconciliation. Deployment requires operator-approved retention/export/
erasure handling for financial records and backups; this increment does not
invent a legal retention period or an automatic destructive purge.

The PG historical-window tests temporarily disable the immutable trigger only
inside an owner-controlled disposable fixture transaction, backdate synthetic
history and re-enable it before commit and any actual RPC/provider execution.
Production functions expose no clock override or historical reset argument.
Both PG suites used cached PostgreSQL17.11 containers with network=none, tmpfs
data and read-only repository mounts. Every invocation cleaned up only the
exact newly owned fixture container after validating its ownership label.

## GREEN and actual mutation evidence

2026-10-08, native Node22.23.1, worktree HEAD still the baseline above:

- New actual-module snapshot unit suite: 24/24 GREEN, including byte equality
  across a fresh graph/config drift, each-dispatch authorization, complete RPC
  elapsed subtraction, lost response +25h, legacy GET, hash and DTO boundaries.
- Combined six focused provider/prerequisite/receipt/confirmation/fulfillment/
  snapshot files: 294/294 GREEN. Provider boundary file alone: 160/160 GREEN.
  No original test was deleted; the three explicitly superseded GET-to-POST
  fallback expectations became GET-only ID, attempt and shared-deadline tests.
  Existing historical known-ID fixtures remain ledger-less; snapshots were
  added only to fresh/explicitly new UNKNOWN-intent fixtures. Fulfillment RPC
  assertions now select that RPC specifically, not newly added authorization
  traffic, without relaxing finance-before-fulfillment or effect-count checks.
- Original, unchanged real PostgreSQL fulfillment suite: 57/57 GREEN.
- New actual PostgreSQL snapshot suite: 21/21 GREEN. It verifies independent
  commit visibility/rollback, actual invoker/grants and browser-read invariants,
  service/owner immutability, VAT/body/UTF8 rejection, serialized preparers,
  late parent input changes and post-commit freeze under lock waits, post-lock
  expiry, financial adoption and actual fulfillment replay, plus whole actual
  provider/store execution with SQL-committed snapshots and lost-response age.
- Full isolated source suite: 573/573 GREEN, zero failures/cancellations/skips.
- TypeScript noEmit, npm lint and git diff --check: exit 0. Lint retains the
  pre-existing unused targetType warning in checkout-prerequisites.test.cjs;
  no new warning remains.
- Production Next15.5.24 build: exit 0, 58/58 static pages. Clean env had no
  Supabase/provider credentials, telemetry disabled and synthetic localhost
  public URL. Read-only inherited fetch guard allowed only unused loopback
  127.0.0.1:1; no outbound guard events or runtime merchant requests occurred.
  This is compile/prerender proof, not configured production E2E.

Twelve real on-disk apply_patch mutants were independently killed with exit 1
and assertion failures (no cancellation/skip used as a kill):

1. Reconstruct current title into persisted full POST bytes.
2. Substitute original fixture merchant/mode instead of current binding before GET (two failures).
3. Skip new DB authorization after the first transport attempt.
4. Disable the store's actual SHA-256 comparison.
5. Remove monotonic RPC elapsed subtraction.
6. Extend actual SQL replay cutoff to 48h.
7. Use transaction-start time instead of post-lock clock_timestamp().
8. Disable immutable snapshot UPDATE rejection.
9. Grant authenticated SELECT/INSERT on the private ledger.
10. Remove VAT NULL/type rejection.
11. Disable SQL merchant/test binding rejection.
12. Disable parent payment input freeze.

Every mutant was restored by the inverse exact patch before the final GREEN
runs. Restored production SHA-256 values:

```text
payment-provider.ts: 1f89f8544cc5525822597a38e21f474a4827828ee462e69813c42ec8b1545ae9
payment-store.ts: 37044424cf9691f8b44a69d3503005d3b1f29a1c366e1a59dd620df79254e7c0
20261008062202_snapshot_yookassa_checkout_intents.sql: 33a7c240e9027711f146fbd50ab8dd0f305e300b1495ef427ee3867ee72a56c3
```

The approved private-ledger increment changes exactly twelve files:

```text
src/lib/payment-provider.ts
src/lib/payment-store.ts
supabase/migrations/20261008062202_snapshot_yookassa_checkout_intents.sql
tests/payment-checkout-intent.test.cjs
tests/payment-checkout-intent-postgres.mjs
tests/fixtures/payment-checkout-intent.sql
docs/payment-checkout-intent.md
tests/payment-provider-boundary.test.cjs
tests/checkout-prerequisites.test.cjs
tests/payment-receipt-route-email.test.cjs
tests/payment-confirmation-security.test.cjs
tests/payment-fulfillment-server.test.mjs
```

No browser payment SELECT revocation, API/UI/types, package/lock, live
environment, queue or expiry changes are included.

## Commands

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin /home/danil/.cache/blizhniy-node22-pxyRwP/node --test --test-reporter=spec tests/payment-checkout-intent.test.cjs
env -i PATH=/usr/local/bin:/usr/bin:/bin /home/danil/.cache/blizhniy-node22-pxyRwP/node --test --test-reporter=spec tests/payment-checkout-intent-postgres.mjs
env -i PATH=/usr/local/bin:/usr/bin:/bin /home/danil/.cache/blizhniy-node22-pxyRwP/node --test --test-reporter=spec tests/payment-fulfillment-postgres.mjs
env -i PATH=/usr/local/bin:/usr/bin:/bin /home/danil/.cache/blizhniy-node22-pxyRwP/node --experimental-strip-types --test --test-reporter=spec tests/*.test.mjs tests/*.test.cjs scripts/test-*.mjs
```

The migration filename was generated by the approved healthy Supabase CLI
2.109.1, after --help discovery:
`20261008062202_snapshot_yookassa_checkout_intents.sql`.

## External gate still outstanding

Genuine TEST-merchant E2E needs verified test=true and a production-isolated
webhook destination/delivery inventory approved by the operator. A shop-global
webhook may still target the historical production application: synthetic
remote metadata could cause unknown callbacks/retries there. Do not change
global webhook settings, issue merchant POSTs, auto-create replacement intents
or call the offline HTTP fixtures a real-merchant test. Ordinary SDK login and
UI success/cancel/pending/spoof/replay coverage belong to that later gate.

Primary contracts: [YooKassa idempotence/interaction format](https://yookassa.ru/developers/using-api/interaction-format),
[TEST merchant payments](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing),
[webhook delivery/verification](https://yookassa.ru/developers/using-api/webhooks),
[PostgreSQL17 binary SHA-256](https://www.postgresql.org/docs/17/functions-binarystring.html),
[PostgreSQL17 clock semantics](https://www.postgresql.org/docs/17/functions-datetime.html).
