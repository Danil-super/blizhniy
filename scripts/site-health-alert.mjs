import { randomUUID } from 'node:crypto';
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { checkSiteCertificate, checkSiteDisk, checkSiteHealth } from './check-site-health.mjs';

const reasons = {
  'site-unavailable': 'Сайт не прошёл внешнюю проверку доступности.',
  'readiness-unavailable': 'Сайт отвечает, но проверка готовности не прошла.',
  'site-slow': 'Проверка доступности или готовности отвечает дольше двух секунд.',
  'tls-expiring': 'Сертификат сайта истекает в течение 14 дней.',
  'tls-unavailable': 'Проверка TLS-соединения с сайтом не прошла.',
  'disk-low': 'На диске приложения осталось не больше 15% доступных блоков или inode.',
  'disk-unavailable': 'Монитор не смог проверить файловую систему приложения.',
};
const recoveryMessages = {
  'site-unavailable': 'Сайт снова проходит проверку доступности.',
  'readiness-unavailable': 'Сайт снова проходит проверку готовности.',
  'site-slow': 'Время ответа проверок снова укладывается в две секунды.',
  'tls-expiring': 'Сертификат сайта обновлён. До истечения больше 14 дней.',
  'tls-unavailable': 'TLS-соединение с сайтом снова проходит проверку.',
  'disk-low': 'На диске приложения снова больше 15% доступных блоков и inode.',
  'disk-unavailable': 'Монитор снова может проверить диск приложения.',
};
const maxAttempts = 3;

export function deliverSiteAlert(result, dependencies) {
  return deliverOperationalAlert(result, dependencies, reasons);
}

export async function deliverOperationalAlert(result, { load, save, send, sendResolved }, incidentReasons) {
  const stored = await load();
  if (result === 'healthy') {
    if (!stored) return 'healthy';
    if (!sendResolved || stored.delivery !== 'accepted') {
      await save(null);
      return 'healthy';
    }
    const previous = stored.resolution;
    if (previous?.delivery === 'sending') return 'unknown';
    if (previous && previous.delivery !== 'retry') return previous.delivery;
    const resolution = startAttempt(previous);
    await save({ ...stored, resolution });
    const delivery = await dispatchAttempt(resolution, stored.result, sendResolved);
    await save(delivery === 'accepted' ? null : { ...stored, resolution: { ...resolution, delivery } });
    return delivery === 'accepted' ? 'healthy' : delivery;
  }
  if (!Object.hasOwn(incidentReasons, result)) throw new Error('Unexpected probe result');
  const previous = stored?.resolution ? null : stored;
  if (previous?.delivery === 'sending') return 'unknown';
  if (previous && previous.delivery !== 'retry') return previous.delivery;

  const attempt = { ...startAttempt(previous), result: previous?.result ?? result };
  await save(attempt);
  const delivery = await dispatchAttempt(attempt, attempt.result, send);
  await save({ ...attempt, delivery });
  return delivery;
}

function startAttempt(previous) {
  return { id: previous?.id ?? randomUUID(), attempts: (previous?.attempts ?? 0) + 1, delivery: 'sending' };
}

async function dispatchAttempt(attempt, reason, send) {
  try {
    await send(attempt.id, reason);
    return 'accepted';
  } catch (error) {
    if (error?.code === 'TEMPORARY' && attempt.attempts < maxAttempts) return 'retry';
    if (['TEMPORARY', 'AUTH_FAILED', 'REJECTED'].includes(error?.code)) return 'blocked';
    return 'unknown';
  }
}

function validAttempt(state) {
  return state && typeof state.id === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(state.id) &&
    Number.isInteger(state.attempts) && state.attempts >= 1 && state.attempts <= maxAttempts &&
    ['sending', 'accepted', 'retry', 'blocked', 'unknown'].includes(state.delivery) &&
    (state.delivery !== 'retry' || state.attempts < maxAttempts);
}

export function alertStateFile(file, incidentReasons) {
  return {
    async load() {
      let state;
      try { state = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
      if (state === null) return null;
      if (!validAttempt(state) || !Object.hasOwn(incidentReasons, state.result) ||
        (Object.hasOwn(state, 'resolution') && (state.delivery !== 'accepted' ||
          !validAttempt(state.resolution) || state.resolution.id === state.id || state.resolution.delivery === 'accepted'))) {
        throw new Error('Invalid alert state');
      }
      return state;
    },
    async save(state) {
      const temporary = join(dirname(file), randomUUID() + '.tmp');
      await writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600, flush: true });
      await rename(temporary, file);
      const directory = await open(dirname(file), 'r');
      try { await directory.sync(); }
      finally { await directory.close(); }
    }
  };
}

export async function runSiteHealthAlert({
  directory, recipient, notify, site = checkSiteHealth, certificate = checkSiteCertificate,
  storage, waitForConfirm = () => wait(10000),
}) {
  const confirm = async probe => {
    if (!probe) return null;
    const first = await probe();
    if (first === 'healthy') return first;
    await waitForConfirm();
    return probe();
  };
  const [availability, tls, disk] = await Promise.all([confirm(site), confirm(certificate), confirm(storage)]);
  const checks = [
    ['site-health', availability === 'site-slow' ? 'healthy' : availability],
    ['site-latency', ['healthy', 'site-slow'].includes(availability) ? availability : null],
    ['site-tls', tls],
    ['site-disk', disk],
  ];
  return Promise.all(checks.filter(([, result]) => result !== null).map(async ([probe, result]) => {
    try {
      const delivery = await deliverSiteAlert(result, {
        ...alertStateFile(join(directory, probe + '.json'), reasons),
        send: (id, reason) => notify({
          id, to: recipient, subject: 'БЛИЖНИЙ — эксплуатационное оповещение',
          text: reasons[reason] + '\nПроверьте https://xn----9sbphbgks4a4a.xn--p1ai',
        }),
        sendResolved: (id, reason) => notify({
          id, to: recipient, subject: 'БЛИЖНИЙ — работа восстановлена', text: recoveryMessages[reason],
        }),
      });
      return { probe, result, delivery };
    } catch {
      return { probe, result, delivery: 'unavailable' };
    }
  }));
}

async function main(runId) {
  const { createTimewebMailer, normalizeMailAddress } = await import('../src/lib/timeweb-mail.ts');
  const directory = process.env.STATE_DIRECTORY;
  const diskPath = process.env.BLIZHNIY_SITE_ALERT_DISK_PATH;
  const recipient = normalizeMailAddress(process.env.BLIZHNIY_SITE_ALERT_EMAIL);
  const mailer = createTimewebMailer();
  if (process.argv.length !== 2 || process.env.NODE_ENV !== 'production' || process.getuid?.() === 0 ||
    !directory || !isAbsolute(directory) || directory.includes(':') || !recipient || !mailer ||
    (diskPath !== undefined && !isAbsolute(diskPath))) {
    throw new Error('Invalid alert configuration');
  }

  const results = await runSiteHealthAlert({
    directory, recipient, notify: mailer.send,
    storage: diskPath ? () => checkSiteDisk(diskPath) : undefined,
  });
  for (const result of results) {
    console.log(JSON.stringify({ event: 'site_health_alert', runId, entryPoint: 'oneshot', ...result }));
    if (!['accepted', 'healthy'].includes(result.delivery)) process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const runId = randomUUID();
  try { await main(runId); }
  catch {
    console.error(JSON.stringify({ event: 'site_health_alert', runId, entryPoint: 'oneshot', delivery: 'unavailable' }));
    process.exitCode = 1;
  }
}
