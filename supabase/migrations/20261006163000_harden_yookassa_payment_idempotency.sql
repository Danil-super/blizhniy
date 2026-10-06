-- Keep YooKassa checkout creation and webhook delivery idempotent.
alter table public.payments
  add column if not exists target_applied_at timestamptz;

create unique index if not exists payments_one_active_yookassa_checkout_per_target_idx
  on public.payments (user_id, target_type, target_id)
  where provider = 'yookassa'
    and status in ('created', 'pending')
    and user_id is not null;