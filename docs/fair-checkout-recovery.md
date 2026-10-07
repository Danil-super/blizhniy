# Fair application checkout recovery contract

A successful creation response can save a fair application even if its payment
could not be created. The saved server ID belongs to the initiating account;
retrying checkout must not upload the same photos or create another application.
Retry only `POST /api/payments` with that ID, `targetType: fair_application` and
`tariffId: fair-participation`, bound to the current operation's initiating
owner/bearer. Repeated payment failures retain the same saved ID. A genuine
failed creation has no saved ID and may be submitted again normally.

The implemented helper in `src/lib/client-fair-application-flow.ts` is
`submitFairApplicationCheckout({ adminMode, captchaToken, data,
savedApplication?: { id, ownerKey }, onSaved, uploadPhotos })`, returning
`{ destination, external, identity }`. It must capture the actual
`client-user-profile` operation before the first Auth await and assert the
same owner/generation around upload, request field serialization, response
body reads and saved-state/navigation effects. A→B→A still cancels the old
operation. A same-owner token refresh remains valid without replacing its
captured bearer. A B session cannot retry A's saved application.

Never fabricate an application ID from time or demo data when a production
response lacks its persisted ID. An actual returned confirmation URL may be
used for external checkout. If the payment has a valid ID but no confirmation
URL, open `/oplata/<paymentId>` and let the existing payment-return UI show its
truthful state; do not blindly confirm or report cabinet success. Valid admin
waived-payment submissions still navigate to the fair cabinet after a real
saved ID is returned.

## Focused behavioral regression

`tests/fair-checkout-recovery.test.cjs` transpiles and executes the complete
actual `FairApplicationForm.tsx` module and recursive client library sources,
including real `client-user-profile.ts` cache/operation/generation logic.
The original RED component also imported the actual `client-payment-flow.ts`;
the GREEN component imports and executes the actual new checkout helper instead.
The tests do not copy/extract the handler, substitute the checkout helper or
fail merely because a planned helper is absent. Imports resolve from actual
source normally.

The unit boundaries are React hooks/JSX rendering, Next router, synthetic
Supabase Auth listeners/getSession, lexical fetch, browser and FormData. Tests
use the form's actual CAPTCHA callback, re-render the actual component, check
an enabled submit control, and invoke its actual `onSubmit`; repeat submissions
therefore exercise persisted component state rather than a replacement flow.
Every URL/write/navigation is observed by an in-memory strict fixture, with
no real fetch/upload/Auth/provider/DB or browser session manipulation.

Deferred identity/upload/response JSON boundaries trigger account events.
A FormData field getter triggers transition during request serialization.
Assertions distinguish writes started before the account event from forbidden
later create/payment/navigation effects. The positive controls retain ordinary
same-owner refresh, server-rejection retry and valid admin-save behavior.

Run on Node22 with existing dependencies:

```sh
node --test --test-reporter=spec tests/fair-checkout-recovery.test.cjs
```

## Recorded RED before implementation

On 2026-10-07, Node 22.23.1 executed 18 focused cases against the original
component: 3 passed, 15 failed, 0 skipped, exit 1. This was behavioral RED, with
no missing-module/setup failure. The form had no working-tree diff at
HEAD `b365cbc55e04f16421b9e3facde1247f90dcc216`; its original SHA256 was
`676b211b54056000a0681d88311f25ef619af1bc18d54ed001516c99cf445c0e`.
Root's separate server preflight changes were already present and untouched.

The saved-201 retry issued 2 application POSTs instead of 1, and repeated retries
issued 3 instead of 1. Identity account transitions still issued 2 writes;
upload/request-field transitions still issued an application POST; late saved
JSON and missing-ID responses still navigated. A payment without a confirmation
URL issued a direct confirmation POST. The same-owner refresh, genuine creation
rejection retry and valid admin-save controls passed. Focused-file ESLint exited 0.

## Independent GREEN after root implementation

On 2026-10-07 the unchanged focused command above was rerun using Node 22.23.1:
18 passed, 0 failed, 0 skipped, exit 0 (execution session 97440). This independently
reverified the original 15 failing behaviors and retained all 3 positive controls.
The test file SHA256 remained
`cad6aef772bc5d1d67bdbbd34a6c67506e39efe824233ec07df85c7674ebd19c`;
no test semantics, source modules or transport fixtures were changed in this
documentation/verification pass.

The executed source snapshot had these SHA256 values:

- `src/components/FairApplicationForm.tsx`:
  `77c817997c95be91804f0a95d0f3718be907223fbe37d347238a73119a764da5`.
- `src/lib/client-fair-application-flow.ts`:
  `cfab638b7044fdc4033b5633769a5531a69c0dabae57ff8d220ceddf83af2769`.

Source inspection confirms the helper uses the canonical
`captureClientUserOperation(savedApplication?.ownerKey)`, keeps the initiating
bearer, checks current owner/generation before upload/POST and after response
JSON, and checks again before returning an ordinary paid destination. It records
the persisted server ID and owner before reporting a recoverable payment error.
The component retains that pair in a ref, exposes a native saved-cabinet link and
retry caption, and uses the helper's external/native destination without calling
blind payment confirmation. These are client/session safeguards, not substitutes
for server-side ownership and payment authorization.

Root separately reported 72/72 focused tests (54 server prerequisites plus these
18 fair cases), then full-suite 502/502 with exit 0, and build 58/58 pages with
exit 0 (build session 73268). Root also performed an actual on-disk helper mutation:
`if (input.savedApplication)` became `if (false && input.savedApplication)`.
The saved-retry regression failed with 2 creates instead of 1, while the stable
same-owner token-refresh positive control passed. Root exactly restored helper
SHA256 `cfab638b7044fdc4033b5633769a5531a69c0dabae57ff8d220ceddf83af2769`
and reran all 18 fair cases GREEN.

These full-suite/build/mutation results are explicitly root-reported, not inferred
from this independent pass, which ran only the existing 18 fair cases. This pass
changed only this documentation file; no source/test semantics or other files.
Combined browser verification remains pending and is not implied by unit GREEN.

## Unit-adapter limitations

- React state/ref slots and explicit re-renders are modeled; JSX leaf components
  are imported but not mounted, and effects are no-ops. Real React scheduling,
  unmount/remount, accessibility, CSS, link mounting and browser navigation are
  not verified here. The saved ref persists only while this component is mounted;
  this is not cross-reload recovery or server-side submission idempotency.
- FormData is a lexical map adapter. Consent checks and `reportValidity()` are
  always successful; actual native form validation, upload transport/storage,
  content/size validation and duplicate FormData field behavior are not asserted.
- Synthetic Auth delivers listener events at controlled boundaries. The actual
  application generation/cache code executes, but real SDK locking, cross-tab
  delivery, token expiry/refresh scheduling and arbitrary event interleavings
  (including the helper-to-component return hand-off) are not exhaustively tested.
- The adapter invokes the actual CAPTCHA callback before every submit, including
  retries. It therefore does not establish that a saved retry works after the
  widget resets without solving another challenge; that requires normal UI testing.
- `adminMode: true` is a component unit control, not proof of an accessible
  production admin-waiver page. The current public form route requires
  `admin=1` **and** `isDemoAdminBypassEnabled()` for that prop. No production demo
  bypass, role substitution or browser prop injection is proposed.

## Minimal later browser scenarios (not executed in this pass)

Use a matched combined build and a separately approved disposable loopback
Auth/REST/checkout fixture, normal AuthForm login through the real SDK, and the
explicit synthetic widget UI click. Do not inject/read tokens or session storage,
mock browser Auth functions, reuse a read-only fixture for writes, contact a real
provider/storage service, or enable a production demo bypass. The synthetic
create/upload/payment responses must be identified as vendor/transport fixtures,
not live provider assurance. Check the new error/retry/link UI at 320 and 1440px
for visibility, minimum touch targets, focus and console errors.

1. Login A normally, submit one valid fair application and receive saved-201 plus
   payment failure. Verify the visible error, retry caption and native saved-cabinet
   link. Click retry without another CAPTCHA challenge; confirm exactly one create
   and at most the initial approved synthetic upload, followed by owner-bound
   `/api/payments` for the same server ID. Repeat a payment error once, then recover;
   there must still be no duplicate create/upload. The native cabinet link should
   expose A's saved pending application.
2. Exercise initial checkout and saved retry with no confirmation URL. Both must
   open `/oplata/<paymentId>` and show a truthful pending/error state rather than
   cabinet success. The form must not initiate blind confirmation; distinguish any
   legitimate payment-return UI requests after navigation in the fixture ledger.
   A positive external-checkout control may use only an owned synthetic destination.
3. Delay the approved synthetic upload or saved response, then use a second page
   for ordinary logout/login A→B and A→B→A. Resume the pending response and verify
   no later create/payment/navigation and no B retry of A's saved ID. Check a normal
   same-owner flow still succeeds; SDK-driven same-owner refresh can be an additional
   fixture-timed control, never a browser Auth-function/session injection.

These unit tests establish client recovery/session binding, not live Supabase,
CAPTCHA, payment provider, browser layout or production configuration assurance.
Root owns the separate server preflight tests and source implementation; this
test/doc change does not modify those routes or production modules. A combined
synthetic build/browser verification remains a separate later step.
