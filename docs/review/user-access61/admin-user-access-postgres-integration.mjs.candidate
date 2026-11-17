// Opt-in: owns one tmpfs PostgreSQL, synthetic identities and EXECUTE-only operator.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createRequire} from 'node:module';
import {startLocalUserAccessOperator} from '../scripts/local-user-access-operator.mjs';
import {readRefundSchema} from '../scripts/refund-worker-schema.mjs';
const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs');
const run=promisify(execFile),password=randomBytes(24).toString('hex'),operatorPassword=randomBytes(24).toString('hex');
const name='blizhniy-user-access-'+randomBytes(8).toString('hex'),label='blizhniy.admin-user-access-test';
const image='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873';
const docker=async args=>(await run('docker',['--host','unix:///var/run/docker.sock',...args],{
  env:{PATH:process.env.PATH,LANG:'C.UTF-8',POSTGRES_PASSWORD:password},timeout:20000,maxBuffer:1048576})).stdout.trim();
const signature='app_admin.user_access(text,uuid,text,uuid,uuid,bigint,text,boolean,text)';
const hash=value=>createHash('sha256').update(value).digest('hex');
test('primary user access: atomic commands through a real EXECUTE-only role',{timeout:90000},async suite=>{
  let container,owner,operator;
  try{
    container=await docker(['run','--detach','--pull','never','--name',name,'--label',`${label}=${name}`,'--memory','256m','--cpus','1',
      '--tmpfs','/var/lib/postgresql:rw,size=134217728','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_DB=blizhniy_test',image]);
    assert.match(container,/^[a-f0-9]{64}$/);const info=JSON.parse(await docker(['inspect',container]))[0];assert.equal(info.Id,container);assert.equal(info.Config.Labels[label],name);
    const binding=info.NetworkSettings.Ports['5432/tcp'][0];assert.equal(binding.HostIp,'127.0.0.1');
    for(const deadline=Date.now()+20000;;){try{await docker(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','blizhniy_test']);break;}catch{if(Date.now()>deadline)throw Error('Owned PostgreSQL unavailable');}await new Promise(resolve=>setTimeout(resolve,100));}
    const config={host:'127.0.0.1',port:Number(binding.HostPort),database:'blizhniy_test',user:'postgres',password,ssl:false,connectionTimeoutMillis:2000};
    owner=new pg.Client(config);await owner.connect();
    await owner.query(await readFile(new URL('../database/migrations/0001-identity.sql',import.meta.url),'utf8'));
    await owner.query('begin read only');const originalAppSchema=await readRefundSchema(owner);await owner.query('rollback');
    await owner.query(await readFile(new URL('../database/candidates/0061-admin-user-access.sql',import.meta.url),'utf8'));
    await owner.query('begin read only');assert.deepEqual(await readRefundSchema(owner),originalAppSchema);await owner.query('rollback');
    await owner.query(`create role blizhniy_user_operator login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls connection limit 4 password ${pg.escapeLiteral(operatorPassword)};
      revoke all on database blizhniy_test from public;grant connect on database blizhniy_test to blizhniy_user_operator;
      grant usage on schema app_admin to blizhniy_user_operator;grant execute on function ${signature} to blizhniy_user_operator`);
    operator=new pg.Pool({...config,user:'blizhniy_user_operator',password:operatorPassword,max:3,statement_timeout:4000,lock_timeout:1000});
    const account=async(role='user',blocked=false,verified=true)=>{
      const id=randomUUID();await owner.query(`insert into app.users(id,email,password_hash,role,is_blocked,email_verified_at)
        values($1,$2,$3,$4,$5,case when $6 then clock_timestamp() end)`,[id,id+'@example.invalid','scrypt$131072$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128),role,blocked,verified]);return id;
    };
    const session=async(id,scope='app')=>{
      const token=randomBytes(32).toString('hex');await owner.query(`insert into app.sessions(token_hash,user_id,auth_version,scope,expires_at)
        select $1,id,auth_version,$3,clock_timestamp()+interval '1 hour' from app.users where id=$2`,[hash(token),id,scope]);return token;
    };
    const actor=await account('admin'),peer=await account('admin'),target=await account(),token=await session(actor);
    const inspect=(id=target,credential=token,admin=actor)=>operator.query('select '+signature.split('(')[0]+'($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',[hash(credential),admin,'inspect',id,null,null,null,null,null]).then(result=>result.rows[0].result);
    const command=(patch={})=>({id:randomUUID(),targetId:target,expectedVersion:'0',role:'user',isBlocked:true,reason:'Нарушение правил',...patch});
    const change=(input,credential=token,admin=actor)=>operator.query('select app_admin.user_access($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
      [hash(credential),admin,'change',input.targetId,input.id,input.expectedVersion,input.role,input.isBlocked,input.reason]).then(result=>result.rows[0].result);
    await suite.test('operator cannot read identities/sessions or write role, audit and schema directly',async()=>{
      for(const sql of ['select * from app.users','select * from app.sessions','select * from app_admin.user_changes',
        "update app.users set role='admin' where false",'delete from app.users where false','truncate app_admin.user_changes','create table app.forbidden(id int)'])
        await assert.rejects(operator.query(sql),error=>error.code==='42501');
      const row=(await owner.query(`select p.prosecdef,p.proconfig,has_function_privilege('public',$1,'EXECUTE') as public_execute,
        p.proowner=n.nspowner as schema_owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=$1::regprocedure`,[signature])).rows[0];
      assert.equal(row.prosecdef,true);assert.equal(row.public_execute,false);assert.equal(row.schema_owner,true);assert.ok(row.proconfig.includes('search_path=pg_catalog, pg_temp'));
      await assert.rejects(owner.query('select app_admin.user_access($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash(token),actor,'inspect',target,null,null,null,null,null]),error=>error.code==='PUA01');
      await owner.query('create role blizhniy_runtime nologin;grant usage on schema app to blizhniy_runtime;set role blizhniy_runtime');
      try{await assert.rejects(owner.query('select app_admin.user_access($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash(token),actor,'inspect',target,null,null,null,null,null]),error=>error.code==='42501');}
      finally{await owner.query('reset role');}
    });
    await suite.test('verified live admin reads access without contacts, then atomically blocks and revokes both session scopes',async()=>{
      const appToken=await session(target),rightsToken=await session(target,'data-subject');
      const before=await inspect();assert.deepEqual(before.user,{id:target,role:'user',isBlocked:false,emailVerified:true,authVersion:'0'});assert.deepEqual(before.history,[]);assert.equal(before.receipt,null);
      const input=command(),result=await change(input);assert.equal(result.user.isBlocked,true);assert.equal(result.user.authVersion,'1');assert.equal(result.receipt.changed,true);assert.equal(result.receipt.actorId,actor);assert.equal(result.receipt.id,input.id);assert.equal(result.history.length,1);
      for(const credential of [appToken,rightsToken])assert.equal((await owner.query('select s.auth_version=u.auth_version as valid from app.sessions s join app.users u on u.id=s.user_id where token_hash=$1',[hash(credential)])).rows[0].valid,false);
      assert.equal((await owner.query('select count(*)::int as count from app_admin.user_changes where id=$1',[input.id])).rows[0].count,1);
      const replay=await change(input);assert.deepEqual(replay.receipt,result.receipt);assert.equal(replay.user.authVersion,'1');
      await assert.rejects(change({...input,reason:'Другая причина'}),error=>error.code==='PUA02');
      await assert.rejects(change(command()),error=>error.code==='PUA03');
      const unblocked=await change(command({expectedVersion:'1',isBlocked:false}));assert.equal(unblocked.user.authVersion,'2');
      const old=await change(input);assert.deepEqual(old.receipt,result.receipt);assert.equal(old.user.isBlocked,false);assert.equal(old.user.authVersion,'2');
      assert.equal((await inspect()).history.length,2);
    });
    await suite.test('ordinary, blocked, unverified, expired, idle, wrong actor and rights-only sessions fail before target disclosure',async()=>{
      const ordinary=await account(),blocked=await account('admin',true),pending=await account('admin',false,false);
      for(const [credential,admin] of [[await session(ordinary),ordinary],[await session(blocked),blocked],[await session(pending),pending],
        [await session(actor,'data-subject'),actor],[token,peer],['bad',actor]])
        await assert.rejects(inspect(randomUUID(),credential,admin),error=>error.code==='PUA01');
      for(const expired of [true,false]){
        const credential=await session(peer);
        await owner.query(`update app.sessions set created_at=clock_timestamp()-interval '2 hours',last_seen_at=clock_timestamp()-interval '2 hours',
          expires_at=clock_timestamp()+case when $2 then interval '-1 hour' else interval '1 hour' end where token_hash=$1`,[hash(credential),expired]);
        await assert.rejects(inspect(target,credential,peer),error=>error.code==='PUA01');
      }
      await assert.rejects(inspect(randomUUID()),error=>error.code==='PUA06');
    });
    await suite.test('self-change and last-admin protection reject without audit or state effects',async()=>{
      const input=command({targetId:actor});
      await assert.rejects(change(input),error=>error.code==='PUA05');
      await owner.query('update app.users set is_blocked=true where id=$1',[peer]);
      try{await assert.rejects(change(input),error=>error.code==='PUA04');}
      finally{await owner.query('update app.users set is_blocked=false where id=$1',[peer]);}
      assert.equal((await owner.query('select count(*)::int as count from app_admin.user_changes where id=$1',[input.id])).rows[0].count,0);
      assert.equal((await inspect(actor)).user.authVersion,'0');
    });
    await suite.test('no-op receipt is durable and cannot later apply a different access state',async()=>{
      const id=await account(),input=command({targetId:id,isBlocked:false});
      const first=await change(input);assert.equal(first.receipt.changed,false);assert.equal(first.user.authVersion,'0');
      await change(command({targetId:id}));const replay=await change(input);
      assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.user.authVersion,'1');assert.equal(replay.user.isBlocked,true);
      for(const patch of [{targetId:target},{isBlocked:true},{role:'admin'},{expectedVersion:'1'}])
        await assert.rejects(change({...input,...patch}),error=>error.code==='PUA02');
      await assert.rejects(change(input,await session(peer),peer),error=>error.code==='PUA02');
    });
    await suite.test('role changes require verified identity and revoke the old privilege version',async()=>{
      const pending=await account('user',false,false);
      await assert.rejects(change(command({targetId:pending,role:'admin',isBlocked:false})),error=>error.code==='PUA07');
      const id=await account(),oldToken=await session(id);
      const promoted=await change(command({targetId:id,role:'admin',isBlocked:false}));assert.equal(promoted.user.role,'admin');assert.equal(promoted.user.authVersion,'1');
      await assert.rejects(inspect(target,oldToken,id),error=>error.code==='PUA01');
      const fresh=await session(id);assert.equal((await inspect(target,fresh,id)).user.id,target);
      await change(command({targetId:id,role:'user',isBlocked:false,expectedVersion:'1'}));
      await assert.rejects(inspect(target,fresh,id),error=>error.code==='PUA01');
    });
    await suite.test('the journal is bounded; old receipt replay still works after it leaves the latest ten',async()=>{
      const id=await account(),firstInput=command({targetId:id});const first=await change(firstInput);
      for(let index=1;index<13;index++)await change(command({targetId:id,expectedVersion:String(index),isBlocked:index%2===0}));
      const current=await inspect(id);assert.equal(current.history.length,10);assert.equal(current.history.some(row=>row.id===firstInput.id),false);
      const replay=await change(firstInput);assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.user.authVersion,'13');assert.equal(replay.history.length,10);
      for(const sql of ['update app_admin.user_changes set reason=reason where false','delete from app_admin.user_changes where false','truncate app_admin.user_changes'])
        await assert.rejects(owner.query(sql),error=>error.code==='23514');
    });
    await suite.test('global or target row contention fails NOWAIT without an effect',async()=>{
      const id=await account(),input=command({targetId:id});
      await owner.query('begin');try{
        await owner.query('select pg_advisory_xact_lock(187924,61)');await assert.rejects(change(input),error=>error.code==='55P03');
      }finally{await owner.query('rollback');}
      await owner.query('begin');try{
        await owner.query('select id from app.users where id=$1 for update',[id]);await assert.rejects(change(input),error=>error.code==='55P03');
      }finally{await owner.query('rollback');}
      assert.equal((await inspect(id)).user.authVersion,'0');
      assert.equal((await owner.query('select count(*)::int as count from app_admin.user_changes where id=$1',[input.id])).rows[0].count,0);
    });
    await suite.test('revoked admin cannot replay a receipt; fresh authority recovers it without another effect',async()=>{
      const credential=await session(peer),input=command({targetId:await account()});
      const first=await change(input,credential,peer);await owner.query('update app.users set auth_version=auth_version+1 where id=$1',[peer]);
      await assert.rejects(change(input,credential,peer),error=>error.code==='PUA01');
      const recovered=await change(input,await session(peer),peer);assert.deepEqual(recovered.receipt,first.receipt);assert.equal(recovered.user.authVersion,'1');
    });
    await suite.test('SQL boundary rejects invalid payloads and repeatable-read; exhausted versions cannot wrap',async()=>{
      for(const [role,blocked,reason] of [['organization',true,'Причина'],['user',null,'Причина'],['user',true,'  '],['user',true,'Причина\nстрока'],['user',true,'<b>Причина</b>']])
        await assert.rejects(operator.query('select app_admin.user_access($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash(token),actor,'change',target,randomUUID(),'0',role,blocked,reason]),error=>error.code==='PUA08');
      const connection=await operator.connect();try{
        await connection.query('begin isolation level repeatable read');
        await assert.rejects(connection.query('select app_admin.user_access($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash(token),actor,'inspect',target,null,null,null,null,null]),error=>error.code==='PUA01');
      }finally{await connection.query('rollback');connection.release();}
      const id=await account();await owner.query('update app.users set auth_version=9223372036854775807 where id=$1',[id]);
      const noop=await change(command({targetId:id,expectedVersion:'9223372036854775807',isBlocked:false}));assert.equal(noop.user.authVersion,'9223372036854775807');assert.equal(noop.receipt.changed,false);
      await assert.rejects(change(command({targetId:id,expectedVersion:'9223372036854775807'})),error=>error.code==='PUA03');
    });
    await suite.test('the real adapter validates DB receipts and recovery is read-only, including absent receipts',async()=>{
      const {PostgresAdminUserAccess}=load('postgres-admin-user-access'),store=new PostgresAdminUserAccess(operator);
      const id=await account(),input=command({targetId:id});
      const first=await store.execute(token,{action:'change',expectedAdminId:actor,input});
      const recovery={action:'recover',expectedAdminId:actor,targetId:id,id:input.id};
      assert.deepEqual((await store.execute(token,recovery)).receipt,first.receipt);
      const unknown=await store.execute(token,{...recovery,id:randomUUID()});assert.equal(unknown.receipt,null);assert.equal(unknown.user.authVersion,'1');assert.equal(unknown.history.length,1);
      await assert.rejects(store.execute(await session(peer),{...recovery,expectedAdminId:peer}),error=>error.code==='OPERATION_CONFLICT');
      const unblocked=command({targetId:id,expectedVersion:'1',isBlocked:false});await store.execute(token,{action:'change',expectedAdminId:actor,input:unblocked});
      const old=await store.execute(token,recovery);assert.deepEqual(old.receipt,first.receipt);assert.equal(old.user.isBlocked,false);assert.equal(old.user.authVersion,'2');
    });
    await suite.test('HTTP to private IPC to restricted SQL survives a dropped committed response without a second mutation',async()=>{
      const {PostgresAdminUserAccess}=load('postgres-admin-user-access'),store=new PostgresAdminUserAccess(operator);
      const {callLocalUserAccessOperator}=load('local-user-access-operator-client'),{createAdminUserAccessHandler}=load('admin-user-access-http');
      const input=command({targetId:await account()});let committed,release,closed=0;
      const committedPromise=new Promise(resolve=>{committed=resolve;}),releasePromise=new Promise(resolve=>{release=resolve;});
      const server=await startLocalUserAccessOperator({execute:async(credential,command)=>{
        const result=await store.execute(credential,command);
        if(command.action==='change'&&command.input.id===input.id){committed();await releasePromise;}return result;
      },close:async()=>{closed++;}});
      try{
        const abort=new AbortController();const pending=callLocalUserAccessOperator(server.socketPath,token,{action:'change',expectedAdminId:actor,input},abort.signal);
        const rejected=assert.rejects(pending,error=>error.code==='ACCESS_UNAVAILABLE');
        await committedPromise;abort.abort();await rejected;
        const origin='https://access.example.invalid',handler=createAdminUserAccessHandler({origin},()=>({limiter:{allowProduction:async()=>true},
          execute:(credential,command,signal)=>callLocalUserAccessOperator(server.socketPath,credential,command,signal)}),event=>{assert.equal(JSON.stringify(event).includes(token),false);});
        const recovery={action:'recover',expectedAdminId:actor,targetId:input.targetId,id:input.id};
        const response=await handler(new Request(origin+'/api/admin/user-access',{method:'POST',headers:{host:'access.example.invalid',origin,
          'content-type':'application/json','x-blizhniy-request':'1','x-real-ip':'192.0.2.4',cookie:'__Host-blizhniy_session='+token},body:JSON.stringify(recovery)}));
        assert.equal(response.status,200);const result=await response.json();assert.equal(result.receipt.id,input.id);assert.equal(result.user.authVersion,'1');
        assert.equal((await owner.query('select count(*)::int as count from app_admin.user_changes where id=$1',[input.id])).rows[0].count,1);
      }finally{release();await server.close();}assert.equal(closed,1);
    });
    await suite.test('expiry during audit insertion rolls back both the access write and its receipt',async()=>{
      const id=await account(),admin=await account('admin'),credential=await session(admin),input=command({targetId:id,reason:'Проверка истечения'});
      const connection=await operator.connect();let reached=false;const notice=event=>{if(event.message==='ACCESS_DELAY_REACHED')reached=true;};connection.on('notice',notice);
      try{
        await owner.query(`create function app.test_access_delay() returns trigger language plpgsql set search_path=pg_catalog as $$begin
          raise notice 'ACCESS_DELAY_REACHED';perform pg_sleep(1.2);return new;end;$$;
          create trigger test_access_delay before insert on app_admin.user_changes for each row execute function app.test_access_delay()`);
        await owner.query("update app.sessions set expires_at=clock_timestamp()+interval '1 second' where token_hash=$1",[hash(credential)]);
        await assert.rejects(connection.query('select app_admin.user_access($1,$2,$3,$4,$5,$6,$7,$8,$9)',[hash(credential),admin,'change',id,input.id,'0','user',true,input.reason]),error=>error.code==='PUA01');
        assert.equal(reached,true);assert.equal((await inspect(id)).user.authVersion,'0');
        assert.equal((await owner.query('select count(*)::int as count from app_admin.user_changes where id=$1',[input.id])).rows[0].count,0);
      }finally{connection.removeListener('notice',notice);connection.release();await owner.query('drop trigger if exists test_access_delay on app_admin.user_changes;drop function if exists app.test_access_delay()');}
    });
    await suite.test('two remaining administrators cannot concurrently demote one another to zero admins',async()=>{
      const left=await account('admin'),right=await account('admin'),leftToken=await session(left),rightToken=await session(right);
      const previous=(await owner.query("select id,is_blocked from app.users where role='admin' and id not in ($1,$2)",[left,right])).rows;
      await owner.query("update app.users set is_blocked=true where role='admin' and id not in ($1,$2)",[left,right]);
      try{
        const commands=[command({targetId:right,isBlocked:false}),command({targetId:left,isBlocked:false})];
        const results=await Promise.allSettled([change(commands[0],leftToken,left),change(commands[1],rightToken,right)]);
        assert.equal(results.filter(row=>row.status==='fulfilled').length,1);
        assert.ok(results.filter(row=>row.status==='rejected').every(row=>['PUA01','55P03'].includes(row.reason.code)));
        assert.equal((await owner.query("select count(*)::int as count from app.users where role='admin' and not is_blocked and email_verified_at is not null")).rows[0].count,1);
        assert.equal((await owner.query('select count(*)::int as count from app_admin.user_changes where id=any($1::uuid[])',[commands.map(row=>row.id)])).rows[0].count,1);
      }finally{for(const row of previous)await owner.query('update app.users set is_blocked=$2 where id=$1',[row.id,row.is_blocked]);}
    });
  } finally {
    await operator?.end();await owner?.end();
    if(container){const info=JSON.parse(await docker(['inspect',container]))[0];assert.equal(info.Id,container);assert.equal(info.Name,'/'+name);assert.equal(info.Config.Labels[label],name);await docker(['rm','--force',container]);}
  }
});
