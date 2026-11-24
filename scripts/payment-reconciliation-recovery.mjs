// Explicit TEST operator command. Session input travels only over stdin.
import { validPlainText } from '../src/lib/cabinet-field-validation.ts';
import { hashSessionToken } from '../src/lib/identity.ts';
import { parseListingDraftCursor, parseListingDraftId } from '../src/lib/listing-draft-contract.ts';
import { createPostgresDatabase } from '../src/lib/postgres.ts';

const login = 'blizhniy_reconciliation_operator';
const outcomes = {
  '42501': 'ADMIN_REQUIRED',
  '22023': 'INVALID_INPUT',
  PRQ01: 'PAYMENT_UNAVAILABLE',
  PRQ02: 'RECOVERY_CONFLICT',
  '55P03': 'RECOVERY_BUSY',
};

function queueStatus(result) {
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const codes = ['provider_pending', 'capture_required', 'processing_unavailable', 'publication_blocked', 'attempts_exhausted', 'phone_required'];
  if (!result || Object.keys(result).length !== 5 || !count(result.queuedOrProcessing) ||
      !count(result.waitingPhone) || !count(result.blocked) ||
      (result.oldestQueueAgeSeconds !== null && !count(result.oldestQueueAgeSeconds)) ||
      !Array.isArray(result.recentBlocked) || result.recentBlocked.length > 50 ||
      result.recentBlocked.length > result.blocked) throw Error();
  for (const row of result.recentBlocked) {
    if (!row || Object.keys(row).length !== 5 || !count(row.attempts) || row.attempts > 12 ||
        !codes.includes(row.code) || typeof row.alreadyRecovered !== 'boolean' || !count(row.queueAgeSeconds)) throw Error();
    parseListingDraftId(row.intentId);
  }
  return result;
}

let db;
try {
  const env = process.env, shop = env.BLIZHNIY_PAYMENT_SHOP_ID;
  if (process.argv.length !== 2 || process.stdin.isTTY || env.BLIZHNIY_RECONCILIATION_RECOVERY !== 'test-v1' ||
      env.BLIZHNIY_PAYMENT_MODE !== 'test' || env.BLIZHNIY_DB_USER !== login || !/^[a-zA-Z0-9_-]{1,64}$/.test(shop ?? '') ||
      env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error();

  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 4096) throw Error();
    chunks.push(chunk);
  }
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  const observe = body?.action === 'status';
  const keys = ['action', 'sessionToken', 'expectedAdminId', ...(observe ? [] : ['requestId', 'intentId', 'reason'])];
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length ||
      keys.some(key => !Object.hasOwn(body, key)) || !['schedule', 'read', 'status'].includes(body.action)) throw Error();
  const hash = hashSessionToken(body.sessionToken);
  const admin = parseListingDraftId(body.expectedAdminId);
  let request, intent;
  if (!observe) {
    if (typeof body.reason !== 'string' || body.reason !== body.reason.trim() || body.reason.length < 1 ||
        body.reason.length > 500 || !validPlainText(body.reason)) throw Error();
    request = parseListingDraftId(body.requestId);
    intent = parseListingDraftId(body.intentId);
  }
  if (!hash) throw Error();
  db = createPostgresDatabase();
  const result = await db.transaction(async tx => {
    const role = (await tx.query(`select current_user=session_user and current_user=$1 and rolcanlogin and
      not (rolsuper or rolcreatedb or rolcreaterole or rolinherit or rolreplication or rolbypassrls) and
      not exists(select 1 from pg_auth_members m where m.member=r.oid or m.roleid=r.oid) as admitted
      from pg_roles r where rolname=current_user`, [login])).rows[0];
    if (role?.admitted !== true) throw Error();
    if (observe) return (await tx.query('select app.read_payment_reconciliation_recovery_status($1,$2,$3) as result',
      [hash, admin, shop])).rows[0]?.result;
    return (await tx.query('select app.recover_payment_reconciliation($1,$2,$3,$4,$5,$6,$7) as result',
      [hash, admin, request, intent, shop, body.reason, body.action === 'schedule'])).rows[0]?.result;
  });
  if (observe) {
    console.log(JSON.stringify(queueStatus(result)));
  } else if (result === null && body.action === 'read') {
    console.log(JSON.stringify({ state: 'not_found' }));
  } else {
    if (!result || Object.keys(result).length !== 4 || result.requestId !== request || result.intentId !== intent ||
        result.state !== 'scheduled' || !parseListingDraftCursor({ id: request, updatedAt: result.recordedAt })) throw Error();
    console.log(JSON.stringify(result));
  }
} catch (error) {
  const code = typeof error?.code === 'string' && Object.hasOwn(outcomes, error.code) ? outcomes[error.code] : 'RECOVERY_UNCONFIRMED';
  console.error(JSON.stringify({ code }));
  process.exitCode = 1;
} finally {
  await db?.close();
}
