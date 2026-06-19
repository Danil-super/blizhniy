insert into public.tariffs (name, action, price, duration_days, active)
values ('Размещение заказа', 'work_request_publication', 199, 30, true)
on conflict (action) do update
set
  name = excluded.name,
  price = excluded.price,
  duration_days = excluded.duration_days,
  active = excluded.active;
