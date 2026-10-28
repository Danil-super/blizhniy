// Immutable known migration suffix. No I/O beyond repository sources, no credentials/executor.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const names=['0026-listing-blocks.sql','0027-listing-owner-visibility.sql','0028-listing-restore-entitlement.sql','0029-listing-owner-removals.sql','0030-application-withdrawals.sql','0031-telegram-phone.sql','0032-phone-publication-wait.sql'];
export function getCabinetMigrationPlan(){return names.map(name=>{
 const source=readFileSync(new URL('../database/migrations/'+name,import.meta.url),'utf8');
 if(!/^begin;$/m.test(source)||!/commit;\s*$/.test(source))throw Error('Invalid cabinet migration');
 return{name,sha256:createHash('sha256').update(source).digest('hex'),sql:source.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,'')};
});}
export function getCabinetGrantPlan(){return[
 'grant select on app.listing_blocks,app.listing_block_mail to blizhniy_runtime',
 'grant insert(listing_id,blocked_by,blocked_revision,reason) on app.listing_blocks to blizhniy_runtime',
 'grant insert(listing_id,user_id,subject,body) on app.listing_block_mail to blizhniy_runtime',
 'grant select on app.listing_owner_removals,app.application_withdrawals to blizhniy_runtime',
 'grant insert(listing_id,owner_id,removed_revision) on app.listing_owner_removals to blizhniy_runtime',
 'grant insert(application_id,owner_id,withdrawn_revision) on app.application_withdrawals to blizhniy_runtime',
 'grant select(listing_id) on app.listing_blocks to blizhniy_payment_reconciler',
 'grant update(status) on app.listings to blizhniy_runtime',
 readFileSync(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8').replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''),
];}
