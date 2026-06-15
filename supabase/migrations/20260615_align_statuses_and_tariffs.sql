-- Align production Supabase enums and tariffs with the current TypeScript domain model.
-- Safe to run more than once where PostgreSQL supports `if not exists` for enum values.

alter type publication_status add value if not exists 'sold';
alter type tariff_action add value if not exists 'specialist_publication';
alter type tariff_action add value if not exists 'ad_marquee';

insert into tariffs (name, action, price, duration_days, active) values
  ('Размещение анкеты специалиста', 'specialist_publication', 299, 30, true),
  ('Бегущая строка / промо-объявление', 'ad_marquee', 399, 7, true)
on conflict (action) do update set
  name = excluded.name,
  price = excluded.price,
  duration_days = excluded.duration_days,
  active = excluded.active,
  updated_at = now();
