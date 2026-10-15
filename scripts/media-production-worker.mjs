import {Socket} from 'node:net';
import {assertProductionDecoderRuntime,readMediaSocketRequest} from './media-socket-runtime.mjs';
import {encodeMediaReply,encodeMediaFailure} from '../src/lib/media-worker-protocol.ts';

process.stdout.on('error',()=>process.exit(1));
let reply;
try {
 if(process.argv.length!==2)throw new Error('Invalid decoder invocation');
 await assertProductionDecoderRuntime();
 // inetd-style accepted AF_UNIX socket. Keep its write half open after request EOF.
 const connection=new Socket({fd:0,allowHalfOpen:true,readable:true,writable:false});
 const {input,mimeType}=await readMediaSocketRequest(connection);
 const {normalizeMediaImage}=await import('../src/lib/media-image.ts');
 reply=encodeMediaReply(await normalizeMediaImage(input,mimeType));
}catch(error){reply=encodeMediaFailure(error?.code??'MEDIA_UNAVAILABLE');}
process.stdout.write(reply,()=>process.exit(0));
