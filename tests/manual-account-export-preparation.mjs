// Stand integration. Requires 7za, Poppler and Chromium.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {test} from 'node:test';
import {chromium} from 'playwright';
import {prepareLocalAccountEmail,readReviewedAccountReport,writeLocalAccountReport} from '../scripts/local-account-export-report.mjs';
import {createLocalAccountExportHandler,exportCabinetForm,exportDownloadCsp,exportDownloadScript,publishLocalAccountArchive,revokeLocalAccountArchive} from '../scripts/local-account-export-delivery.mjs';

const run=promisify(execFile),permissions={mode:0o600};
const notice={processingConfirmed:true,operatorName:'Синтетический оператор БЛИЖНИЙ',
 operatorAddress:'Учебный адрес',purpose:'Работа тестового кабинета',basis:'Репетиция запроса',
 methods:'Чтение базы и сборка отчёта',sources:'Данные тестового аккаунта',recipients:'Владелец аккаунта',
 retention:'На время репетиции',rights:'Обращение в поддержку',internationalTransfers:'В репетиции отсутствуют',
 processors:'В репетиции отсутствуют',safeguards:'Изолированная база',otherInformation:'Для репетиции отсутствуют'};

test('reviewed synthetic data can be fetched in the cabinet or prepared as encrypted email',async t=>{
 process.env.NODE_ENV='test';
 const root=await mkdtemp(join(tmpdir(),'blizhniy-manual-export-'));
 t.after(()=>rm(root,{force:true,recursive:true}));
 const input=join(root,'account-export-reviewed-test'),media=join(input,'media'),delivery=join(root,'delivery');
 await mkdir(input,{mode:0o700});await mkdir(media,{mode:0o700});await mkdir(delivery,{mode:0o700});
 const owner=randomUUID(),peer=randomUUID(),email='owner@blizhniy.invalid',photoId=randomUUID();
 const image=Buffer.from('524946460400000057454250','hex'),photoName=photoId+'.webp';
 const record={account:{id:owner,email},profile:{name:'Тестовый пользователь'},media:[{id:photoId,file:'media/'+photoName,size:image.length,
  sha256:createHash('sha256').update(image).digest('hex')}]};
 await writeFile(join(input,'account.json'),JSON.stringify(record),permissions);
 await writeFile(join(media,photoName),image,permissions);
 await writeLocalAccountReport(input,record,'SYNTHETIC-42',notice);
 const pdf=await readFile(join(input,'report.pdf'));
 const {stdout}=await run('pdftotext',[join(input,'report.pdf'),'-']);
 assert.match(stdout,/Сведения о персональных данных/);assert.match(stdout,/SYNTHETIC-42/);assert.match(stdout,/owner@blizhniy\.invalid/);
 assert.match(stdout,/Тестовый пользователь/);
 await assert.rejects(readReviewedAccountReport(input,root,peer,email));
 await assert.rejects(readReviewedAccountReport(input,root,owner,'changed@blizhniy.invalid'));
 await writeFile(join(media,photoName),Buffer.alloc(image.length),permissions);
 await assert.rejects(readReviewedAccountReport(input,root,owner,email));
 await writeFile(join(media,photoName),image,permissions);
 const reviewed=await readReviewedAccountReport(input,root,owner,email);
 const draft=await prepareLocalAccountEmail(input,root,email);
 const message=await readFile(join(draft.directory,draft.draft),'utf8');
 const password=(await readFile(join(draft.directory,draft.separatePassword),'utf8')).trim();
 assert.match(message,/^To: owner@blizhniy\.invalid\r?$/m);
 assert.equal(message.includes(password),false);
 const encoded=message.match(/filename="?blizhniy-account\.zip"?[^\r\n]*\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/);
 assert.ok(encoded);
 const attachment=join(root,'received.zip');
 await writeFile(attachment,Buffer.from(encoded[1],'base64'),permissions);
 const listing=(await run('7za',['l','-slt',attachment])).stdout;
 assert.equal((listing.match(/Method = AES-256/g)??[]).length,4);
 const extract=(entry,key)=>{
  const child=run('7za',['e','-so',attachment,entry],{encoding:'buffer'});
  child.child.stdin.end(key+'\n');
  return child;
 };
 await assert.rejects(extract('report.pdf','incorrect'));
 assert.deepEqual((await extract('report.pdf',password)).stdout,pdf);
 assert.deepEqual((await extract('media/'+photoName,password)).stdout,image);

 const key=join(root,'key.pem'),cert=join(root,'cert.pem');
 await run('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=127.0.0.1','-keyout',key,'-out',cert]);
 let origin,handler;
 const server=createServer({key:await readFile(key),cert:await readFile(cert)},async(req,res)=>{
  if(req.url==='/cabinet/moi-dannye'){
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; "+exportDownloadCsp});
   res.end(exportCabinetForm);return;
  }
  if(req.url==='/__local/account-export.js'){
   res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(exportDownloadScript);return;
  }
  if(req.url!=='/api/account/export'){res.writeHead(404);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const headers=new Headers(req.headers);headers.set('x-real-ip','127.0.0.1');
  const response=await handler(new Request(origin+req.url,{method:req.method,headers,body:Buffer.concat(chunks)}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 origin='https://127.0.0.1:'+server.address().port;
 const ownerToken='a'.repeat(64),peerToken='b'.repeat(64);
 handler=createLocalAccountExportHandler({origin,delivery,session:async token=>({id:token===ownerToken?owner:peer}),allow:async()=>true});
 const browser=await chromium.launch({headless:true});
 t.after(()=>browser.close());
 const page=async token=>{
  const context=await browser.newContext({ignoreHTTPSErrors:true,acceptDownloads:true});
  await context.addCookies([{name:'__Host-blizhniy_session',value:token,url:origin,secure:true,httpOnly:true}]);
  const result=await context.newPage();result.setDefaultTimeout(5000);return result;
 };
 const cabinet=await page(ownerToken),other=await page(peerToken);
 const route=origin+'/cabinet/moi-dannye';
 const button=p=>p.getByRole('button',{name:'Скачать готовый архив',exact:true});
 await cabinet.goto(route);
 await cabinet.getByText('Готового архива пока нет.').waitFor();
 assert.equal(await button(cabinet).count(),0);
 const {id}=await publishLocalAccountArchive(input,delivery,owner,reviewed,true);
 await other.goto(route);
 await other.getByText('Готового архива пока нет.').waitFor();
 assert.equal(await button(other).count(),0);
 await cabinet.reload();
 const download=cabinet.waitForEvent('download');
 await button(cabinet).click();
 const archive=await (await download).path();
 assert.deepEqual((await run('tar',['-xOzf',archive,'--','report.pdf'],{encoding:'buffer'})).stdout,pdf);
 assert.equal(await revokeLocalAccountArchive(delivery,peer,id),false);
 assert.equal(await revokeLocalAccountArchive(delivery,owner,id),true);
 await cabinet.reload();
 await cabinet.getByText('Готового архива пока нет.').waitFor();
 assert.equal(await button(cabinet).count(),0);
 await cabinet.context().close();await other.context().close();
});
