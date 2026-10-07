# Checkout prerequisites before target persistence

Direct listing, vacancy, work-request, application and fair-application checkout
routes validate server merchant/receipt prerequisites after authentication and
input/eligibility checks but before saving or updating their target. Validation
uses the same pure provider receipt builder as actual payment creation, with
the verified authenticated payer email, never the target's public contact email.
Missing production provider, credentials or enabled-receipt email/VAT returns
503 with a bounded Russian error and no target, payment-intent or provider write.
Disabled receipts need neither payer email nor VAT; draft vacancy/work-request
saves, already-paid responses and separately authorized admin fair waivers retain
their no-checkout paths. This is a configuration preflight, not provider health
checking, tariff/stock reservation or a transaction with a remote provider.

If payment creation becomes uncertain after a fair application is saved, the
route returns201 with its real application and a bounded recovery message,
not an invented payment, raw provider exception or a claim of financial failure.
The client retains that owner-bound application ID and retries only its payment.
See `fair-checkout-recovery.md` for the client contract and unit/browser limits.
An HTTP interruption before the client receives the saved ID remains an unknown
submission outcome; this slice does not add cross-reload submission idempotency
or reconstruct merchant requests after their provider idempotency window.

## Evidence and limits

`tests/checkout-prerequisites.test.cjs` executes the actual complete routes and
provider module; Auth/target store/HTTP/framework boundaries alone are synthetic.
The 54 cases cover five direct checkout entry points, seven fail-closed
configuration cases each, valid verified receipts, signed-out callers, disabled
receipts, draft paths, a paid-response shortcut, the separate admin waiver, and
an uncertain provider500 after fair persistence. All54 pass. Initial RED showed
target writes on each of the35 bad configurations plus an escaping fair provider
failure. An actual on-disk receipt-preflight omission killed its negative test
while the configured-checkout control passed; source was exactly restored.

On2026-10-07, Node22.23.1 ran the complete parallel suite at base
`b365cbc55e04f16421b9e3facde1247f90dcc216` plus this checkout increment:
502 passed,0 failed/cancelled/skipped. The isolated Next15.5.24 production build
compiled, linted/typechecked and generated58/58 static pages. It used only a
loopback synthetic Supabase URL/service key and is not a deployment artifact.
The inherited receipt fixture now supplies actual read-only application lookup
exports; the CAPTCHA-focused fixture explicitly stubs the new provider preflight
at its existing provider boundary. Receipt/preflight logic itself is exercised
by the dedicated actual-provider tests, not those CAPTCHA-specific controls.

No production database, real Auth/CAPTCHA/storage, provider credentials or
merchant endpoint was used. Synthetic HTTP behavior is not YooKassa certification.
Atomic fulfillment, expiry/queue integration, historical reconciliation and a
real isolated merchant test remain separate rollout prerequisites.
