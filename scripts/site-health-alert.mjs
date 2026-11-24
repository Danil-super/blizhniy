import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { checkSiteHealth } from './check-site-health.mjs';

const reasons = {
  'site-unavailable': 'Сайт не прошёл внешнюю проверку доступности.',
  'readiness-unavailable': 'Сайт отвечает, но проверка готовности не прошла.',
};
const maxAttempts = 3;

export function deliverSiteAlert(result, dependencies) {
  return deliverOperationalAlert(result, dependencies, reasons);
}

export async function deliverOperationalAlert(result, { load, save, send }, incidentReasons) {
  const previous = await load();
  if (result === 'healthy') {
    if (previous) await save(null);
    return 'healthy';
  }
  if (!Object.hasOwn(incidentReasons, result)) throw new Error('Unexpected probe result');
  if (previous?.delivery === 'sending') return 'unknown';
  if (previous && previous.delivery !== 'retry') return previous.delivery;

  const attempt = {
    id: previous?.id ?? randomUUID(),
    result: previous?.result ?? result,
    attempts: (previous?.attempts ?? 0) + 1,
    delivery: 'sending',
  };
  await save(attempt);
  let delivery = 'accepted';
  try {
    await send(attempt.id, attempt.result);
  } catch (error) {
    if (error?.code === 'TEMPORARY' && attempt.attempts < maxAttempts) delivery = 'retry';
    else if (['TEMPORARY', 'AUTH_FAILED', 'REJECTED'].includes(error?.code)) delivery = 'blocked';
    else delivery = 'unknown';
  }
  await save({ ...attempt, delivery });
  return delivery;
}

export function alertStateFile(file, incidentReasons) {
  return {
    async load() {
      let state;
      try { state = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
      if (state === null) return null;
      if (!state || !Object.hasOwn(incidentReasons, state.result) || typeof state.id !== 'string' ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(state.id) || !Number.isInteger(state.attempts) || state.attempts < 1 ||
        state.attempts > maxAttempts || !['sending', 'accepted', 'retry', 'blocked', 'unknown'].includes(state.delivery) ||
        state.delivery === 'retry' && state.attempts >= maxAttempts) throw new Error('Invalid alert state');
      return state;
    },
    async save(state) {
      const temporary = join(dirname(file), randomUUID() + '.tmp');
      await writeFile(temporary, JSON.stringify(state) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, file);
    }
  };
}

async function main() {
  const { createTimewebMailer, normalizeMailAddress } = await import('../src/lib/timeweb-mail.ts');
  const directory = process.env.STATE_DIRECTORY;
  const recipient = normalizeMailAddress(process.env.BLIZHNIY_SITE_ALERT_EMAIL);
  const mailer = createTimewebMailer();
  if (process.argv.length !== 2 || process.env.NODE_ENV !== 'production' || process.getuid?.() === 0 ||
    !directory || !isAbsolute(directory) || directory.includes(':') || !recipient || !mailer) {
    throw new Error('Invalid alert configuration');
  }

  const file = join(directory, 'site-health.json');
  let result = await checkSiteHealth();
  if (result !== 'healthy') {
    await wait(10000);
    result = await checkSiteHealth();
  }
  const delivery = await deliverSiteAlert(result, {
    ...alertStateFile(file, reasons),
    send(id, reason) {
      return mailer.send({
        id,
        to: recipient,
        subject: 'БЛИЖНИЙ — эксплуатационное оповещение',
        text: reasons[reason] + '\nПроверьте https://xn----9sbphbgks4a4a.xn--p1ai',
      });
    },
  });
  console.log(JSON.stringify({ event: 'site_health_alert', result, delivery }));
  if (delivery !== 'accepted' && delivery !== 'healthy') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch {
    console.error(JSON.stringify({ event: 'site_health_alert', delivery: 'unavailable' }));
    process.exitCode = 1;
  }
}
