import { createHash, randomBytes } from 'node:crypto';
import { withAppSessionTransaction } from './app-session-transaction';
import { hashSessionToken } from './identity';
import { createDefaultCabinetProfile } from './cabinet-profile';
import { normalizeProfilePhone, PhoneVerificationError, phoneReturnPath } from './phone-verification-contract.ts';
import type { PostgresDatabase, PostgresQueries } from './postgres';
import type { TelegramPhoneClaims, TelegramPhoneAttemptSecrets } from './telegram-phone-oidc.ts';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const revision = (value: Record<string, unknown>) => hash(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))));
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export {phoneReturnPath} from './phone-verification-contract.ts';

type Attempt = { id: string; state: string; nonce: string; verifier: string; clientId: string; returnPath: string; candidatePhone: string | null; candidateSubject: string | null };
const columns = `id,state,nonce,verifier,client_id as "clientId",return_path as "returnPath",candidate_phone as "candidatePhone",candidate_subject as "candidateSubject"`;
export class PostgresPhoneVerificationStore {
  private readonly db: Pick<PostgresDatabase, 'transaction'>;
  constructor(db: Pick<PostgresDatabase, 'transaction'>) { this.db = db; }
  private async scope(tx: PostgresQueries, owner: string) {
    await tx.query("select set_config('app.phone_user_id',$1,true)", [owner]);
  }
  private async policy(tx: PostgresQueries) {
    const row = (await tx.query<{ available: boolean; required: boolean }>('select available,required from app.phone_verification_policy where singleton')).rows[0];
    if (!row?.available) throw new PhoneVerificationError('UNAVAILABLE');
    return row;
  }
  private run<T>(token: string, owner: string | null, work: (tx: PostgresQueries, id: string) => Promise<T>) {
    return withAppSessionTransaction(this.db, token, async (tx, user) => {
      if (owner !== null && user.id !== owner) throw new PhoneVerificationError('INVALID_ATTEMPT');
      await this.scope(tx, user.id); await this.policy(tx);
      return work(tx, user.id);
    });
  }
  async status(token: string, owner: string) {
    return this.run(token, owner, async (tx, id) => {
      const binding = (await tx.query<{ phone: string }>('select phone from app.telegram_phone_bindings where user_id=$1', [id])).rows[0];
      const profile = (await tx.query<{ phone: string | null }>("select profile->>'phone' as phone from app.cabinet_profiles where user_id=$1", [id])).rows[0];
      const verified = Boolean(binding && binding.phone === normalizeProfilePhone(profile?.phone ?? ''));
      return { available: true, required: (await this.policy(tx)).required, verified, phone: profile?.phone ?? '', verifiedPhone: verified ? binding.phone : null };
    });
  }
  async start(token: string, owner: string, clientId: string, returnTo: unknown) {
    const returnPath = phoneReturnPath(returnTo), state = randomBytes(32).toString('hex'), nonce = randomBytes(32).toString('hex'), verifier = randomBytes(32).toString('base64url');
    return this.run(token, owner, async (tx, id) => {
      const count = (await tx.query<{ n: number }>("select count(*)::integer as n from app.telegram_phone_attempts where user_id=$1 and created_at>clock_timestamp()-interval '15 minutes'", [id])).rows[0]?.n;
      if (count === undefined || count >= 5) throw new PhoneVerificationError('RATE_LIMITED');
      // Expired attempts contain no usable callback; bounded cleanup is owner scoped.
      await tx.query(`delete from app.telegram_phone_attempts where id in(select id from app.telegram_phone_attempts
       where user_id=$1 and expires_at<clock_timestamp()-interval '24 hours' order by expires_at limit 100)`, [id]);
      const attempt = (await tx.query<{ id: string }>(`insert into app.telegram_phone_attempts(user_id,session_hash,state_hash,client_id,nonce,verifier,return_path)
       values($1,$2,$3,$4,$5,$6,$7) returning id`, [id, hashSessionToken(token), hash(state), clientId, nonce, verifier, returnPath])).rows[0];
      if (!attempt) throw new PhoneVerificationError('UNAVAILABLE');
      return { id: attempt.id, state, nonce, verifier };
    });
  }
  async claim(token: string, state: string, clientId: string): Promise<Attempt & TelegramPhoneAttemptSecrets> {
    if (!/^[a-f0-9]{64}$/.test(state)) throw new PhoneVerificationError('INVALID_ATTEMPT');
    return this.run(token, null, async (tx, id) => {
      const attempt = (await tx.query<Attempt>(`select ${columns} from app.telegram_phone_attempts
       where state_hash=$1 and user_id=$2 and session_hash=$3 and state='pending' and expires_at>clock_timestamp() for update`, [hash(state), id, hashSessionToken(token)])).rows[0];
      if (!attempt || attempt.clientId !== clientId) throw new PhoneVerificationError('INVALID_ATTEMPT');
      await tx.query("update app.telegram_phone_attempts set state='exchanging' where id=$1", [attempt.id]);
      return { ...attempt, state, nonce: attempt.nonce, verifier: attempt.verifier };
    });
  }
  async finishExchange(token: string, id: string, claims: TelegramPhoneClaims | null) {
    return this.run(token, null, async (tx, owner) => {
      const changed = await tx.query(`update app.telegram_phone_attempts set state=$4,candidate_phone=$5,candidate_subject=$6,token_hash=$7
       where id=$1 and user_id=$2 and session_hash=$3 and state='exchanging' and expires_at>clock_timestamp()`,
      [id, owner, hashSessionToken(token), claims ? 'review' : 'failed', claims?.phone ?? null, claims?.subject ?? null, claims?.tokenHash ?? null]);
      if (changed.rowCount !== 1) throw new PhoneVerificationError('INVALID_ATTEMPT');
      return { id };
    });
  }
  async review(token: string, owner: string, id: string) {
    if (!uuid.test(id)) throw new PhoneVerificationError('INVALID_INPUT');
    return this.run(token, owner, async (tx, user) => {
      const attempt = (await tx.query<Attempt>(`select ${columns} from app.telegram_phone_attempts
       where id=$1 and user_id=$2 and session_hash=$3 and state in ('review','confirmed') and expires_at>clock_timestamp()`, [id, user, hashSessionToken(token)])).rows[0];
      if (!attempt?.candidatePhone) throw new PhoneVerificationError('INVALID_ATTEMPT');
      const row = (await tx.query<{ profile: Record<string, unknown> }>('select profile from app.cabinet_profiles where user_id=$1', [user])).rows[0];
      const currentPhone = typeof row?.profile.phone === 'string' ? row.profile.phone : '';
      if(attempt.state==='confirmed'){
        const binding=(await tx.query<{phone:string}>('select phone from app.telegram_phone_bindings where user_id=$1',[user])).rows[0];
        if(binding?.phone!==attempt.candidatePhone||normalizeProfilePhone(currentPhone)!==binding.phone)throw new PhoneVerificationError('INVALID_ATTEMPT');
      }
      return { id, phone: attempt.candidatePhone, currentPhone, replaceRequired: Boolean(currentPhone && normalizeProfilePhone(currentPhone) !== attempt.candidatePhone),
        profileRevision: row ? revision(row.profile) : null, confirmed: attempt.state === 'confirmed', returnTo: phoneReturnPath(attempt.returnPath) };
    });
  }
  async confirm(token: string, owner: string, id: string, expectedRevision: string | null, acceptReplacement: boolean) {
    if (!uuid.test(id) || expectedRevision !== null && !/^[a-f0-9]{64}$/.test(expectedRevision) || typeof acceptReplacement !== 'boolean') throw new PhoneVerificationError('INVALID_INPUT');
    try {
      return await this.run(token, owner, async (tx, user) => {
        const attempt = (await tx.query<Attempt>(`select ${columns} from app.telegram_phone_attempts
         where id=$1 and user_id=$2 and session_hash=$3 and state='review' and expires_at>clock_timestamp() for update`, [id, user, hashSessionToken(token)])).rows[0];
        if (!attempt?.candidatePhone || !attempt.candidateSubject) throw new PhoneVerificationError('INVALID_ATTEMPT');
        const current = (await tx.query<{ profile: Record<string, unknown> }>('select profile from app.cabinet_profiles where user_id=$1 for update', [user])).rows[0];
        if ((current ? revision(current.profile) : null) !== expectedRevision) throw new PhoneVerificationError('PROFILE_CHANGED');
        const oldPhone = typeof current?.profile.phone === 'string' ? current.profile.phone : '';
        if (oldPhone && normalizeProfilePhone(oldPhone) !== attempt.candidatePhone && !acceptReplacement) throw new PhoneVerificationError('REPLACEMENT_REQUIRED');
        const defaults = Object.fromEntries(Object.entries(createDefaultCabinetProfile({ name: 'Пользователь', email: '' })).filter(([key]) => !['email','phoneVerified','verifiedPhone'].includes(key)));
        const profile = { ...(current?.profile ?? defaults), phone: attempt.candidatePhone };
        await tx.query(current ? 'update app.cabinet_profiles set profile=$2::jsonb,updated_at=clock_timestamp() where user_id=$1'
          : 'insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)', [user, JSON.stringify(profile)]);
        await tx.query(`insert into app.telegram_phone_bindings(user_id,phone,telegram_subject) values($1,$2,$3)
         on conflict(user_id) do update set phone=excluded.phone,telegram_subject=excluded.telegram_subject,source='telegram',confirmed_at=clock_timestamp()`, [user, attempt.candidatePhone, attempt.candidateSubject]);
        const confirmed = await tx.query(`update app.telegram_phone_attempts set state='confirmed'
          where id=$1 and state='review' and expires_at>clock_timestamp()`, [id]);
        if (confirmed.rowCount !== 1) throw new PhoneVerificationError('INVALID_ATTEMPT');
        return { confirmed: true, phone: attempt.candidatePhone, returnTo: phoneReturnPath(attempt.returnPath) };
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new PhoneVerificationError('PHONE_CONFLICT');
      throw error;
    }
  }
  async unlink(token: string, owner: string) {
    return this.run(token, owner, async (tx, id) => {
      await tx.query('delete from app.telegram_phone_bindings where user_id=$1', [id]);
      await tx.query(`update app.telegram_phone_attempts set state=case when state='exchanging' then 'failed' else 'cancelled' end,
        candidate_phone=null,candidate_subject=null,token_hash=null where user_id=$1 and state in ('pending','exchanging','review')`,[id]);
      return { confirmed: false };
    });
  }
}
