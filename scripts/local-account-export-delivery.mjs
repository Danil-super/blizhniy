// Loaded only by the owned synthetic stand and its operator export command.
import {constants} from 'node:fs';
import {link,lstat,mkdtemp,open,opendir,realpath,rm,unlink,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {createRequire} from 'node:module';
import {isAbsolute,join} from 'node:path';
import {promisify} from 'node:util';

const {loadLocalPrimaryModule:load}=createRequire(import.meta.url)('./local-primary-modules.cjs');
const {AuthRequestError,authJson,readAuthJson}=load('auth-http');
const {DeletionAccessError,DeletionInputError,deletionId,deletionAccess,deletionObject}=load('account-deletion-contract');
const {getTrustedProxyIp}=load('trusted-proxy-ip');
const {readAccountSessionToken}=load('account-cookie'),{readDataSubjectToken}=load('data-subject-cookie');
const run=promisify(execFile),accessMs=15*60*1000;
export const localArchiveMaximumBytes=16*1024*1024;
export const archiveRoot=(stateDirectory,containerId)=>join(stateDirectory,'account-export-delivery-'+containerId);
export const exportDownloadCsp="script-src 'self'; connect-src 'self'";
export const exportDownloadForm=`<h1>Архив моих данных</h1><form id="export-form" method="post">
 <p><label>Номер выдачи <input name="id" required maxlength="36" autocomplete="off"></label></p>
 <p><label>Способ входа <select name="access"><option value="account">Кабинет</option>
 <option value="data-subject">Вход для обращения об обработке данных</option></select></label></p>
 <button>Скачать архив</button><p role="status"></p>
 </form><p><a href="/cabinet">Перейти в кабинет</a></p><script src="/__local/account-export.js" defer></script>`;
export const exportDownloadScript=`
const form = document.querySelector('#export-form');
const status = form.querySelector('[role=status]');
const button = form.querySelector('button');
form.addEventListener('submit', async event => {
 event.preventDefault();
 button.disabled = true;
 status.textContent = 'Проверяем доступ к архиву…';
 try {
  const {id, access} = Object.fromEntries(new FormData(form));
  const response = await fetch('/api/account/export', {
   method: 'POST', credentials: 'same-origin', cache: 'no-store',
   headers: {'Content-Type': 'application/json', 'X-Blizhniy-Request': '1'},
   body: JSON.stringify({id: id.trim(), access})
  });
  if (!response.ok) {
   status.textContent = response.status === 401 ? 'Войдите в аккаунт и повторите запрос.' :
    response.status === 404 ? 'Архив недоступен. Проверьте номер выдачи.' : 'Не удалось скачать архив. Попробуйте позже.';
   return;
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'blizhniy-account.tar.gz';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status.textContent = 'Скачивание началось.';
 } catch {
  status.textContent = 'Не удалось скачать архив. Попробуйте позже.';
 } finally {
  button.disabled = false;
 }
});
`;

async function privateDirectory(path){
 if(!isAbsolute(path)||await realpath(path)!==path)throw Error('Unsafe export directory');
 const directory=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{
  const info=await directory.stat();
  if(!info.isDirectory()||info.uid!==process.getuid()||(info.mode&0o7777)!==0o700)throw Error('Unsafe export directory');
  return directory;
 }catch(error){await directory.close();throw error;}
}

async function readPrivateFile(path,limit,check=()=>true){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const info=await file.stat();
  if(!privateSingleFile(info,limit)||!check(info))return null;
  const bytes=Buffer.alloc(info.size+1);
  const {bytesRead}=await file.read({buffer:bytes,length:bytes.length,position:0});
  if(bytesRead!==info.size)return null;
  return bytes.subarray(0,bytesRead);
 }finally{await file.close();}
}

function privateSingleFile(info,limit){
 return info.isFile()&&info.uid===process.getuid()&&(info.mode&0o7777)===0o600&&info.nlink===1&&info.size>=1&&info.size<=limit;
}

export async function purgeExpiredLocalAccountArchives(delivery){
 if(process.env.NODE_ENV!=='test')throw Error('Archive cleanup requires the synthetic stand');
 let root;
 try{root=await privateDirectory(delivery);}
 catch(error){if(error.code==='ENOENT')return 0;throw error;}
 try{
  const cutoff=Date.now()-accessMs,anchor='/proc/self/fd/'+root.fd;
  let removed=0;
  for await(const entry of await opendir(anchor)){
   if(!entry.isFile())continue;
   const match=/^([a-f0-9-]{36})_([a-f0-9-]{36})\.tar\.gz$/.exec(entry.name);
   if(!match)continue;
   try{deletionId(match[1]);deletionId(match[2]);}catch{continue;}
   const path=join(anchor,entry.name);
   try{
    const info=await lstat(path);
    if(privateSingleFile(info,localArchiveMaximumBytes)&&info.mtimeMs<=cutoff){
     await unlink(path);removed++;
    }
   }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(removed)await root.sync();
  return removed;
 }finally{await root.close();}
}

export async function publishLocalAccountArchive(input,delivery,ownerId,disclosure){
 deletionId(ownerId);
 const notice=deletionObject(disclosure,['processingConfirmed','purpose','basis','methods','operatorName','operatorAddress',
  'sources','recipients','retention','rights','internationalTransfers','processors','safeguards','otherInformation']);
 const {processingConfirmed,...details}=notice;
 if(processingConfirmed!==true||Object.values(details).some(text=>typeof text!=='string'||!text.trim()||text.length>1000))
  throw new DeletionInputError();
 const source=await privateDirectory(input);
 try{
  const anchor='/proc/self/fd/'+source.fd;
  const account=await readPrivateFile(join(anchor,'account.json'),localArchiveMaximumBytes);
  if(!account||JSON.parse(account.toString()).account?.id!==ownerId)throw new DeletionAccessError();
  await writeFile(join(anchor,'processing.json'),JSON.stringify(notice,null,2)+'\n',{flag:'wx',mode:0o600});
 }finally{await source.close();}
 const root=await privateDirectory(delivery);
 let temporary;
 try{
  temporary=await mkdtemp(join('/proc/self/fd',String(root.fd),'preparing-'));
  const path=join(temporary,'archive.tar.gz');
  await writeFile(path,'',{flag:'wx',mode:0o600});
  // The trusted input contains only generated JSON files and verified WebP entries.
  await run('/usr/bin/tar',['-czf',path.replace('/proc/self/fd/','/proc/'+process.pid+'/fd/'),'-C',input,'--','account.json','processing.json','media'],
   {env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},timeout:10000,maxBuffer:32768});
  const archive=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const info=await archive.stat();
   if(info.size<1||info.size>localArchiveMaximumBytes)throw Error('Export needs an offline handoff');
   await archive.sync();
  }finally{await archive.close();}
  const id=randomUUID();
  await link(path,join('/proc/self/fd',String(root.fd),ownerId+'_'+id+'.tar.gz'));
  await root.sync();
  return {id,expiresInSeconds:accessMs/1000};
 }finally{
  try{if(temporary)await rm(temporary,{recursive:true});}finally{await root.close();}
 }
}

export function createLocalAccountExportHandler({origin,delivery,session,allow}){
 return async request=>{
  try{
   const data=deletionObject(await readAuthJson(request,{origin}),['access','id']);
   const id=deletionId(data.id),access=deletionAccess(data.access);
   const ip=getTrustedProxyIp(request.headers);if(!ip)throw new AuthRequestError(403,'UNTRUSTED_INGRESS');
   const token=access==='account'?readAccountSessionToken(request):readDataSubjectToken(request);
   if(!token)throw new AuthRequestError(401,'UNAUTHENTICATED');
   if(!await allow(ip))throw new AuthRequestError(429,'RATE_LIMITED');
   const current=await session(token),ownerId=deletionId(current.id),root=await privateDirectory(delivery);
   let bytes;
   try{
    const now=Date.now();
    bytes=await readPrivateFile(join('/proc/self/fd',String(root.fd),ownerId+'_'+id+'.tar.gz'),localArchiveMaximumBytes,
     info=>now-info.mtimeMs>=0&&now-info.mtimeMs<accessMs);
   }finally{await root.close();}
   if(!bytes)throw new AuthRequestError(404,'NOT_FOUND');
   return new Response(bytes,{headers:{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="blizhniy-account.tar.gz"',
    'Content-Length':String(bytes.length),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});
  }catch(error){
   if(error instanceof AuthRequestError)return authJson({error:{code:error.code}},error.status);
   if(error instanceof DeletionInputError)return authJson({error:{code:'INVALID_INPUT'}},422);
   if(error instanceof DeletionAccessError)return authJson({error:{code:'UNAUTHENTICATED'}},401);
   if(error?.code==='ENOENT')return authJson({error:{code:'NOT_FOUND'}},404);
   return authJson({error:{code:'EXPORT_UNAVAILABLE'}},503);
  }
 };
}
