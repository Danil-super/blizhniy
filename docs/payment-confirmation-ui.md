# Truthful payment confirmation

Financial state and service fulfillment are separate. The return page, payment
control, publication synchronization and payment notifications use the same
pure outcome mapping. A payment with `status: succeeded` only enables a success
redirect/publication sync when `fulfillmentStatus: applied` is explicit.
Unknown/legacy fulfillment does not mean that a publication is active. The
server integration must provide `pending`, `applied` or `blocked`; this UI slice
does not implement the SQL RPC or settle payments.

Canceled/failed and refunded payments are terminal, not pending. Client polling
is limited to financial `created`/`pending` (the existing maximum twenty calls).
Missing or invalid status does not trigger a retry storm. Financial success
with fulfillment pending offers an explicit status recheck, never a second
checkout. Blocked fulfillment directs the user to support/manual review and
does not automatically refund, reset, republish, or grant a new period.

An applied marker describes a previously delivered service, not necessarily a
currently active publication. Copy directs users to the current cabinet state.
A paid marquee waiting for queue activation is described as waiting, not active.
Notification deduplication separates pending/blocked/applied outcomes. A newly
created pending checkout is retained by the payment control for later rechecks.

The existing owner-bound session checks remain in place before/after requests,
notifications and delayed navigation. A manual retry starts a fresh checked
request; it does not bypass server payment ownership or enable mock payments.
Dynamic statuses use a polite live region. Terminal outcomes have no endless
spinner; native controls retain visible keyboard focus and mobile touch sizes.

Verification: actual-source tests exercise React-rendered return/control states,
real client polling/notification/synchronization functions, and the original
account-switch/refresh controls. Provider/Auth/network boundaries are synthetic.
Real YooKassa settlement and live authenticated browser assurance are separate.
