import assert from 'node:assert/strict';
import {test} from 'node:test';
import {MEDIA_MAX_INPUT_BYTES} from '../src/lib/media-worker-protocol.ts';
import {readMediaSocketRequest} from '../scripts/media-socket-runtime.mjs';
import {assertPhotoSandbox} from '../scripts/media-sandbox-check.mjs';
test('socket input is bounded before native decoding and preserves the allowlisted MIME and bytes',async()=>{
 const data=Buffer.from([0,1,2,3]);
 assert.deepEqual(await readMediaSocketRequest((async function*(){yield data.subarray(0,2);yield data.subarray(2);})()),{input:Buffer.from([1,2,3]),mimeType:'image/jpeg'});
 for(const source of [(async function*(){yield Buffer.from([9,1]);})(),(async function*(){yield Buffer.from([0]);})(),
  (async function*(){yield Buffer.alloc(MEDIA_MAX_INPUT_BYTES+2);})(),(async function*(){for(let i=0;i<257;i++)yield Buffer.from([0]);})()]){
  await assert.rejects(readMediaSocketRequest(source),/Media socket input unavailable/);
 }
});
test('decoder sandbox accepts only its actual root-managed service instance, not check units or unrelated cgroups',()=>{
 const base={uid:993,gid:984,node:'22.23.3',env:{NODE_ENV:'production'},unitKind:'socket',
  status:'NoNewPrivs:\t1\nCapEff:\t0000000000000000\nCapAmb:\t0000000000000000\n',
  cgroup:'0::/system.slice/system-blizhniy\\x2dmedia.slice/blizhniy-media@0.service\n',
  limits:{memory:'536870912',swap:'0',tasks:'32',cpu:'100000 100000'}};
 assert.doesNotThrow(()=>assertPhotoSandbox(base));
 for(const change of [{cgroup:'0::/system.slice/blizhniy-media-check.service\n'},{unitKind:'unknown'},{uid:0},
  {cgroup:'0::/system.slice/not-blizhniy-media@0.service\n'},{limits:{...base.limits,memory:'max'}},
  {env:{...base.env,BLIZHNIY_DB_PASSWORD:'synthetic'}}]){
  assert.throws(()=>assertPhotoSandbox({...base,...change}),/Photo sandbox unavailable/);
 }
});
