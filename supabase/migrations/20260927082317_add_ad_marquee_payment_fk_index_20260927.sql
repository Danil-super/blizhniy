-- The FK needs a leading payment_id index when payments are updated or deleted.
-- Existing status and user indexes do not cover this lookup.
create index if not exists ad_marquee_placements_payment_id_idx
  on public.ad_marquee_placements (payment_id);
