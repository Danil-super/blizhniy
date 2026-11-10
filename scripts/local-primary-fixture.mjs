import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,chmod} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
import pg from 'pg';
import {bootstrapPostgres,getBootstrapPlan} from './bootstrap-postgres.mjs';
import {hashPassword} from '../src/lib/identity.ts';
import {createDefaultCabinetProfile} from '../src/lib/cabinet-profile.ts';
import {localPrimaryImage,readLocalPrimaryState,validateLocalPrimaryState,validateLocalPrimaryContainer,validateLocalPrimaryContainerDefinition} from './local-primary-config.mjs';
import {getInteractionGrantPlan} from './grant-interactions.mjs';
import {getLocalTelegramMigrations,withoutTransaction} from './local-telegram-migrations.mjs';
import {getLocalDeletionMigrations} from './local-deletion-schema.mjs';
import {getLocalCheckoutEditMigrations} from './local-checkout-edit-schema.mjs';
import {getLocalApplicationContactMigrations} from './local-application-contact-schema.mjs';
import {getLocalBookingLifecycleMigrations} from './local-booking-lifecycle-schema.mjs';
import {getLocalWorkOwnerActionsMigrations} from './local-work-owner-actions-schema.mjs';

const root=realpathSync(fileURLToPath(new URL('..',import.meta.url))),run=promisify(execFile);
export const stateDirectory=join(homedir(),'.local','state','blizhniy','local-primary-private');
export const stateFile=join(stateDirectory,'state.json');
export const docker=async(args,env={})=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',...env},timeout:30000,maxBuffer:2*1024*1024})).stdout.trim();
export async function prepareLocalPrimaryFixture(){
 await mkdir(stateDirectory,{mode:0o700,recursive:true});
 try{
  const saved=readLocalPrimaryState(stateFile,root),metadata=JSON.parse(await docker(['inspect',saved.containerId]))[0];
  validateLocalPrimaryContainerDefinition(metadata,saved);
  const ready=JSON.parse(await readFile(join(stateDirectory,'ready.json'),'utf8'));
  if(ready.version!==1||ready.containerId!==saved.containerId)throw Error('Incomplete local primary fixture; inspect the owned setup before retrying');
  if(!metadata.State.Running)await docker(['start',saved.containerId]);
  const running=JSON.parse(await docker(['inspect',saved.containerId]))[0];
  const state=validateLocalPrimaryState({...saved,dbPort:Number(running.NetworkSettings?.Ports?.['5432/tcp']?.[0]?.HostPort)},root);
  validateLocalPrimaryContainer(running,state);
  const deadline=Date.now()+20000;
  for(;;){try{await docker(['exec',state.containerId,'pg_isready','-h','127.0.0.1','-U','postgres','-d',state.database]);break;}
   catch{if(Date.now()>deadline)throw Error('Local stand database not ready');await new Promise(resolve=>setTimeout(resolve,150));}}
  await verifyLocalPrimarySchema(state);
  if(state.dbPort!==saved.dbPort)await writeFile(stateFile,JSON.stringify(state),{mode:0o600});
  return state;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const name='blizhniy-primary-local-'+createHash('sha256').update(root).digest('hex').slice(0,12);
 if(await docker(['container','ls','--all','--filter',`name=^/${name}$`,'--format','{{.ID}}']))throw Error('Local stand already exists without trusted state; refusing adoption');
 const ownerPassword=randomBytes(32).toString('hex'),runtimePassword=randomBytes(32).toString('hex'),rateSecret=randomBytes(32).toString('hex');
 const id=await docker(['run','--detach','--pull','never','--name',name,'--label',`blizhniy.primary-local=${root}`,
  '--memory','512m','--cpus','1','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_prod',localPrimaryImage],{POSTGRES_PASSWORD:ownerPassword});
 const metadata=JSON.parse(await docker(['inspect',id]))[0];
 const state={version:1,project:root,origin:'https://127.0.0.1:3045',upstreamPort:3046,containerId:id,containerName:name,
  dbPort:Number(metadata.NetworkSettings.Ports['5432/tcp'][0].HostPort),database:'blizhniy_prod',runtimePassword,ownerPassword,rateSecret};
 validateLocalPrimaryContainer(metadata,state);
 // Save recovery evidence before any schema write; an interrupted preparation
 // cannot silently create/adopt a second database or retry unknown mutations.
 await writeFile(stateFile,JSON.stringify(state),{mode:0o600,flag:'wx'});
 const deadline=Date.now()+20000;
 for(;;){try{await docker(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres','-d',state.database]);break;}
  catch{if(Date.now()>deadline)throw Error('Local stand database not ready');await new Promise(resolve=>setTimeout(resolve,150));}}
 await initializeLocalPrimarySchema(state);
 await verifyLocalPrimarySchema(state);
 return state;
}
export async function verifyLocalPrimarySchema(state){
 const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
 try{
  const extras=[...await getLocalPrimaryExtraMigrations(),...await getLocalTelegramMigrations(),...await getLocalDeletionMigrations(),...await getLocalCheckoutEditMigrations(),...await getLocalApplicationContactMigrations(),...await getLocalBookingLifecycleMigrations(),...await getLocalWorkOwnerActionsMigrations()];
  const expected=[...getBootstrapPlan({includeListingContactMethod:true}).map(({name,sha256})=>({name,sha256})),...extras.map(({name,sha256})=>({name,sha256}))];
  const journal=(await owner.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  if(JSON.stringify(journal)!==JSON.stringify(expected))throw Error('Local schema changed; data preserved, automatic migration refused');
  const role=(await owner.query("select rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls from pg_roles where rolname='blizhniy_runtime'")).rows[0];
  if(!role||Object.values(role).some(Boolean))throw Error('Unexpected local runtime authority');
 }finally{await owner.end();}
}
export async function getLocalPrimaryExtraMigrations(){
 return Promise.all(['0026-listing-blocks.sql','0027-listing-owner-visibility.sql','0028-listing-restore-entitlement.sql','0029-listing-owner-removals.sql','0030-application-withdrawals.sql'].map(async name=>{
  const source=await readFile(new URL('../database/migrations/'+name,import.meta.url),'utf8');return{name,source,sha256:createHash('sha256').update(source).digest('hex')};
 }));
}
export async function initializeLocalPrimarySchema(state){
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
 try{
  await bootstrapPostgres(owner,`127.0.0.1:${state.database}`,{includeListingContactMethod:true});
  await owner.query('begin');
  try{
   for(const {name,source,sha256} of [...await getLocalPrimaryExtraMigrations(),...await getLocalTelegramMigrations(),...await getLocalDeletionMigrations(),...await getLocalCheckoutEditMigrations(),...await getLocalApplicationContactMigrations(),...await getLocalBookingLifecycleMigrations(),...await getLocalWorkOwnerActionsMigrations()]){
    await owner.query(source.replace(/^begin;\r?\n/m,'').replace(/commit;\s*$/,''));
    await owner.query('insert into blizhniy_meta.migrations(name,sha256) values($1,$2)',[name,sha256]);
   }
   await owner.query('commit');
  }catch(error){await owner.query('rollback');throw error;}
  await owner.query(`create role blizhniy_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${owner.escapeLiteral(state.runtimePassword)};
   revoke all on database blizhniy_prod from public;grant connect on database blizhniy_prod to blizhniy_runtime;grant usage on schema app to blizhniy_runtime;
   revoke create on schema public from public;revoke execute on all functions in schema app from public;alter default privileges revoke execute on functions from public;
   grant select on app.users,app.sessions,app.registration_legal,app.email_confirmations,app.password_recoveries,app.auth_rate_limits,app.mail_outbox,
    app.regions,app.cities,app.categories,app.specialist_categories,app.tariffs,app.cabinet_profiles,app.listings,app.listing_photos,app.listing_moderation,
    app.media_objects,app.media_write_attempts,app.work_publications,app.work_publication_photos,app.work_moderation,
    app.service_publications,app.service_publication_photos,app.service_moderation,app.applications,app.booking_requests,app.notifications to blizhniy_runtime;
   grant insert(email,password_hash),update(password_hash,email_verified_at,auth_version) on app.users to blizhniy_runtime;
   grant insert,delete on app.sessions,app.email_confirmations,app.password_recoveries,app.auth_rate_limits,app.mail_outbox to blizhniy_runtime;
   grant insert on app.registration_legal to blizhniy_runtime;grant update(last_seen_at) on app.sessions to blizhniy_runtime;
   grant update(token_hash) on app.email_confirmations,app.password_recoveries to blizhniy_runtime;grant update(attempts) on app.auth_rate_limits to blizhniy_runtime;
   grant update(state,attempts,available_at,claim_id,lease_until,last_code) on app.mail_outbox to blizhniy_runtime;
   grant insert,update(profile,updated_at) on app.cabinet_profiles to blizhniy_runtime;
   grant insert(id,author_id,listing_type,category_id,city_id,title,description,price),
    update(listing_type,category_id,city_id,title,description,price,revision,updated_at,district,address,latitude,longitude,show_exact_address,contact_phone,messenger_url,booking,contact_method) on app.listings to blizhniy_runtime;
   grant insert(listing_id,media_id,position),delete on app.listing_photos to blizhniy_runtime;
   grant insert(listing_id,revision),update(state,decision_note,decided_at,decided_by) on app.listing_moderation to blizhniy_runtime;
   grant insert(owner_id,intent_id,mime_type,width,height,size,sha256),update(state,ready_at) on app.media_objects to blizhniy_runtime;
   grant insert(media_id) on app.media_write_attempts to blizhniy_runtime`);
  await owner.query('grant select,insert on app.listing_blocks,app.listing_block_mail to blizhniy_runtime;grant insert on app.notifications to blizhniy_runtime');
  await owner.query('grant select on app.listing_owner_removals to blizhniy_runtime;grant insert(listing_id,owner_id,removed_revision) on app.listing_owner_removals to blizhniy_runtime');
  await owner.query('grant select on app.application_withdrawals to blizhniy_runtime;grant insert(application_id,owner_id,withdrawn_revision) on app.application_withdrawals to blizhniy_runtime');
  await owner.query('grant insert(application_id,recipient_id) on app.application_contact_views to blizhniy_runtime');
  await owner.query(withoutTransaction(await readFile(new URL('../database/permissions/telegram-phone.sql',import.meta.url),'utf8')));
  await owner.query(withoutTransaction(await readFile(new URL('../database/permissions/account-deletion.sql',import.meta.url),'utf8')));
  await owner.query('grant update(status) on app.listings to blizhniy_runtime');
  for(const table of ['work_publications','service_publications'])await owner.query(`grant insert(author_id,kind,creation_key,form,city_id,profession_id),update(form,city_id,profession_id,revision,updated_at) on app.${table} to blizhniy_runtime`);
  for(const table of ['work_publication_photos','service_publication_photos'])await owner.query(`grant insert(publication_id,media_id,position),delete on app.${table} to blizhniy_runtime`);
  for(const table of ['work_moderation','service_moderation'])await owner.query(`grant insert(publication_id,revision),update(state,decision_note,decided_at,decided_by) on app.${table} to blizhniy_runtime`);
  await grantLocalPrimaryInteractions(owner);
  await owner.query(withoutTransaction(await readFile(new URL('../database/permissions/booking-lifecycle.sql',import.meta.url),'utf8')));
  await owner.query(withoutTransaction(await readFile(new URL('../database/permissions/work-owner-actions.sql',import.meta.url),'utf8')));
  for(const permission of ['listing-checkout.sql','listing-checkout-dispatch.sql'])await owner.query(await readFile(new URL('../database/permissions/'+permission,import.meta.url),'utf8'));
  await seedLocalPrimaryAccounts(owner,state);
 }finally{await owner.end();}
}
export async function seedLocalPrimaryAccounts(owner,state){
  const accounts=[];
  for(const [email,role,name] of [['user@local.invalid','user','Местный пользователь'],['admin@local.invalid','admin','Местный администратор']]){
   const password='Local-'+randomBytes(9).toString('base64url')+'!';
   const hash=await hashPassword(password);
   const user=(await owner.query('insert into app.users(email,password_hash,role,email_verified_at) values($1,$2,$3,clock_timestamp()) on conflict(email) do update set password_hash=excluded.password_hash returning id',[email,hash,role])).rows[0];
   const profile=Object.fromEntries(Object.entries(createDefaultCabinetProfile({name,email})).filter(([key])=>!['email','phoneVerified','verifiedPhone'].includes(key)));
   await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2::jsonb)',[user.id,JSON.stringify(profile)]);
   accounts.push({id:user.id,email,password,role});
  }
  await writeFile(join(stateDirectory,'accounts.json'),JSON.stringify(accounts),{mode:0o600,flag:'wx'});
  await mkdir(join(stateDirectory,'media'),{mode:0o700});
  await writeFile(join(stateDirectory,'media','.writer.lock'),'',{mode:0o600,flag:'wx'});
  await writeFile(join(stateDirectory,'mail-key.bin'),randomBytes(32),{mode:0o600,flag:'wx'});
  await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','30','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE',
   '-keyout',join(stateDirectory,'tls-key.pem'),'-out',join(stateDirectory,'tls-cert.pem')],{timeout:15000,maxBuffer:65536});
  await chmod(join(stateDirectory,'tls-cert.pem'),0o644);
  await writeFile(join(stateDirectory,'ready.json'),JSON.stringify({version:1,containerId:state.containerId}),{mode:0o600,flag:'wx'});
}
export function localPrimaryDatabaseConfig(state,role='runtime'){
 return {host:'127.0.0.1',port:state.dbPort,database:state.database,user:role==='owner'?'postgres':'blizhniy_runtime',password:role==='owner'?state.ownerPassword:state.runtimePassword,ssl:false,connectionTimeoutMillis:3000};
}
export async function grantLocalPrimaryInteractions(owner){
 for(const table of getInteractionGrantPlan().tables){
  await owner.query(`grant insert(${table.insert.join(',')}),update(${table.update.join(',')}) on app.${table.name} to blizhniy_runtime`);
 }
}
