import assert from 'node:assert/strict';
import {request} from 'node:https';

/** Acceptance transport only: one fixed loopback origin, independent cookies, no redirects. */
export function createLocalPrimaryHttpsClient(ca,send=request){
 const origin='https://127.0.0.1:3045',cookies=new Map();
 return async(path,{body={},method='POST',expected=200,form=false,loseBody=false,headers={}}={})=>{
  assert.ok(typeof path==='string'&&path.startsWith('/')&&!path.startsWith('//'));
  const url=new URL(path,origin);assert.equal(url.origin,origin);
  return new Promise((resolve,reject)=>{
   const bytes=method==='GET'?undefined:Buffer.from(form?new URLSearchParams(body).toString():JSON.stringify(body));
   const req=send(url,{method,ca,rejectUnauthorized:true,signal:AbortSignal.timeout(15000),headers:{origin,'sec-fetch-site':'same-origin','x-blizhniy-request':'1',
    'accept-encoding':'identity',cookie:[...cookies].map(([key,value])=>key+'='+value).join('; '),
    ...(bytes?{'content-type':form?'application/x-www-form-urlencoded':'application/json','content-length':bytes.length}:{}),...headers}},res=>{
    res.on('error',reject);
    for(const cookie of res.headers['set-cookie']??[]){const pair=cookie.split(';')[0],i=pair.indexOf('=');cookies.set(pair.slice(0,i),pair.slice(i+1));}
    if(loseBody){try{assert.equal(res.statusCode,expected,url.pathname);resolve({data:null,headers:res.headers});}catch(error){reject(error);}finally{res.destroy();}return;}
    const parts=[];let size=0;
    res.on('data',chunk=>{size+=chunk.length;if(size>2097152)req.destroy(Error('Local acceptance reply bound'));else parts.push(chunk);});
    res.on('end',()=>{try{
     assert.equal(res.statusCode,expected,url.pathname);assert.equal(res.complete,true,'Incomplete local reply');
     const text=Buffer.concat(parts).toString('utf8');resolve({data:res.headers['content-type']?.includes('application/json')?JSON.parse(text):text,headers:res.headers});
    }catch(error){reject(error);}});
   });req.on('error',reject);req.end(bytes);
  });
 };
}
