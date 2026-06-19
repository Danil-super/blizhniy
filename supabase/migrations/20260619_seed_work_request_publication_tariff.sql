insert into public.tariffs (name, action, price, duration_days, active)
values
  ('Размещение объявления', 'listing_publication', 199, 30, true),
  ('Размещение вакансии', 'vacancy_publication', 499, 30, true),
  ('Размещение заказа', 'work_request_publication', 199, 30, true),
  ('Размещение анкеты специалиста', 'specialist_publication', 299, 30, true),
  ('Реклама в бегущей строке', 'ad_marquee', 299, 7, true),
  ('Отклик на вакансию', 'job_response', 99, null, true),
  ('Участие в ярмарке мастеров', 'fair_participation', 1000, null, true)
on conflict (action) do update
set
  name = excluded.name,
  price = excluded.price,
  duration_days = excluded.duration_days,
  active = excluded.active,
  updated_at = now();
