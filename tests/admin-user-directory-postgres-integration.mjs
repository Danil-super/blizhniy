// Disposable PG18, synthetic users and a restricted runtime; no shared stand or .env.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const {PostgresDatabase}=load('postgres'),{PostgresAdminUserDirectory}=load('postgres-admin-user-directory');
const {hashSessionToken}=load('identity'),{AdminAccessError}=load('admin-authorization');
const run=promisify(execFile),password=randomBytes(24).toString('hex'),runtimePassword=randomBytes(24).toString('hex');
const name='blizhniy-user-directory-'+randomBytes(8).toString('hex'),label='blizhniy.admin-user-directory-test';
const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{
  env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1024*1024})).stdout.trim();

test('primary user directory uses real restricted PostgreSQL and current admin authorization',{timeout:90000},async suite=>{
  let container,owner,db;
  try {
    container=await docker(['run','--detach','--pull','never','--name',name,'--label',`${label}=${name}`,'--memory','256m','--cpus','1',
      '--tmpfs','/var/lib/postgresql:rw,size=134217728','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
    assert.match(container,/^[a-f0-9]{64}$/);
    const info=JSON.parse(await docker(['inspect',container]))[0];assert.equal(info.Id,container);assert.equal(info.Config.Labels[label],name);
    const binding=info.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
    for(const deadline=Date.now()+20000;;){
      try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}
      catch{if(Date.now()>deadline)throw Error('Owned PostgreSQL unavailable');}await new Promise(resolve=>setTimeout(resolve,100));
    }
    const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:2000};
    owner=new pg.Client(config);await owner.connect();
    for(const file of ['0001-identity.sql','0011-cabinet-profiles.sql'])await owner.query(await readFile(new URL('../database/migrations/'+file,import.meta.url),'utf8'));
    await owner.query(`create role directory_runtime login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls password ${pg.escapeLiteral(runtimePassword)};
      revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to directory_runtime;
      grant usage on schema app to directory_runtime;grant select on app.users,app.sessions,app.cabinet_profiles to directory_runtime;
      grant update(password_hash) on app.users to directory_runtime;grant update(last_seen_at) on app.sessions to directory_runtime`);
    db=new PostgresDatabase(new pg.Pool({...config,user:'directory_runtime',password:runtimePassword,max:2,statement_timeout:4000,lock_timeout:1000}));
    const store=new PostgresAdminUserDirectory(db),ids=[];
    async function account(role='user',blocked=false,verified=true,profile={name:'Синтетический пользователь',phone:'+79990000000'}){
      const id=randomUUID();ids.push(id);
      await owner.query(`insert into app.users(id,email,password_hash,role,is_blocked,email_verified_at,created_at)
        values($1,$2,$3,$4,$5,case when $6 then clock_timestamp() end,'2026-11-17T10:20:30.123456Z')`,
        [id,id+'@example.invalid','scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128),role,blocked,verified]);
      if(profile)await owner.query('insert into app.cabinet_profiles(user_id,profile) values($1,$2)',[id,JSON.stringify({...profile,organizationAddress:'PRIVATE_ADDRESS',avatarDataUrl:'PRIVATE_AVATAR'})]);
      return id;
    }
    const actor=await account('admin'),user=await account(),blocked=await account('user',true),pending=await account('user',false,false);
    async function session(id=actor,scope='app'){
      const token=randomBytes(32).toString('hex');await owner.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at)
        select $1,id,auth_version,$3,clock_timestamp()+interval '1 hour' from app.users where id=$2`,[hashSessionToken(token),id,scope]);return token;
    }
    const token=await session(),query={expectedAdminId:actor,query:'',role:'all',status:'all',cursor:null};
    await suite.test('bounded whitelist DTO through restricted runtime, without profile/credential leakage',async()=>{
      assert.equal((await db.query('select current_user as name')).rows[0].name,'directory_runtime');
      const page=await store.list(token,query);assert.equal(page.items.length,4);assert.equal(page.nextCursor,null);
      assert.ok(page.items.every(row=>row.createdAt==='2026-11-17T10:20:30.123456Z'));
      for(const secret of ['PRIVATE_ADDRESS','PRIVATE_AVATAR','password_hash','token_hash','scrypt$'])assert.equal(JSON.stringify(page).includes(secret),false);
      for(const sql of ["update app.users set role='admin' where false",'update app.users set is_blocked=true where false','delete from app.users where false'])
        await assert.rejects(db.query(sql),error=>error.code==='42501');
    });
    const literal=await account('user',false,true,{name:'Метка 100% under_score C:\\files',phone:'+78880000000'});
    await suite.test('literal case-insensitive search, absent profile and independent status/role filters',async()=>{
      const noProfile=await account('user',false,true,null);
      for(const needle of ['100%','under_score','c:\\files','МЕТКА','+7888'])assert.deepEqual((await store.list(token,{...query,query:needle})).items.map(row=>row.id),[literal]);
      for(const needle of ['underXscore',"' OR TRUE --",'PRIVATE_ADDRESS','PRIVATE_AVATAR'])assert.deepEqual((await store.list(token,{...query,query:needle})).items,[]);
      assert.equal((await store.list(token,{...query,query:noProfile})).items[0].name,'');
      assert.deepEqual((await store.list(token,{...query,role:'admin'})).items.map(row=>row.id),[actor]);
      assert.deepEqual((await store.list(token,{...query,status:'blocked'})).items.map(row=>row.id),[blocked]);
      assert.deepEqual((await store.list(token,{...query,status:'pending'})).items.map(row=>row.id),[pending]);
      assert.ok((await store.list(token,{...query,status:'active'})).items.every(row=>row.emailVerified&&!row.isBlocked));
    });
    await suite.test('microsecond keyset pages contain every tied timestamp exactly once, despite a new earlier row',async()=>{
      for(let index=0;index<27;index++)await account();
      const first=await store.list(token,query);assert.equal(first.items.length,25);assert.ok(first.nextCursor);
      const later=await account();await owner.query("update app.users set created_at=created_at+interval '1 microsecond' where id=$1",[later]);
      const second=await store.list(token,{...query,cursor:first.nextCursor});assert.equal(second.nextCursor,null);
      const found=[...first.items,...second.items].map(row=>row.id);
      assert.equal(new Set(found).size,found.length);assert.deepEqual([...found].sort(),ids.filter(id=>id!==later).sort());
    });
    await suite.test('untrusted or revoked authority, wrong actor and rights-only sessions cannot read contacts',async()=>{
      for(const [credential,expected] of [[await session(user),actor],[await session(blocked),actor],[await session(pending),actor],
        [await session(actor,'data-subject'),actor],[token,user],['bad',actor]])
        await assert.rejects(store.list(credential,{...query,expectedAdminId:expected}),AdminAccessError);
      const revoked=await session();await owner.query('update app.users set auth_version=auth_version+1 where id=$1',[actor]);
      await assert.rejects(store.list(revoked,query),AdminAccessError);
      const expired=await session();await owner.query("update app.sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '2 hours',expires_at=clock_timestamp()-interval '1 hour' where token_hash=$1",[hashSessionToken(expired)]);
      await assert.rejects(store.list(expired,query),AdminAccessError);
    });
  } finally {
    await db?.close();await owner?.end();
    if(container){const info=JSON.parse(await docker(['inspect',container]))[0];assert.equal(info.Id,container);assert.equal(info.Name,'/'+name);assert.equal(info.Config.Labels[label],name);await docker(['rm','--force',container]);}
  }
});
