import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { buildUserAccessOperator } from '../scripts/build-user-access-operator.mjs';

export async function testHostedUserAccess(t,{admin,config,load,verifyFinance}){
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-hosted-user-access-'));
 t.after(()=>rm(directory,{recursive:true}));
 const output=join(directory,'operator');
 const manifest=buildUserAccessOperator(output,{hosted:true});
 assert.equal(manifest.appJournal.at(-1).name,'0087-push-delivery.sql');
 assert.deepEqual(manifest.adminJournal.map(row=>row.name),['0061-admin-user-access.sql']);
 await symlink(fileURLToPath(new URL('../node_modules',import.meta.url)),join(output,'node_modules'),'dir');
 const script=async name=>import(pathToFileURL(join(output,'scripts',name)).href);
 const {getUserAccessRolePlan,verifyUserAccessDatabase}=await script('user-access-role.mjs');
 const {startLocalUserAccessOperator}=await script('local-user-access-operator.mjs');
 const {PostgresDatabase}=load('postgres');
 const plan=getUserAccessRolePlan(config.database,{hosted:true}),[migration]=plan.journal;
 await admin.query(await readFile(join(output,'database/candidates',migration.name),'utf8'));
 await admin.query('insert into app_admin.migrations values($1,$2)',[migration.name,migration.sha256]);
 const password=randomBytes(32).toString('hex');
 await admin.query(plan.createRole);
 await admin.query('alter role '+plan.role+' login password '+pg.escapeLiteral(password));
 for(const statement of plan.grants)await admin.query(statement);
 await verifyFinance();
 const db=new PostgresDatabase(new pg.Pool({...config,user:plan.role,password,max:2}));
 t.after(()=>db.close());
 const verify=()=>verifyUserAccessDatabase(db,{database:config.database,hosted:true});
 await verify();
 await assert.rejects(verifyUserAccessDatabase(db,{database:config.database}),/preflight failed/);
 const signature='app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text)';
 assert.equal((await admin.query("select has_function_privilege('blizhniy_runtime',$1,'EXECUTE') as capable",[signature])).rows[0].capable,false);
 await assert.rejects(db.query('select email from app.users'),{code:'42501'});
 await admin.query('grant update(role) on app.users to '+plan.role);
 try{await assert.rejects(verify(),/preflight failed/);}
 finally{await admin.query('revoke update(role) on app.users from '+plan.role);}
 const copiedMigration=join(output,'database/candidates/0087-push-delivery.sql'),bytes=await readFile(copiedMigration);
 const {writeFile}=await import('node:fs/promises');
 await writeFile(copiedMigration,Buffer.concat([bytes,Buffer.from('\n-- changed fixture bytes\n')]));
 try{await assert.rejects(verify(),/preflight failed/);}
 finally{await writeFile(copiedMigration,bytes);}
 await verify();

 const {hashSessionToken,hashPassword,IdentityStore}=load('identity');
 const passphrase='Hosted-access-fixture-1!';
 const passwordHash=await hashPassword(passphrase);
 const webIdentity=new IdentityStore(new PostgresDatabase(admin));
 const seed=async role=>{
  const id=randomUUID(),email=id+'@hosted-access.invalid',token=randomBytes(32).toString('hex');
  await admin.query('insert into app.users(id,email,password_hash,role,email_verified_at) values($1,$2,$3,$4,clock_timestamp())',
   [id,email,passwordHash,role]);
  await admin.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at)
   values($1,$2,0,'app',clock_timestamp()+interval '1 hour')`,[hashSessionToken(token),id]);
  return{id,email,token};
 };
 const actor=await seed('admin'),target=await seed('user');
 const compiled=createRequire(join(output,'package.json'))('./compiled/lib/postgres-admin-user-access.js');
 const store=new compiled.PostgresAdminUserAccess(db);
 const daemon=await startLocalUserAccessOperator({execute:async(token,command)=>{await verify();return store.execute(token,command);},close:async()=>{}});
 t.after(()=>daemon.close());
 const origin='https://xn----9sbphbgks4a4a.xn--p1ai',send=load('local-user-access-operator-client').callLocalUserAccessOperator;
 const handle=load('admin-user-access-http').createAdminUserAccessHandler({origin},()=>({
  limiter:{allowProduction:async()=>true},execute:(token,command,signal)=>send(daemon.socketPath,token,command,signal),
 }),()=>{});
 const request=(token,command)=>handle(new Request(origin+'/api/admin/user-access',{
  method:'POST',headers:{host:new URL(origin).host,origin,'x-real-ip':'192.0.2.210','x-blizhniy-request':'1','content-type':'application/json',
   cookie:'__Host-blizhniy_session='+token},body:JSON.stringify(command),
 }));
 const inspect={action:'inspect',expectedAdminId:actor.id,targetId:target.id};
 assert.equal((await request(target.token,inspect)).status,403);
 assert.equal((await webIdentity.resolveSession(target.token))?.id,target.id);
 const input={id:randomUUID(),targetId:target.id,expectedVersion:'0',role:'user',isBlocked:true,reason:'Синтетическая проверка доступа'};
 const block={action:'change',expectedAdminId:actor.id,input};
 const reply=await request(actor.token,block);
 assert.equal(reply.status,200);
 const applied=await reply.json();
 assert.equal(applied.user.isBlocked,true);
 assert.equal(await webIdentity.resolveSession(target.token),null);
 assert.equal(await webIdentity.login(target.email,passphrase),null);
 const repeat=await request(actor.token,block);
 assert.equal(repeat.status,200);
 assert.deepEqual((await repeat.json()).receipt,applied.receipt);
 const recovered=await request(actor.token,{action:'recover',expectedAdminId:actor.id,targetId:target.id,id:input.id});
 assert.equal(recovered.status,200);
 assert.deepEqual((await recovered.json()).receipt,applied.receipt);
 const unblock=await request(actor.token,{...block,input:{...input,id:randomUUID(),expectedVersion:'1',isBlocked:false}});
 assert.equal(unblock.status,200);
 assert.equal((await unblock.json()).user.isBlocked,false);
 assert.equal(await webIdentity.resolveSession(target.token),null);
 const fresh=await webIdentity.login(target.email,passphrase);
 assert.ok(fresh);
 assert.equal((await webIdentity.resolveSession(fresh.token))?.id,target.id);
 assert.equal((await admin.query('select 1 from app_admin.user_changes where target_id=$1',[target.id])).rowCount,2);
}
