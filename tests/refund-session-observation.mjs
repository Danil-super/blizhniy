import { setTimeout as delay } from 'node:timers/promises';

// pg.Pool.end() can resolve before PostgreSQL has received the socket termination.
export async function remainingRefundSessions(admin, applicationNames) {
  const deadline = performance.now() + 1000;
  for (;;) {
    const result = await admin.query(
      'select count(*)::int as remaining from pg_catalog.pg_stat_activity where application_name = any($1::text[])',
      [applicationNames],
    );
    const remaining = result.rows[0].remaining;
    if (remaining === 0 || performance.now() >= deadline) return remaining;
    await delay(20);
  }
}
