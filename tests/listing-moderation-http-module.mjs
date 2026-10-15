import {createRequire} from 'node:module';
import * as boundary from '../src/lib/auth-http.ts';import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';
import {formModule} from './listing-form-module.mjs';import {moderationModule} from './listing-moderation-module.mjs';
export const {createProductionListingModerationHandler}=formModule('production-listing-moderation-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':boundary,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,'./postgres-listing-moderation':moderationModule,
});
