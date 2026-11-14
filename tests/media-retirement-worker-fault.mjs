// Owned fixture only: die after real durable deletion, before its acknowledgement.
import {runFileWorker} from '../scripts/media-file-worker-runtime.mjs';
import {createLocalMediaFileRetirer} from '../src/lib/media-files.ts';
if(process.env.NODE_ENV!=='test'||process.argv[3]!=='retire')throw Error('Owned retirement fixture required');
const deadline=setTimeout(()=>process.exit(1),5000);
try{
 await runFileWorker(undefined,'retire',async(...args)=>{
  const files=await createLocalMediaFileRetirer(...args);
  return{retire:async(...values)=>{await files.retire(...values);process.exit(1);}};
 });
}finally{clearTimeout(deadline);}
