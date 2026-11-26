import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { alertStateFile, deliverOperationalAlert } from './site-health-alert.mjs';

const role = 'blizhniy_queue_monitor';
const channels = {
  auth_mail: 'auth-mail-backlog',
  business_email: 'business-email-backlog',
  push: 'push-backlog',
  payment_test: 'test-payment-backlog',
};
const reasons = {
  'queue-probe-unavailable': 'Проверка очередей БЛИЖНЕГО недоступна.',
  'auth-mail-backlog': 'Задержка в очереди писем регистрации и восстановления.',
  'business-email-backlog': 'Задержка в очереди уведомлений по почте.',
  'push-backlog': 'Задержка в очереди Push.',
  'test-payment-backlog': 'Задержка или блокировка в очереди сверки TEST-платежей.',
};
const validShop = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);

export async function runQueueHealthAlert({ db, database, shop, directory, recipient, notify }) {
  if (!validShop(shop) || typeof directory !== 'string' || !isAbsolute(directory) || directory.includes(':')) {
    throw new Error('Invalid queue monitor configuration');
  }
  const keys = Object.keys(channels);
  const probes = [];
  try {
    const observed = await db.readTransaction(async tx => {
      const { rows } = await tx.query("select current_user as role,session_user as login,current_database() as database,"+
        "current_setting('transaction_read_only') as read_only,q.* from operations_health.queue_backlog($1) q", [shop]);
      const [state] = rows;
      if (rows.length !== 1 || state.role !== role || state.login !== role || state.database !== database ||
          state.read_only !== 'on' || keys.some(key => typeof state[key] !== 'boolean')) {
        throw new Error('Invalid queue observation');
      }
      return state;
    }, { timeoutMs: 5000 });
    probes.push(['queue-probe', 'healthy'], ...keys.map(key => [key, observed[key] ? channels[key] : 'healthy']));
  } catch {
    probes.push(['queue-probe', 'queue-probe-unavailable']);
  }

  return Promise.all(probes.map(async ([probe, result]) => {
    try {
      const delivery = await deliverOperationalAlert(result, {
        ...alertStateFile(join(directory, probe + '.json'), reasons),
        send: (id, reason) => notify({ id, to: recipient, subject: 'БЛИЖНИЙ — сбой очереди', text: reasons[reason] }),
        sendResolved: (id, reason) => notify({
          id, to: recipient, subject: 'БЛИЖНИЙ — очередь восстановлена', text: 'Проверка снова проходит. Сигнал был таким.\n' + reasons[reason],
        }),
      }, reasons);
      return { probe, result, delivery };
    } catch {
      return { probe, result, delivery: 'unavailable' };
    }
  }));
}

async function main() {
  const env = process.env, shop = env.BLIZHNIY_PAYMENT_SHOP_ID, directory = env.STATE_DIRECTORY;
  if (process.argv.length !== 2 || env.NODE_ENV !== 'production' || process.getuid?.() === 0 ||
      env.BLIZHNIY_QUEUE_HEALTH_ALERT !== 'test-v1' || env.BLIZHNIY_PAYMENT_MODE !== 'test' ||
      env.BLIZHNIY_DB_USER !== role || env.BLIZHNIY_DB_SSL_MODE !== 'verify-full' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      !validShop(shop) || !directory || !isAbsolute(directory) || directory.includes(':')) throw Error('Invalid queue monitor configuration');
  const { createTimewebMailer, normalizeMailAddress } = await import('../src/lib/timeweb-mail.ts');
  const { createPostgresDatabase } = await import('../src/lib/postgres.ts');
  const recipient = normalizeMailAddress(env.BLIZHNIY_QUEUE_ALERT_EMAIL), mailer = createTimewebMailer(env);
  if (!recipient || !mailer) throw Error('Invalid queue monitor mail configuration');
  const db = createPostgresDatabase(env);
  try {
    return await runQueueHealthAlert({ db, database: env.BLIZHNIY_DB_NAME, shop, directory, recipient, notify: mailer.send });
  } finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const audit = { event: 'queue_health_alert', runId: randomUUID(), entryPoint: 'oneshot' };
  try {
    for (const result of await main()) {
      console.log(JSON.stringify({ ...audit, ...result }));
      if (!['healthy', 'accepted'].includes(result.delivery)) process.exitCode = 1;
    }
  } catch {
    console.error(JSON.stringify({ ...audit, delivery: 'unavailable' }));
    process.exitCode = 1;
  }
}
