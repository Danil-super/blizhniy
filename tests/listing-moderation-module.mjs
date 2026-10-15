import {formModule} from './listing-form-module.mjs';
import {loadAdminModule} from './admin-module.mjs';
export const moderationModule=formModule('postgres-listing-moderation',{
 './postgres-listing-form':formModule('postgres-listing-form'),
 './admin-authorization':loadAdminModule('admin-authorization'),
});
