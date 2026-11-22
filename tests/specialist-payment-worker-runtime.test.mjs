import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test} from 'node:test';

const runtimeUrl = new URL('../scripts/payment-worker-runtime.mjs', import.meta.url);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === runtimeUrl.href && specifier === './payment-reconciliation-role.mjs') {
      return {shortCircuit: true, url: 'data:text/javascript,export const verifyPaymentReconciliationDatabase=(db,options)=>db.preflight(options)'};
    }
    return next(specifier, context);
  },
});
let createPaymentWorkerRuntime;
try { ({createPaymentWorkerRuntime} = await import(runtimeUrl)); } finally { hooks.deregister(); }

const owner = '11111111-1111-4111-8111-111111111111';
const publicationEnv = {
  NODE_ENV: 'production',
  BLIZHNIY_PAYMENT_WORKER: 'account-publication-test', BLIZHNIY_PAYMENT_MODE: 'test',
  BLIZHNIY_PAYMENT_SHOP_ID: '987654', BLIZHNIY_PAYMENT_SECRET_KEY: 'test_synthetic',
  BLIZHNIY_DB_HOST: '17e86f80f26733d39ef4b84d.twc1.net', BLIZHNIY_DB_PORT: '5432',
  BLIZHNIY_DB_NAME: 'blizhniy_prod', BLIZHNIY_DB_USER: 'blizhniy_payment_reconciler',
  BLIZHNIY_DB_PASSWORD: 'synthetic', BLIZHNIY_DB_SSL_MODE: 'verify-full',
  BLIZHNIY_DB_CA_FILE: '/unused/fixture.crt', BLIZHNIY_PAYMENT_TEST_USER_ID: owner,
  BLIZHNIY_AUTH_MODE: 'postgres', BLIZHNIY_AUTH_ORIGIN: 'https://xn----9sbphbgks4a4a.xn--p1ai',
  BLIZHNIY_LISTING_WORKFLOW: 'postmoderation',
};

for (const mode of [undefined, 'disabled', 'account-publication-test']) {
  test('specialist worker and database preflight agree on rollout ' + String(mode), async () => {
    let workerArgs, preflightOptions;
    const runtime = await createPaymentWorkerRuntime({...publicationEnv, ...(mode ? {BLIZHNIY_SPECIALIST_PAYMENT: mode} : {})}, {
      loadModules: () => ({
        readPostgresConfig: () => ({database: publicationEnv.BLIZHNIY_DB_NAME}), Pool: class {},
        PostgresDatabase: class { preflight(options) { preflightOptions = options; } async close() {} },
        createPaymentReconciliationWorker: (...args) => { workerArgs = args; return {}; },
      }),
    });
    try {
      await runtime.preflight();
      const enabled = mode === 'account-publication-test';
      assert.deepEqual(workerArgs.slice(2), enabled ? [undefined, owner, true] : [undefined, owner]);
      assert.deepEqual(preflightOptions, {database: 'blizhniy_prod', publicationTest: true, ...(enabled ? {specialistAccountTest: true} : {})});
    } finally { await runtime.close(); }
  });
}

test('invalid specialist rollout is rejected before loading modules or allocating a pool', async () => {
  let loads = 0;
  const loadModules = () => { loads++; throw Error('unexpected worker module load'); };
  const enabled = {...publicationEnv, BLIZHNIY_SPECIALIST_PAYMENT: 'account-publication-test'};
  for (const patch of [
    {BLIZHNIY_SPECIALIST_PAYMENT: 'unknown'}, {BLIZHNIY_PAYMENT_WORKER: 'queued-test'},
    {BLIZHNIY_PAYMENT_WORKER: 'account-test'}, {BLIZHNIY_PAYMENT_SHOP_ID: 'synthetic-shop'},
    {BLIZHNIY_PAYMENT_SHOP_ID: '01234'}, {BLIZHNIY_PAYMENT_SHOP_ID: '0'},
    {BLIZHNIY_LOCAL_PRIMARY: 'enabled'}, {BLIZHNIY_LOCAL_PRIMARY_ORIGIN: 'https://127.0.0.1:3045'},
    {BLIZHNIY_SPECIALIST_CHECKOUT: 'local-v1'}, {BLIZHNIY_PAYMENT_MODE: 'live'},
  ]) {
    await assert.rejects(createPaymentWorkerRuntime({...enabled, ...patch}, {loadModules}), {message: 'Payment worker configuration unavailable'});
    assert.equal(loads, 0, JSON.stringify(patch));
  }
});

test('a verified response schema drains admitted purchases after web checkout closes', async () => {
  let responseSchema = false;
  const runtime = await createPaymentWorkerRuntime({...publicationEnv, BLIZHNIY_APPLICATION_PAYMENT: 'disabled'}, {
    loadModules: () => ({
      Pool: class {},
      readPostgresConfig: () => ({database: publicationEnv.BLIZHNIY_DB_NAME}),
      PostgresDatabase: class { preflight() { return responseSchema; } async close() {} },
      createPaymentReconciliationWorker: (...args) => ({tick: async () => args}),
    }),
  });
  try {
    await runtime.preflight();
    assert.deepEqual((await runtime.worker.tick()).slice(3), [owner]);
    responseSchema = true;
    await runtime.preflight();
    assert.deepEqual((await runtime.worker.tick()).slice(3), [owner, undefined, true]);
    responseSchema = false;
    await runtime.preflight();
    assert.deepEqual((await runtime.worker.tick()).slice(3), [owner]);
  } finally {
    await runtime.close();
  }
});
