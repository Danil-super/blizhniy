// SQL-only inspection of the identified synthetic local57 stand. No apply/delete mode.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {lstat,realpath,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import pg from 'pg';
import {PostgresDatabase} from '../src/lib/postgres.ts';
import {readMediaRetentionInventory} from './media-retention-inventory.mjs';
import {stateFile,stateDirectory,docker,localPrimaryDatabaseConfig} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {getRefundOperatorRolePlan} from './refund-operator-role.mjs';
import {assertRefundSchema} from './refund-worker-schema.mjs';
let db,phase='arguments';
try{
 assert.equal(process.argv.length,2);
 phase='stand';
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 assert.equal(state.origin,'https://127.0.0.1:3045');
 phase='directory';
 const directory=await lstat(stateDirectory);assert.ok(directory.isDirectory()&&directory.uid===process.getuid()&&(directory.mode&0o7777)===0o700);assert.equal(await realpath(stateDirectory),stateDirectory);
 db=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state,'owner'),max:1}));
 phase='snapshot';
 const report=await db.readTransaction(async tx=>{
  const journal=(await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  phase='schema';
  assert.deepEqual(journal,getRefundOperatorRolePlan(state.database,{schema:57}).journal);
  await assertRefundSchema(tx,57,{localPrimary:true});
  phase='inventory';
  return readMediaRetentionInventory(tx);
 },{timeoutMs:5000});
 phase='report';
 const path=join(stateDirectory,'media-retention-'+randomUUID()+'.json');
 await writeFile(path,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:'observed',...report.summary,overQuotaOwners:report.owners.filter(owner=>owner.overQuota).length,cleanupAuthorized:false,filesystem:report.filesystem,report:path}));
}catch{console.error(JSON.stringify({code:'LOCAL_MEDIA_INVENTORY_UNAVAILABLE',phase}));process.exitCode=1;}
finally{if(db)try{await db.close();}catch{console.error('LOCAL_MEDIA_INVENTORY_UNAVAILABLE');process.exitCode=1;}}
