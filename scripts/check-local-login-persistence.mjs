// Owned synthetic login only; isolated persistent profile, no provider or production requests.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {stateFile,stateDirectory,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';

const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
assert.equal(state.origin,'https://127.0.0.1:3045');
const user=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(row=>row.role==='user');
assert.match(user.email,/@local\.invalid$/);
const profile=await mkdtemp(join(stateDirectory,'login-persistence-'));
const headers={Origin:state.origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const errors=[],foreign=[];
let context=null,signedIn=false;
async function start(){
 const opened=await chromium.launchPersistentContext(profile,{headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block',viewport:{width:390,height:844}});
 context=opened;
 await opened.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(['http:','https:'].includes(url.protocol)&&url.origin!==state.origin){foreign.push(url.host);return route.abort();}
  return route.continue();
 });
 opened.on('page',page=>page.on('pageerror',()=>errors.push('pageerror')));
 const page=await opened.newPage();page.setDefaultTimeout(10000);return page;
}
async function session(status){
 const response=await context.request.post(state.origin+'/api/account/session',{headers,data:{},timeout:6000});
 assert.equal(response.status(),status);return response.json();
}
async function close(){await context.close();context=null;}
try{
 let page=await start();
 await page.goto(state.origin+'/auth');
 await page.getByLabel('Email',{exact:true}).fill(user.email);
 await page.getByLabel('Пароль',{exact:true}).fill(user.password);
 signedIn=true;await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.waitForURL(state.origin+'/');
 const owner=(await session(200)).user.id;
 await page.goto(state.origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).waitFor();
 await close();

 page=await start();assert.equal((await session(200)).user.id,owner,'Server accepts the browser-persisted session after a full process restart');
 await page.goto(state.origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).waitFor();
 await page.goto(state.origin+'/auth');
 const loggedOut=page.waitForResponse(response=>response.url()===state.origin+'/api/account/logout'&&response.request().method()==='POST');
 await page.locator('main').getByRole('button',{name:'Выйти',exact:true}).click();assert.equal((await loggedOut).status(),200);
 signedIn=false;await page.getByLabel('Email',{exact:true}).waitFor();await session(401);await close();

 page=await start();await session(401);
 await page.goto(state.origin+'/auth');await page.getByLabel('Email',{exact:true}).waitFor();
 assert.deepEqual(errors,[]);assert.deepEqual(foreign,[]);
 console.log(JSON.stringify({passed:true,fullBrowserRestarts:2,authenticatedAfterRestart:true,logoutRemainsAfterRestart:true,pageErrors:0,foreignRequests:0,productionTouched:false}));
}finally{
 try{
  if(signedIn){if(!context)await start();const response=await context.request.post(state.origin+'/api/account/logout',{headers,data:{},timeout:6000});assert.equal(response.status(),200,'Revoke this synthetic test session');}
 }finally{try{await context?.close();}finally{await rm(profile,{recursive:true,force:true});}}
}
