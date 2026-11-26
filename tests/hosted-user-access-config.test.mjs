import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { getUserAccessRolePlan } from '../scripts/user-access-role.mjs';

const load=createRequire(import.meta.url)('../scripts/local-primary-modules.cjs').loadLocalPrimaryModule;
const origin='https://xn----9sbphbgks4a4a.xn--p1ai';
const hosted={NODE_ENV:'production',BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_ORIGIN:origin,BLIZHNIY_USER_ACCESS_OPERATOR:'hosted-v1'};

test('hosted access accepts only the fixed socket and distinct production-mode opt-in',()=>{
 const {readUserAccessOperatorConfig}=load('hosted-user-access-config');
 assert.equal(readUserAccessOperatorConfig({}),null);
 assert.deepEqual(readUserAccessOperatorConfig(hosted),{mode:'hosted',socketPath:'/run/blizhniy-user-access/operator.sock'});
 for(const patch of [
  {NODE_ENV:'test'}, {BLIZHNIY_LOCAL_PRIMARY:'enabled'}, {BLIZHNIY_LOCAL_PRIMARY_ORIGIN:'https://127.0.0.1:3045'},
  {BLIZHNIY_AUTH_ORIGIN:'https://example.invalid'}, {BLIZHNIY_AUTH_MODE:'local'}, {BLIZHNIY_USER_ACCESS_SOCKET:'/tmp/override.sock'},
 ])assert.throws(()=>readUserAccessOperatorConfig({...hosted,...patch}));
});

test('hosted user operator pins the reviewed 0087 release plus 0061 and excludes tariff changes',()=>{
 const target=getUserAccessRolePlan('blizhniy_test',{hosted:true});
 assert.equal(target.appJournal.at(-1).name,'0087-push-delivery.sql');
 assert.deepEqual(target.journal.map(item=>item.name),['0061-admin-user-access.sql']);
 assert.match(target.grants.at(-1),/^grant execute on function app_admin\.user_access/);
 assert.ok(!target.grants.some(value=>value.includes('tariff_access')));
 assert.throws(()=>getUserAccessRolePlan('blizhniy_test',{hosted:true,tariffs:true}));
});

test('hosted tariff edits require hosted checkout cancellation and a separate exact operator profile',()=>{
 const {readTariffOperatorConfig}=load('hosted-user-access-config');
 const options={...hosted,BLIZHNIY_ADMIN_TARIFFS:'hosted-v1',BLIZHNIY_CHECKOUT_CANCELLATION:'hosted-test-v1'};
 assert.equal(readTariffOperatorConfig(hosted),null);
 assert.equal(readTariffOperatorConfig(options)?.mode,'hosted');
 for(const patch of [
  {BLIZHNIY_USER_ACCESS_OPERATOR:undefined},{BLIZHNIY_CHECKOUT_CANCELLATION:undefined},
  {BLIZHNIY_CHECKOUT_CANCELLATION:'local-v1'},{BLIZHNIY_AUTH_MODE:'local'},
 ])assert.throws(()=>readTariffOperatorConfig({...options,...patch}));
 const target=getUserAccessRolePlan('blizhniy_test',{hosted:'tariffs'});
 assert.equal(target.appJournal.at(-1).name,'0087-push-delivery.sql');
 assert.ok(target.appJournal.some(row=>row.name==='0071-checkout-cancellation-test-policy.sql'));
 assert.deepEqual(target.journal.map(item=>item.name),['0061-admin-user-access.sql','0062-admin-tariffs.sql','0088-hosted-tariff-policy.sql']);
 assert.match(target.grants.at(-1),/^grant execute on function app_admin\.hosted_tariff_access/);
 assert.ok(!target.grants.some(value=>value.includes('app_admin.tariff_access')));
});

test('the hosted operator unit receives a root-owned web-group socket and runs under a separate UID',async t=>{
 const {execFileSync}=await import('node:child_process');
 const {mkdtemp,readFile,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'blizhniy-hosted-user-unit-'));
 t.after(()=>rm(directory,{recursive:true}));
 const template=name=>readFile(new URL('../ops/systemd/blizhniy-user-access.'+name,import.meta.url),'utf8');
 const [socket,service]=await Promise.all([template('socket'),template('service')]);
 for(const line of ['ListenStream=/run/blizhniy-user-access/operator.sock','SocketUser=root','SocketGroup=blizhniy-web',
  'SocketMode=0660','DirectoryMode=0755','Accept=no','FileDescriptorName=operator'])assert.ok(socket.includes(line),line);
 for(const line of ['User=blizhniy-user-operator','Group=blizhniy-user-operator','NoNewPrivileges=true',
  'ProtectSystem=strict','PrivateTmp=true'])assert.ok(service.includes(line),line);
 const socketPath=join(directory,'blizhniy-user-access.socket'),servicePath=join(directory,'blizhniy-user-access.service');
 await Promise.all([writeFile(socketPath,socket),writeFile(servicePath,service.replace('/opt/blizhniy-node22/bin/node',process.execPath))]);
 execFileSync('systemd-analyze',['verify','--man=no',socketPath,servicePath],{timeout:5000,maxBuffer:16384});
});

test('starting the hosted entrypoint outside its approved activation fails before loading database credentials',()=>{
 const child=spawnSync(process.execPath,['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON','scripts/hosted-user-access-operator.mjs'],{
  env:{PATH:process.env.PATH,NODE_ENV:'production',BLIZHNIY_USER_ACCESS_OPERATOR:'hosted-v1'},
  encoding:'utf8',timeout:5000,
 });
 assert.equal(child.status,1);
 assert.equal(child.stdout,'');
 assert.deepEqual(JSON.parse(child.stderr),{event:'hosted_user_operator',status:'unavailable'});
});
