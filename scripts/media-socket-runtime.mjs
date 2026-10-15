import {readFile} from 'node:fs/promises';
import {assertPhotoSandbox,photoSandboxCgroupRoot} from './media-sandbox-check.mjs';
import {MEDIA_INPUT_TYPES,MEDIA_MAX_INPUT_BYTES} from '../src/lib/media-worker-protocol.ts';

export async function assertProductionDecoderRuntime() {
 if(process.platform!=='linux')throw new Error('Photo sandbox unavailable');
 const cgroup=await readFile('/proc/self/cgroup','utf8'),root=photoSandboxCgroupRoot(cgroup,'socket');
 const [memory,swap,tasks,cpu,status]=await Promise.all(['memory.max','memory.swap.max','pids.max','cpu.max']
  .map(name=>readFile(root+'/'+name,'utf8')).concat(readFile('/proc/self/status','utf8')));
 assertPhotoSandbox({uid:process.getuid(),gid:process.getgid(),node:process.versions.node,env:process.env,status,cgroup,
  limits:{memory,swap,tasks,cpu},unitKind:'socket'});
}

export async function readMediaSocketRequest(input) {
 const chunks=[];let size=0;
 for await(const chunk of input){
  size+=chunk.length;
  if(size>MEDIA_MAX_INPUT_BYTES+1||chunks.length>=256)throw new Error('Media socket input unavailable');
  chunks.push(chunk);
 }
 const frame=Buffer.concat(chunks,size);
 if(frame.length<2||!MEDIA_INPUT_TYPES[frame[0]])throw new Error('Media socket input unavailable');
 return {input:frame.subarray(1),mimeType:MEDIA_INPUT_TYPES[frame[0]]};
}
