// Owned Unix-socket fixture only: same stdio framing, without claiming a production sandbox.
import {Socket} from 'node:net';
import {readMediaSocketRequest} from '../scripts/media-socket-runtime.mjs';
import {normalizeMediaImage} from '../src/lib/media-image.ts';
import {encodeMediaReply} from '../src/lib/media-worker-protocol.ts';
if(process.env.NODE_ENV!=='test')throw new Error('Test fixture required');
process.stdout.on('error',()=>process.exit(1));
const input=new Socket({fd:0,allowHalfOpen:true,readable:true,writable:false});
const request=await readMediaSocketRequest(input);
const result=await normalizeMediaImage(request.input,request.mimeType);
process.stdout.write(encodeMediaReply(result),()=>process.exit(0));
