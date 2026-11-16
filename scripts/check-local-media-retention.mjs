// Local57/58 read-only inventory; --files adds fenced observation, never apply/delete.
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
import {readMediaFileInventory} from './media-file-inventory.mjs';
import {createLocalMediaFileWorker} from '../src/lib/media-file-worker.ts';
let db,phase='arguments';
try{
 const includeFiles=process.argv.length===3&&process.argv[2]==='--files';
 assert.ok(process.argv.length===2||includeFiles);if(includeFiles)assert.equal(process.env.NODE_ENV,'test');
 phase='stand';
 const state=readLocalPrimaryState(stateFile,process.cwd());
 validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
 assert.equal(state.origin,'https://127.0.0.1:3045');
 phase='directory';
 const directory=await lstat(stateDirectory);assert.ok(directory.isDirectory()&&directory.uid===process.getuid()&&(directory.mode&0o7777)===0o700);assert.equal(await realpath(stateDirectory),stateDirectory);
 db=new PostgresDatabase(new pg.Pool({...localPrimaryDatabaseConfig(state,'owner'),max:1}));
 phase='snapshot';
 const snapshot=()=>db.readTransaction(async tx=>{
  const journal=(await tx.query('select name,sha256 from blizhniy_meta.migrations order by name')).rows;
  phase='schema';
  const schema=journal.length===58?58:57;
  assert.deepEqual(journal,getRefundOperatorRolePlan(state.database,{schema,localPrimary:true}).journal);
  await assertRefundSchema(tx,schema,{localPrimary:true});
  phase='inventory';
  const report=await readMediaRetentionInventory(tx,{retention:schema===58});
  if(!includeFiles)return report;
  assert.equal(schema,58);phase='files';
  const rows=(await tx.query(`select m.id,m.mime_type as "mimeType",m.width,m.height,m.size,m.sha256,a.id as "attemptId"
   from app.media_objects m left join app.media_write_attempts a on a.media_id=m.id order by m.id limit 10001`)).rows;
  assert.equal(rows.length,report.media.length);
  const files=await readMediaFileInventory(join(stateDirectory,'media'),rows.map(({attemptId,...record})=>({record,attemptId})));
  const byId=new Map(files.objects.map(row=>[row.id,row]));
  const diagnostics={readyMissing:0,completedWithFiles:0};
  for(const media of report.media){const file=byId.get(media.id);assert.ok(file);
   if(media.state==='ready'&&!media.retirementRequested&&file.final==='absent')diagnostics.readyMissing++;
   if(media.retirementCompleted&&(file.final!=='absent'||!['absent','not-reserved'].includes(file.temporary)))diagnostics.completedWithFiles++;
  }
  return{...report,filesystem:'observed-read-only',files,diagnostics};
 },{timeoutMs:5000});
 // READY/EOF/DONE and actual child close keep the existing kernel fence around the snapshot.
 const report=includeFiles?await(await createLocalMediaFileWorker(state.project,join(stateDirectory,'media'))).observe(snapshot):await snapshot();
 phase='report';
 const path=join(stateDirectory,'media-retention-'+randomUUID()+'.json');
 await writeFile(path,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:'observed',...report.summary,overQuotaOwners:report.owners.filter(owner=>owner.overQuota).length,cleanupAuthorized:false,filesystem:report.filesystem,
  ...(report.files?{files:report.files.summary,diagnostics:report.diagnostics}:{}),report:path}));
}catch{console.error(JSON.stringify({code:'LOCAL_MEDIA_INVENTORY_UNAVAILABLE',phase}));process.exitCode=1;}
finally{if(db)try{await db.close();}catch{console.error('LOCAL_MEDIA_INVENTORY_UNAVAILABLE');process.exitCode=1;}}
