# YooKassa response boundary

Reviewed on 2026-10-07. This is a defensive correctness/hardening increment, not a claim of a new demonstrated exploit or a complete payment-system fix. It changes the provider boundary only; settlement persistence and durable entitlement/fulfillment are separate work.

## Accepted response contract

Both payment creation and authoritative status GETs validate the consumed fields before recording remote state or applying a target:

- UUID-shaped provider ID, exactly equal to the stored provider ID when one is already known.
- Positive RUB amount with two decimal places, equal to the original stored amount. Comparisons and formatting use integer kopecks, not floating-point multiplication or rounding. Invalid local amounts fail before remote I/O.
- Only `pending`, `waiting_for_capture`, `succeeded`, and `canceled`, with boolean `paid` consistent with that status. Authorization (`waiting_for_capture`, `paid: true`) is not captured settlement and remains locally pending.
- Boolean `test` matching the configured merchant. The project's existing explicit `test_` secret convention selects test mode independently of `NODE_ENV`; a production-hosted test shop remains supported. This prefix is a project configuration convention, not an assertion that the published API schema defines key syntax. The existing non-production explicit test-return shortcut is unchanged and must never be enabled in production.
- Optional `captured_at`, when supplied for a successful captured payment, becomes a validated `capturedAt` field: UTC `Z`, an actual calendar date/time, at most 30 characters, zero through nine fractional digits preserved, and no more than five minutes ahead of the verification clock. The future allowance is an application clock-skew policy, not a vendor guarantee. The official schema does not require this field; absence remains `undefined`. `created_at` is order-creation time, not capture time, and neither it nor verification-arrival time is fabricated as a historical capture timestamp.
- Metadata, when present, is an object with at most 16 entries, keys at most 32 characters, and string values at most 512 characters or `null`. The official nullable-value contract remains supported. The supplied `localPaymentId`, `targetId`, `targetType`, and `tariffId` bindings must match exactly if returned; null binding values fail. Missing legacy bindings are not invented. Notification metadata is not a substitute for the independently fetched response.
- If confirmation is present, it must be a typed `redirect` confirmation with a bounded HTTPS URL, no credentials, nondefault port, whitespace, control characters, or backslash. The current hosted-checkout policy permits only the exact hosts `yoomoney.ru` and `yookassa.ru`. A stored fallback confirmation URL receives the same validation.

The host policy deliberately excludes unreviewed partner/3-D Secure/other confirmation flows. YooKassa supports other flows; this is an application policy, not a universal vendor-domain guarantee. Such a flow needs an explicit compatibility/security review before changing the allowlist. Unused provider fields, including PII, are not retained or trusted by the validator.

Schema source: [official OpenAPI specification](https://yookassa.ru/developers/using-api/openapi-specification), [published YAML schema](https://yookassa.ru/developers/api/yookassa-openapi-specification.yaml). Status interpretation: [payment lifecycle](https://yookassa.ru/developers/payment-acceptance/getting-started/payment-process). Test responses: [testing and going live](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing).

## Bounded remote operation

A remote operation has one maximum-three-attempt budget and one 35-second deadline starting at its first HTTP request. Existing-payment GET and a subsequent idempotent POST share that budget. The deadline covers fetch headers, decoded response-body consumption, and retry backoff. Local database/fulfillment awaits are not claimed to have this deadline.

Every fetch uses the same abort signal and `redirect: "error"`. Decoded bodies are capped at 64 KiB, independent of `Content-Length`, and unfinished readers are canceled. The cap allows the consumed payment schema with generous overhead; unreviewed oversized future provider payloads fail closed. Terminal cleanup removes deadline/backoff timers.

Network failures and 5xx responses may retry within the same budget, with identical POST body and local `Idempotence-Key`. 4xx, malformed successful responses, body-limit violations, and timeout are terminal for that operation; they do not trigger a fallback POST. In particular, 429 is surfaced rather than automatically retried here. A transport timeout/500 is an unknown financial result, not evidence that money was not charged. Errors expose only fixed messages, HTTP status and a validated provider error UUID, never raw provider descriptions, authorization headers, or transport error text.

Rationale: [official interaction/idempotence format](https://yookassa.ru/developers/using-api/interaction-format) documents up to 30 seconds of processing, 24-hour idempotence, and unknown results after errors. The 35-second application cap leaves a small transport margin without allowing each retry its own full wait. [Official HTTP response guidance](https://yookassa.ru/developers/using-api/response-handling/http-codes) describes retryable/unknown server results. Cancellation includes the body, not just arrival of headers: [fetch cancellation](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#canceling_a_request), [Node 22 AbortController](https://nodejs.org/download/release/v22.23.1/docs/api/globals.html#class-abortcontroller).

## Original operation snapshot and limits

The stored/reused representation supplies the payment ID, owner, target/type, tariff binding and original amount. Owner and target/type must match the authenticated checkout input before charging. Successful POST handling preserves this representation instead of rebuilding a payment without its owner. Both the charge and receipt amount use the stored original amount, including after a tariff-price change or a database uniqueness race. Receipt email/VAT prerequisites are still checked before local payment creation. The local operation is persisted before POST; malformed provider responses therefore leave a durable unconfirmed operation, not an invented success.

This increment does **not** add a durable complete request snapshot: description, receipt/customer details, return URL and configuration may change across process-separated retries. The vendor's 24-hour idempotence window, historical tariff-slug mapping, long-lived stale operations, recovery/operator UX, moderation/expiry checks, transactional fulfillment, refunds and reconciliation need their own reviewed increments. A historically inconsistent binding fails closed rather than rewriting authoritative payment identity. No schema migration, real provider request, test-money transaction, database mutation or deployment was performed for these tests.

Integration requirement: the separate settlement/fulfillment patch must consume verified `capturedAt`, preserve a trusted existing `paidAt` first, and leave the fulfillment anchor unknown when neither exists. A financially successful payment with an unknown capture time must be deferred/blocked for entitlement, not relabeled a failed charge or granted a fresh window. This boundary patch deliberately leaves the existing apply-state `paidAt` clause and shared success-applicator functions unchanged; until that integration lands, their old verification-arrival fallback is **not** corrected by this slice. A database guard that fills a missing first-success time with `now()` would likewise violate the required unknown-anchor behavior.

## Verification

`tests/payment-provider-boundary.test.cjs` executes the complete TypeScript provider source with lexical synthetic I/O and a deterministic clock; it does not replace global fetch or contact YooKassa. It covers GET and POST validation, streamed-body abort/cap, timeout and shared attempt/deadline budgets, secret-safe failures, exact original-price receipts, owner retention, process concurrency and database-race controls. Existing confirmation/receipt-route tests retain their assertions and receive only contract-correct provider/store fixtures.

Run with Node 22:

```sh
node --test tests/payment-provider-boundary.test.cjs tests/payment-confirmation-security.test.cjs tests/payment-receipt-route-email.test.cjs
```

Patch verification (Node 22.23.1, synthetic environment):

- Baseline: 245/245 tests before boundary changes.
- RED: four transport failures; 40 runtime-contract failures; eight snapshot/owner/price failures; two control-character URL failures; one valid-replacement compatibility failure; 26 capture-time failures; two exact nanosecond future-bound failures. Assertions were not weakened to obtain GREEN.
- GREEN: 160 new boundary tests, all 21 existing confirmation/receipt-route tests, and 406/406 full-suite tests including the independently repaired SSH readiness regression. ESLint, TypeScript, three shell-test suites and the clean production build (58/58 generated pages) passed.
- Mutation checks: all 21 in-memory source mutants killed by actual assertion failures, zero canceled tests; the unmutated same-harness control passed 160/160. Mutants covered deadline/abort/body/attempt budgets, original identity/amount/owner, metadata/mode/status, URL policy, error secrecy, capture validation, precision, exact future bound and absence handling. Potentially hanging transport mutations used their focused test-name patterns; other mutants ran the full boundary file.

Before the independent SSH-test repair, one repeated full run reported 374/375 with truncated failure detail; a later run reproduced a 402/403 failure with a concrete loopback `sshd` bind collision. The readiness test itself raced for the server's port. The parent-approved one-file SSH fix was imported separately, without changing or committing these five provider files; the subsequent complete run passed 406/406. These are synthetic implementation checks, not live payment-provider certification.
