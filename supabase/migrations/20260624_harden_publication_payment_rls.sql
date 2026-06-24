-- Prevent authenticated clients from publishing paid placements directly through the Supabase Data API.
-- Publication is performed by server-side payment/webhook code through the service role, or by admins.

drop policy if exists "Users can insert own listings" on public.listings;
drop policy if exists "Users can update own listings" on public.listings;

create policy "Users can insert own listings" on public.listings
  for insert
  with check (
    author_id = (select auth.uid())
    and status in ('draft', 'pending_payment')
    and is_paid = false
  );

create policy "Users can update own listings" on public.listings
  for update
  using (author_id = (select auth.uid()) or private.is_admin())
  with check (
    private.is_admin()
    or (
      author_id = (select auth.uid())
      and status in ('draft', 'pending_payment', 'archived')
      and is_paid = false
    )
  );

drop policy if exists "Users can insert own vacancies" on public.vacancies;
drop policy if exists "Users can update own vacancies" on public.vacancies;

create policy "Users can insert own vacancies" on public.vacancies
  for insert
  with check (
    author_id = (select auth.uid())
    and status in ('draft', 'pending_payment')
    and is_paid = false
  );

create policy "Users can update own vacancies" on public.vacancies
  for update
  using (author_id = (select auth.uid()) or private.is_admin())
  with check (
    private.is_admin()
    or (
      author_id = (select auth.uid())
      and status in ('draft', 'pending_payment', 'archived')
      and is_paid = false
    )
  );

drop policy if exists "Users can insert own work requests" on public.work_requests;
drop policy if exists "Users can update own work requests" on public.work_requests;

create policy "Users can insert own work requests" on public.work_requests
  for insert
  with check (
    author_id = (select auth.uid())
    and status in ('draft', 'pending_payment')
  );

create policy "Users can update own work requests" on public.work_requests
  for update
  using (author_id = (select auth.uid()) or private.is_admin())
  with check (
    private.is_admin()
    or (
      author_id = (select auth.uid())
      and status in ('draft', 'pending_payment', 'archived')
    )
  );

drop policy if exists "Users can insert own fair applications" on public.fair_applications;
drop policy if exists "Users can update own fair applications" on public.fair_applications;

create policy "Users can insert own fair applications" on public.fair_applications
  for insert
  with check (
    user_id = (select auth.uid())
    and status in ('draft', 'pending_payment')
    and payment_status in ('created', 'pending')
  );

create policy "Users can update own fair applications" on public.fair_applications
  for update
  using (user_id = (select auth.uid()) or private.is_admin())
  with check (
    private.is_admin()
    or (
      user_id = (select auth.uid())
      and status in ('draft', 'pending_payment', 'archived')
      and payment_status in ('created', 'pending')
    )
  );
