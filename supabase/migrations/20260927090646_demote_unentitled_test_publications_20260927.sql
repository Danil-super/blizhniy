-- One-time cleanup for synthetic publications created before atomic entitlements.
-- Keep confirmed, unexpired YooKassa publications for the same owner and target.
-- The payment table is locked briefly so a concurrent success cannot commit
-- between the entitlement check and the publication-status update.
lock table public.payments in share mode;

update public.specialist_profiles s
set status = 'draft'::public.publication_status
where s.status = 'published'::public.publication_status
  and not exists (
    select 1
    from public.payments p
    join public.tariffs t on t.id = p.tariff_id
    where p.user_id = s.user_id
      and p.target_type = 'specialist'
      and p.target_id = s.id
      and p.provider = 'yookassa'
      and p.status = 'succeeded'::public.payment_status
      and nullif(btrim(p.provider_payment_id), '') is not null
      and p.paid_at is not null
      and p.paid_at <= now()
      and t.action = 'specialist_publication'::public.tariff_action
      and t.duration_days > 0
      and p.paid_at + make_interval(days => t.duration_days) > now()
  );

update public.work_requests w
set status = case
  when exists (
    select 1
    from public.payments p
    join public.tariffs t on t.id = p.tariff_id
    where p.user_id = w.author_id
      and p.target_type = 'workRequest'
      and p.target_id = w.id
      and p.provider = 'yookassa'
      and p.status = 'succeeded'::public.payment_status
      and nullif(btrim(p.provider_payment_id), '') is not null
      and p.paid_at is not null
      and t.action in ('work_request_publication'::public.tariff_action, 'listing_publication'::public.tariff_action)
      and t.duration_days > 0
  ) then 'expired'::public.publication_status
  else 'draft'::public.publication_status
end
where w.status = 'published'::public.publication_status
  and not exists (
    select 1
    from public.payments p
    join public.tariffs t on t.id = p.tariff_id
    where p.user_id = w.author_id
      and p.target_type = 'workRequest'
      and p.target_id = w.id
      and p.provider = 'yookassa'
      and p.status = 'succeeded'::public.payment_status
      and nullif(btrim(p.provider_payment_id), '') is not null
      and p.paid_at is not null
      and t.action in ('work_request_publication'::public.tariff_action, 'listing_publication'::public.tariff_action)
      and t.duration_days > 0
      and greatest(p.paid_at, coalesce(w.published_at, p.paid_at)) <= now()
      and greatest(p.paid_at, coalesce(w.published_at, p.paid_at))
        + make_interval(days => t.duration_days) > now()
  );
