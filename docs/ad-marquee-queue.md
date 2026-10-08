# Atomic ad-marquee queue

The service has five simultaneous placements. Payment settlement and queue
activation are separate transactions: financial fulfillment binds the approved,
owner-matching placement and marks it `paid`; queue reconciliation subsequently
starts its purchased display window. Payment success does not imply immediate
display when all five slots are occupied.

## Service contracts and lock ordering

`public.reconcile_ad_marquee_queue()` accepts no capacity, duration, timestamp or
owner arguments and returns committed active IDs (`[{"id":"…"}]`). It acquires
the transaction-level advisory key `(1112295754, 1)` before selecting its lock
set, then locks **all referenced payments in UUID order FOR SHARE**, then
**all involved placements in UUID order FOR UPDATE**. The lock set includes
existing active placements and at most five eligible paid candidates. Eligibility
is checked again after the locks, not assumed from the earlier candidate query.
Newly paid rows not selected in that batch wait for the next reconciliation.

Fresh activation requires succeeded YooKassa finance, applied fulfillment with
its marker, matching payment/placement owner and target, approval, succeeded
placement payment status, matching known settlement timestamp, and an immutable
`payments.purchased_duration_days` between 1 and 365. Refunded or changed bindings
observed while waiting for a lock cannot activate. Queue order is
`sort_order, paid_at, created_at, id`.

The first display window starts at the database clock **after all locks** and
lasts purchased duration times **24 hours**. Queue waiting does not consume display
time. Current tariffs, application-server clocks and a guessed seven-day fallback
are never used. Reconciliation replay leaves every existing start/end unchanged.
Only complete historical windows matching their purchased snapshot may expire;
expiration and slot reuse are one transaction. Partial, inconsistent or unknown
historical windows are not repaired with today's clock. Such active rows
conservatively occupy capacity until an operator resolves them from trustworthy
evidence. Existing malformed or over-capacity data is not silently rewritten by
the migration. This increment does not implement automatic refunds or historical
data repair; already-active legacy rows need separate review.

`public.moderate_ad_marquee_placement(uuid,text,integer,text)` returns
`{placement, changed, outcome}`. `outcome` is `updated`, `unchanged`, `not_found` or
`conflict`; `changed` means an actual status transition, not a sort/comment edit.
It locks **global queue → placement**, never a payment. Approval is
pending-review → pending-payment, with repeat approval preserving `approved_at`.
Paid, active and terminal rows cannot return to pending-payment. Rejection is
limited to unpaid moderation states; archive preserves financial fields and the
historical display interval. Sort order is a PostgreSQL int32 and comments are
limited to 2000 characters. HTTP moderation keeps `{placement, placements}` and
reports an ineligible transition as 409.

Both RPCs are SECURITY INVOKER with empty `search_path`, fully qualified objects,
service-role-only EXECUTE and a two-second lock timeout. Notifications and queue
refresh run **after moderation commit**, never inside its placement lock. A
failed/unknown response is not a reason to perform a raw activation PATCH.
Financial fulfillment retains **payment → placement** order and never requests
the queue global lock. Never call either queue RPC from a transaction that
already holds a payment or placement lock.

## Write boundary and rollout

Migration `20260927084703` already intentionally revokes browser table writes.
This queue migration preserves that full revoke: PUBLIC, anon and authenticated
cannot INSERT/UPDATE/DELETE placements or execute either RPC, including an admin
JWT. It adds no new browser GRANT. Legitimate draft creation remains the existing
`POST /api/ad-marquee`, which binds the verified user's ID and writes through the
server's service role. Admin moderation verifies admin authority before its
service RPC. Existing owner/admin/public SELECT policies remain unchanged.

A row guard rejects raw activation without the already-held queue advisory lock,
interval replacement, and status regression. It **observes**, never acquires, the
global lock; acquiring one from a row trigger would invert financial lock order.
Advisory locks are cooperative: a trusted service-role SQL operator can take the
lock and issue direct SQL, so this is not an authorization boundary against that
operator. Browser grants and RPC EXECUTE restrictions provide the untrusted-client
boundary. The normal service creation path cannot insert an active window.

Apply `20261007193251_atomic_ad_marquee_queue.sql` **before** deploying these
server adapters, with obsolete raw queue writers quiesced for the switch. The
guard deliberately rejects an old server's raw activation rather than permit a
mixed-version capacity race. No production migration or deployment is performed
by the regression harness. Do not roll back only the application to its former
raw queue writer while retaining the guard: stop queue/moderation and coordinate
a reviewed database/application rollback instead. Financial records and existing
intervals must not be discarded as a rollback mechanism.

## Offline verification

Using Node22 and installed dependencies:

```sh
node --test tests/ad-marquee-queue-store.test.cjs
node --test tests/ad-marquee-queue-postgres.mjs
```

The PG test is opt-in, uses only a cached `postgres:17-alpine` image with
`--pull never --network none`, no host ports and tmpfs data. It mounts this repo
read-only, loads the existing synthetic fulfillment fixture and the actual queue
migration, and deletes only its own label-verified disposable container.
Independent PostgreSQL connections and observed lock barriers exercise concurrency;
there are no real merchant keys, application `.env`, external provider calls or
live Supabase connections. Physical target-write counters prove interval replay
does not issue a no-op UPDATE. The store tests execute transpiled application
source with boundary doubles; they are not source-text/regex assertions alone.

SQL mutations are opt-in and applied only to the disposable fixture's migration
string, never the worktree or a remote database. For example, the following must
exit nonzero with an assertion failure, while its unmutated control passes:

```sh
BLIZHNIY_QUEUE_MUTANT=duration node --test --test-name-pattern='purchased duration' tests/ad-marquee-queue-postgres.mjs
```

Supported mutants cover duration, capacity, UUID payment order, payment/placement
lock order, browser RPC grant, pre-lock clock, and missing post-lock owner or
approval checks. A startup/hook error is not considered a killed mutation.

Primary references: [PostgreSQL explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html),
[Read Committed semantics](https://www.postgresql.org/docs/17/transaction-iso.html),
[Supabase database functions and permissions](https://supabase.com/docs/guides/database/functions).
