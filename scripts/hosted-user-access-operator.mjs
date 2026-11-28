import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readActivatedOperatorSocket } from './hosted-operator-socket.mjs';
import { verifyUserAccessDatabase } from './user-access-role.mjs';
import { startLocalUserAccessOperator } from './local-user-access-operator.mjs';
import { startLocalAdminOperator } from './local-admin-operator.mjs';
import { matchesHostedPostgresLocation } from './hosted-postgres-location.mjs';

const require = createRequire(import.meta.url);
const unavailable = () => new Error('Hosted user operator unavailable');

async function main(env=process.env) {
  const tariffs=env.BLIZHNIY_ADMIN_TARIFFS==='hosted-v1';
  const guarded=env.BLIZHNIY_USER_ACCESS_OPERATOR==='hosted-passkey-v1';
  const hosted=guarded?(tariffs?'passkey-tariffs':'passkey'):(tariffs?'tariffs':true);
  if (process.argv.length !== 2 || process.platform !== 'linux' || process.getuid?.() === 0 ||
      env.NODE_ENV !== 'production' || (!guarded && env.BLIZHNIY_USER_ACCESS_OPERATOR !== 'hosted-v1') ||
      (guarded ? env.BLIZHNIY_ADMIN_PASSKEYS !== 'hosted-v1' || env.NODE_OPTIONS !== undefined ||
        env.NODE_TLS_REJECT_UNAUTHORIZED !== undefined : env.BLIZHNIY_ADMIN_PASSKEYS !== undefined) ||
      env.BLIZHNIY_USER_ACCESS_SOCKET !== undefined ||
      (env.BLIZHNIY_ADMIN_TARIFFS !== undefined && !tariffs) ||
      env.BLIZHNIY_LOCAL_PRIMARY !== undefined || env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN !== undefined ||
      !matchesHostedPostgresLocation(env) ||
      env.BLIZHNIY_DB_NAME !== 'blizhniy_prod' || env.BLIZHNIY_DB_USER !== 'blizhniy_user_operator' ||
      env.BLIZHNIY_DB_SSL_MODE !== 'verify-full' || env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ||
      Object.keys(process.env).some(key => key.startsWith('PG'))) throw unavailable();
  const activation = await readActivatedOperatorSocket(env,guarded?
    '/run/blizhniy-user-access-passkey/operator.sock':'/run/blizhniy-user-access/operator.sock');
  const { PostgresDatabase,readPostgresConfig } = require('../compiled/lib/postgres.js');
  const { PostgresAdminUserAccess } = require('../compiled/lib/postgres-admin-user-access.js');
  const { AdminUserAccessError } = require('../compiled/lib/admin-user-access-contract.js');
  const { PostgresAdminTariffs } = require('../compiled/lib/postgres-admin-tariffs.js');
  const { AdminTariffError } = require('../compiled/lib/admin-tariff-contract.js');
  const config = readPostgresConfig(env);
  const db = new PostgresDatabase(new (require('pg').Pool)({
    ...config,max:3,application_name:'blizhniy-user-operator',
    ...(guarded?{options:'-c transaction_timeout=10000',statement_timeout:6000,lock_timeout:1000}:{}),
  }));
  const store = new PostgresAdminUserAccess(db);
  const tariffStore = tariffs ? new PostgresAdminTariffs(db,true) : null;
  const verify = deadline => verifyUserAccessDatabase(db,{ database:config.database,hosted,deadline });
  let closed = false, closing, server, inFlight=0;
  const runtime = {
    async execute(token,command,signal) {
      if (closed || signal?.aborted || guarded && inFlight>=3) throw unavailable();
      inFlight++;
      try {
        const deadline = performance.now()+12000;
        await verify(deadline);
        if (closed || signal?.aborted || performance.now()+6500>deadline) throw unavailable();
        if('resource' in command && tariffStore)return await tariffStore.execute(token,command);
        return await store.execute(token,command);
      } catch(error) {
        if (error instanceof AdminUserAccessError || error instanceof AdminTariffError) throw error;
        throw unavailable();
      } finally { inFlight--; }
    },
    close: () => closing ??= (async()=>{ closed=true; await db.close(); })(),
  };
  const stop = () => { void server?.close().catch(()=>{ process.exitCode=1; }); };
  try {
    await verify();
    server = await (tariffs ? startLocalAdminOperator : startLocalUserAccessOperator)(runtime,{ activation });
    process.once('SIGTERM',stop);
    process.once('SIGINT',stop);
    console.log(JSON.stringify({ event:'hosted_user_operator',status:'ready' }));
    if (await server.done !== 0) throw unavailable();
  } finally {
    process.removeListener('SIGTERM',stop);
    process.removeListener('SIGINT',stop);
    if (server) await server.close(); else await runtime.close();
  }
}

if (process.argv[1] && realpathSync(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch {
    console.error(JSON.stringify({ event:'hosted_user_operator',status:'unavailable' }));
    process.exitCode=1;
  }
}
