"use client";
import {parseProfessionCatalog} from './profession-catalog-contract.ts';

/** A public, bounded read; errors never substitute a different catalog. */
export async function loadProfessionCatalog(transport:typeof fetch,external?:AbortSignal){
 const timeout=AbortSignal.timeout(10000),signal=external?AbortSignal.any([external,timeout]):timeout;
 const response=await transport('/api/reference/professions',{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal});
 if(response.status!==200||!response.headers.get('content-type')?.startsWith('application/json')||!response.body)throw Error('Profession catalog unavailable');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0,chunks=0,complete=false;
 try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();
  if(part.done){complete=true;text+=decoder.decode();break;}
  bytes+=part.value.byteLength;if(bytes>2097152||++chunks>4096)throw Error('Profession catalog unavailable');
  text+=decoder.decode(part.value,{stream:true});
 }}finally{try{if(!complete)await reader.cancel();}finally{reader.releaseLock();}}
 const envelope=JSON.parse(text);
 if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).join()!=='items')throw Error('Profession catalog unavailable');
 return parseProfessionCatalog(envelope.items);
}
