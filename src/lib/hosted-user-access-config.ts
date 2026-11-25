import { readLocalTariffOperatorConfig, readLocalUserAccessOperatorConfig } from './local-user-access-config.ts';
import { readCheckoutCancellationEnabled } from './checkout-cancellation-contract.ts';
import { productionAuthOrigin } from './production-auth-config.ts';

export const hostedUserAccessSocket = '/run/blizhniy-user-access/operator.sock';

export function readUserAccessOperatorConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.BLIZHNIY_USER_ACCESS_OPERATOR !== 'hosted-v1') {
    const local = readLocalUserAccessOperatorConfig(env);
    return local ? { mode:'local' as const, ...local } : null;
  }
  if (typeof window !== 'undefined' || env.NODE_ENV !== 'production' ||
      env.BLIZHNIY_AUTH_MODE !== 'postgres' || env.BLIZHNIY_AUTH_ORIGIN !== productionAuthOrigin ||
      env.BLIZHNIY_LOCAL_PRIMARY !== undefined || env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN !== undefined ||
      env.BLIZHNIY_USER_ACCESS_SOCKET !== undefined) {
    throw new Error('Invalid hosted user access configuration');
  }
  return { mode:'hosted' as const, socketPath:hostedUserAccessSocket };
}

export function readTariffOperatorConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.BLIZHNIY_ADMIN_TARIFFS !== 'hosted-v1') {
    const local = readLocalTariffOperatorConfig(env);
    return local ? { mode:'local' as const, ...local } : null;
  }
  const operator = readUserAccessOperatorConfig(env);
  if (operator?.mode !== 'hosted' || env.BLIZHNIY_CHECKOUT_CANCELLATION !== 'hosted-test-v1' || !readCheckoutCancellationEnabled(env)) {
    throw new Error('Invalid hosted tariff configuration');
  }
  return operator;
}
