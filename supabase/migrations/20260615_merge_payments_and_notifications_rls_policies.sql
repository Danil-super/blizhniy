-- Merge overlapping permissive RLS policies on payments and notifications.
-- Access rules remain equivalent: owners can read/create their own payment rows, users can read own notifications, and admins can manage all rows.
-- Applied to project jzdhpphcelljmjfwrxfi on 2026-06-15.

-- payments
alter policy "Users can read own payments" on public.payments
  using (user_id = (select auth.uid()) or public.is_admin());

alter policy "Users can create own payments" on public.payments
  with check (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins can manage payments" on public.payments;

create policy "Admins can update payments" on public.payments
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete payments" on public.payments
  for delete
  using (public.is_admin());

-- notifications
alter policy "Users can read own notifications" on public.notifications
  using (user_id = (select auth.uid()) or public.is_admin());

drop policy if exists "Admins can manage notifications" on public.notifications;

create policy "Admins can insert notifications" on public.notifications
  for insert
  with check (public.is_admin());

create policy "Admins can update notifications" on public.notifications
  for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins can delete notifications" on public.notifications
  for delete
  using (public.is_admin());
