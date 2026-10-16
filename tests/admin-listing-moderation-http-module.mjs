import {createRequire} from 'node:module';import * as boundary from '../src/lib/auth-http.ts';
import * as cookie from '../src/lib/account-cookie.ts';import * as proxy from '../src/lib/trusted-proxy-ip.ts';import * as media from '../src/lib/production-media-http.ts';
import {formModule} from './listing-form-module.mjs';import {moderationModule} from './listing-moderation-module.mjs';import {loadAdminModule} from './admin-module.mjs';
import * as mediaContract from '../src/lib/media-upload-contract.ts';
export const {createAdminListingModerationHandler}=formModule('admin-listing-moderation-http',{
 'node:crypto':createRequire(import.meta.url)('node:crypto'),'./auth-http':boundary,'./account-cookie':cookie,'./trusted-proxy-ip':proxy,
 './postgres-listing-moderation':moderationModule,'./admin-authorization':loadAdminModule('admin-authorization'),'./production-media-http':media,'./media-upload-contract.ts':mediaContract,
});
