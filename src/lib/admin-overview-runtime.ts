import {authJson} from './auth-http';
import {readProductionAuthConfig} from './production-auth-config';
import {getProductionAccountDatabase} from './production-auth-runtime';
import {PostgresAdminOverviewStore} from './postgres-admin-overview';
import {createAdminOverviewHandler} from './admin-overview-http';
export async function handleAdminOverviewRequest(request: Request) {
  try {
    const config = readProductionAuthConfig(); if (!config) return authJson({error: {code: 'NOT_FOUND'}}, 404);
    return await createAdminOverviewHandler(config, async () => {
      const {db, limiter} = await getProductionAccountDatabase(config);
      return {store: new PostgresAdminOverviewStore(db), limiter};
    })(request);
  } catch {return authJson({error: {code: 'OVERVIEW_UNAVAILABLE'}}, 503);}
}
