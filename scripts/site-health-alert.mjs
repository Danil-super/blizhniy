import { randomUUID } from 'node:crypto';
import { open, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { checkBackupReceipt, checkPublicPageSignals, checkSiteCertificate, checkSiteDisk, checkSiteHealth, checkWorkerTimer, parseWorkerTimers, readCaddyTraffic } from './check-site-health.mjs';

const reasons = {
  'site-unavailable': 'Сайт не прошёл внешнюю проверку доступности.',
  'readiness-unavailable': 'Сайт отвечает, но проверка готовности не прошла.',
  'site-slow': 'Проверка доступности или готовности отвечает дольше двух секунд.',
  'public-page-5xx': 'Главная, объявления или поиск возвращают ошибку сервера.',
  'public-page-unavailable': 'Монитор не смог открыть одну из проверяемых публичных страниц.',
  'traffic-5xx': 'Caddy зарегистрировал не менее трёх ответов HTTP 5xx и не менее 0,5% ошибок в трафике сайта между проверками.',
  'tls-expiring': 'Сертификат сайта истекает в течение 14 дней.',
  'tls-unavailable': 'Проверка TLS-соединения с сайтом не прошла.',
  'disk-low': 'На диске приложения осталось не больше 15% доступных блоков или inode.',
  'disk-unavailable': 'Монитор не смог проверить файловую систему приложения.',
  'worker-stopped': 'Таймер фоновой службы остановлен или не планирует запуск.',
  'worker-failed': 'Последний запуск фоновой службы не прошёл.',
  'worker-unavailable': 'Монитор не получил состояние фоновой службы.',
  'backup-stale': 'Проверенная резервная копия старше одного часа.',
  'backup-failed': 'Последняя попытка резервного копирования завершилась ошибкой.',
  'backup-unavailable': 'Монитор не нашёл корректного подтверждения резервной копии.',
};
const recoveryMessages = {
  'site-unavailable': 'Сайт снова проходит проверку доступности.',
  'readiness-unavailable': 'Сайт снова проходит проверку готовности.',
  'site-slow': 'Время ответа проверок снова укладывается в две секунды.',
  'public-page-5xx': 'Главная, объявления и поиск снова отвечают без ошибки сервера.',
  'public-page-unavailable': 'Все проверяемые публичные страницы снова открываются.',
  'traffic-5xx': 'В последнем замере трафика сайта количество или доля HTTP 5xx опустились ниже порога.',
  'tls-expiring': 'Сертификат сайта обновлён. До истечения больше 14 дней.',
  'tls-unavailable': 'TLS-соединение с сайтом снова проходит проверку.',
  'disk-low': 'На диске приложения снова больше 15% доступных блоков и inode.',
  'disk-unavailable': 'Монитор снова может проверить диск приложения.',
  'worker-stopped': 'Таймер фоновой службы снова планирует запуск.',
  'worker-failed': 'Фоновая служба снова проходит проверку.',
  'worker-unavailable': 'Монитор снова видит состояние фоновой службы.',
  'backup-stale': 'Монитор получил подтверждение свежей резервной копии.',
  'backup-failed': 'Резервное копирование снова проходит проверку.',
  'backup-unavailable': 'Монитор снова получает подтверждение резервной копии.',
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
      const state = await readJsonState(file);
      if (state === null) return null;
      if (!validAttempt(state) || !Object.hasOwn(incidentReasons, state.result) ||
        (Object.hasOwn(state, 'resolution') && (state.delivery !== 'accepted' ||
          !validAttempt(state.resolution) || state.resolution.id === state.id || state.resolution.delivery === 'accepted'))) {
        throw new Error('Invalid alert state');
      }
      return state;
    },
    save: state => saveJsonState(file, state),
  };
}

async function readJsonState(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function saveJsonState(file, state) {
  const temporary = join(dirname(file), randomUUID() + '.tmp');
  await writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600, flush: true });
  await rename(temporary, file);
  const directory = await open(dirname(file), 'r');
  try { await directory.sync(); }
  finally { await directory.close(); }
}

function validTraffic(sample) {
  return sample && Number.isFinite(sample.loadedAt) && sample.loadedAt > 0 &&
    Number.isSafeInteger(sample.requests) && Number.isSafeInteger(sample.errors) &&
    sample.errors >= 0 && sample.requests >= sample.errors;
}

async function checkTrafficWindow(directory, traffic, now, deliver) {
  const probe = 'site-traffic-5xx';
  const file = join(directory, 'site-traffic-sample.json');
  const unavailable = { probe, result: 'traffic-unavailable', delivery: 'unavailable' };
  try {
    const sample = await traffic();
    if (!validTraffic(sample)) return unavailable;
    const observedAt = now();
    const previous = await readJsonState(file);
    if (previous !== null && (!validTraffic(previous) || !Number.isSafeInteger(previous.observedAt))) return unavailable;
    let outcome = { probe, result: 'traffic-waiting', delivery: 'healthy' };
    if (previous && previous.loadedAt === sample.loadedAt &&
      observedAt > previous.observedAt && observedAt - previous.observedAt <= 12 * 60 * 1000) {
      const requests = sample.requests - previous.requests;
      const errors = sample.errors - previous.errors;
      if (requests > 0 && errors >= 0 && errors <= requests) {
        outcome = await deliver(probe, errors >= 3 && BigInt(errors) * 200n >= BigInt(requests) ? 'traffic-5xx' : 'healthy');
      }
    }
    if (outcome.delivery !== 'unavailable') await saveJsonState(file, { ...sample, observedAt });
    return outcome;
  } catch {
    return unavailable;
  }
}

async function confirmPublicPages(probe, waitForConfirm) {
  if (!probe) return [null, null];
  const first = await probe();
  if (!first.serverError && !first.unavailable) return ['healthy', 'healthy'];
  await waitForConfirm();
  const second = await probe();
  const confirmed = (signal, reason) => {
    if (!second[signal]) return 'healthy';
    // A fault seen only on the second request needs another confirmation.
    return first[signal] ? reason : null;
  };
  return [confirmed('unavailable', 'public-page-unavailable'), confirmed('serverError', 'public-page-5xx')];
}

async function migratePublicPageState(directory) {
  const previous = alertStateFile(join(directory, 'site-public-pages.json'), reasons);
  const state = await previous.load();
  if (state?.result !== 'public-page-5xx') return;
  const serverError = alertStateFile(join(directory, 'site-public-5xx.json'), reasons);
  if (!await serverError.load()) await serverError.save(state);
  await previous.save(null);
}

export async function runSiteHealthAlert({
  directory, recipient, notify, site = checkSiteHealth, certificate = checkSiteCertificate,
  storage, backup, publicPages, traffic, now = Date.now, workerTimers = [], worker = checkWorkerTimer, waitForConfirm = () => wait(10000),
}) {
  const confirm = async probe => {
    if (!probe) return null;
    const first = await probe();
    if (first === 'healthy') return first;
    await waitForConfirm();
    return probe();
  };
  const [availability, tls, disk, backupResult, [publicResult, publicServerError], ...workerResults] = await Promise.all([
    confirm(site), confirm(certificate), confirm(storage), confirm(backup), confirmPublicPages(publicPages, waitForConfirm),
    ...workerTimers.map(unit => confirm(() => worker(unit))),
  ]);
  const publicStateReady = !publicPages || await migratePublicPageState(directory).then(() => true, () => false);
  const checks = [
    ['site-health', availability === 'site-slow' ? 'healthy' : availability],
    ['site-latency', ['healthy', 'site-slow'].includes(availability) ? availability : null],
    ['site-tls', tls],
    ['site-disk', disk],
    ['site-backup', backupResult],
    ['site-public-pages', publicResult],
    ['site-public-5xx', publicServerError],
    ...workerTimers.map((unit, index) => [unit, workerResults[index]]),
  ];
  const deliver = async (probe, result) => {
    try {
      if (!publicStateReady && (probe === 'site-public-pages' || probe === 'site-public-5xx')) return { probe, result, delivery: 'unavailable' };
      const workerName = workerTimers.includes(probe) ? '\nСлужба ' + probe : '';
      const delivery = await deliverSiteAlert(result, {
        ...alertStateFile(join(directory, probe + '.json'), reasons),
        send: (id, reason) => notify({
          id, to: recipient, subject: 'БЛИЖНИЙ — эксплуатационное оповещение',
          text: reasons[reason] + workerName + '\nПроверьте https://xn----9sbphbgks4a4a.xn--p1ai',
        }),
        sendResolved: (id, reason) => notify({
          id, to: recipient, subject: 'БЛИЖНИЙ — работа восстановлена', text: recoveryMessages[reason] + workerName,
        }),
      });
      return { probe, result, delivery };
    } catch {
      return { probe, result, delivery: 'unavailable' };
    }
  };
  const outcomes = checks.filter(([, result]) => result !== null).map(([probe, result]) => deliver(probe, result));
  if (traffic) outcomes.push(checkTrafficWindow(directory, traffic, now, deliver));
  return Promise.all(outcomes);
}

async function main(runId) {
  const { createTimewebMailer, normalizeMailAddress } = await import('../src/lib/timeweb-mail.ts');
  const directory = process.env.STATE_DIRECTORY;
  const trafficMode = process.env.BLIZHNIY_SITE_ALERT_CADDY_TRAFFIC;
  const diskPath = process.env.BLIZHNIY_SITE_ALERT_DISK_PATH;
  const backupPath = process.env.BLIZHNIY_SITE_ALERT_BACKUP_RECEIPT;
  const workerTimers = parseWorkerTimers(process.env.BLIZHNIY_SITE_ALERT_WORKER_TIMERS);
  const recipient = normalizeMailAddress(process.env.BLIZHNIY_SITE_ALERT_EMAIL);
  const mailer = createTimewebMailer();
  if (process.argv.length !== 2 || process.env.NODE_ENV !== 'production' || process.getuid?.() === 0 ||
    !directory || !isAbsolute(directory) || directory.includes(':') || !recipient || !mailer ||
    (trafficMode !== undefined && trafficMode !== 'enabled') ||
    [diskPath, backupPath].some(path => path !== undefined && !isAbsolute(path))) {
    throw new Error('Invalid alert configuration');
  }

  const results = await runSiteHealthAlert({
    directory, recipient, notify: mailer.send, publicPages: checkPublicPageSignals,
    traffic: trafficMode === 'enabled' ? readCaddyTraffic : undefined,
    storage: diskPath ? () => checkSiteDisk(diskPath) : undefined,
    backup: backupPath ? () => checkBackupReceipt(backupPath) : undefined,
    workerTimers,
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
