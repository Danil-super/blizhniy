// Operator artifacts for the owned synthetic stand. Mail is composed offline.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {promisify} from 'node:util';
import nodemailer from 'nodemailer';
import {localArchiveMaximumBytes,privateDirectory,readBoundedExportFile,readPrivateFile,validateLocalExportNotice} from './local-account-export-delivery.mjs';

const run=promisify(execFile),writeOptions={mode:0o600,flag:'wx'};
const sections={
 operatorName:'Оператор',operatorAddress:'Адрес оператора',purpose:'Цели',basis:'Основания',methods:'Способы обработки',
 sources:'Источники данных',recipients:'Получатели',retention:'Сроки обработки и хранения',rights:'Как реализовать свои права',
 internationalTransfers:'Трансграничная передача',processors:'Обработка по поручению оператора',
 safeguards:'Меры оператора',otherInformation:'Дополнительные сведения',
};
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const archiveEntries=['report.pdf','account.json','processing.json','media'];

export async function writeLocalAccountReport(directory,data,caseId,disclosure){
 assert.equal(process.env.NODE_ENV,'test');
 assert.match(caseId,/^[A-Za-z0-9_-]{1,80}$/);
 const notice=validateLocalExportNotice(disclosure);
 const {chromium}=await import('playwright');
 const browser=await chromium.launch({headless:true,timeout:15000});
 try{
  const page=await browser.newPage({offline:true,serviceWorkers:'block'});
  const profile={'Имя':data.profile?.name,'Телефон':data.profile?.phone,'Город':data.profile?.city};
  const profileDetails=Object.entries(profile).filter(([,value])=>value)
   .map(([label,value])=>`<p>${label}: ${escape(value)}</p>`).join('');
  const body=Object.entries(sections).map(([key,label])=>`<h2>${label}</h2><p>${escape(notice[key])}</p>`).join('');
  await page.setContent(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Сведения о персональных данных</title>
   <style>body{font:11pt/1.45 sans-serif;color:#17253a}h1{font-size:20pt}h2{font-size:13pt;break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere}</style>
   <h1>БЛИЖНИЙ. Сведения о персональных данных</h1>
   <p>Номер обращения: ${escape(caseId)}</p><p>Аккаунт: ${escape(data.account.email)}</p>
   ${profileDetails}
   <p>Обработка данных подтверждена. Данные аккаунта приведены в приложении account.json.
   Доступные фотографии находятся в каталоге media.</p>${body}</html>`,{timeout:10000});
  const bytes=await page.pdf({format:'A4',tagged:true,margin:{top:'18mm',right:'18mm',bottom:'18mm',left:'18mm'}});
  assert.ok(bytes.length<=localArchiveMaximumBytes);
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  await writeFile(join(directory,'report.pdf'),bytes,writeOptions);
  await writeFile(join(directory,'processing.json'),JSON.stringify(notice,null,2)+'\n',writeOptions);
 }finally{await browser.close();}
}

export async function readReviewedAccountReport(directory,stateDirectory,ownerId,email){
 assert.ok(directory===join(stateDirectory,basename(directory))&&/^account-export-reviewed-[A-Za-z0-9]+$/.test(basename(directory)));
 const root=await privateDirectory(directory);
 try{
  const anchor='/proc/self/fd/'+root.fd;
  const account=JSON.parse((await readPrivateFile(join(anchor,'account.json'),localArchiveMaximumBytes)).toString());
  assert.equal(account.account.id,ownerId);assert.equal(account.account.email,email);
  const report=await readPrivateFile(join(anchor,'report.pdf'),localArchiveMaximumBytes);
  assert.equal(report?.subarray(0,5).toString(),'%PDF-');
  const media=await privateDirectory(join(directory,'media'));
  try{
   const mediaAnchor='/proc/self/fd/'+media.fd;
   const files=account.media.filter(row=>row.file);
   assert.deepEqual((await readdir(mediaAnchor)).sort(),files.map(row=>row.id+'.webp').sort());
   for(const row of files){
    assert.match(row.id,/^[a-f0-9-]{36}$/);
    assert.equal(row.file,'media/'+row.id+'.webp');
    const bytes=await readPrivateFile(join(mediaAnchor,row.id+'.webp'),localArchiveMaximumBytes);
    assert.equal(bytes?.length,row.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256);
   }
  }finally{await media.close();}
  return validateLocalExportNotice(JSON.parse((await readPrivateFile(join(anchor,'processing.json'),65536)).toString()));
 }finally{await root.close();}
}

export async function prepareLocalAccountEmail(directory,stateDirectory,email){
 assert.equal(process.env.NODE_ENV,'test');
 assert.match(email,/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.invalid$/);
 const output=await mkdtemp(join(stateDirectory,'account-export-email-'));
 const password=randomBytes(24).toString('base64url'),archive=join(output,'archive.zip');
 try{
  const zip=run('7za',['a','-tzip','-mem=AES256','-p','-bso0','-bsp0',archive,...archiveEntries],
   {cwd:directory,timeout:30000,maxBuffer:32768});
  await Promise.all([zip,new Promise((resolve,reject)=>{
   zip.child.stdin.once('error',reject);
   zip.child.stdin.end(password+'\n'+password+'\n',resolve);
  })]);
  const content=await readBoundedExportFile(archive,localArchiveMaximumBytes,info=>info.uid===process.getuid()&&info.nlink===1);
  assert.ok(content);
  const message=await nodemailer.createTransport({streamTransport:true,buffer:true,disableFileAccess:true,disableUrlAccess:true}).sendMail({
   from:{name:'БЛИЖНИЙ',address:'support@blizhniy.invalid'},to:{address:email},subject:'Ответ на обращение о персональных данных',
   text:'Отчёт находится в зашифрованном ZIP. Пароль предоставляется отдельно после проверки личности.',
   attachments:[{filename:'blizhniy-account.zip',content,contentType:'application/zip'}],
  });
  assert.ok(Buffer.isBuffer(message.message));
  await writeFile(join(output,'delivery.eml'),message.message,writeOptions);
  await writeFile(join(output,'password.txt'),password+'\n',writeOptions);
  await rm(archive);
  return {directory:output,draft:'delivery.eml',separatePassword:'password.txt'};
 }catch(error){
  await rm(output,{recursive:true,force:true});
  throw error;
 }
}
