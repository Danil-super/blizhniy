// Browser acceptance against the validated, owned local stand. Synthetic accounts only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import pg from 'pg';
import {chromium} from 'playwright';
import {stateFile,stateDirectory,localPrimaryDatabaseConfig,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
import {installLocalDeletion} from './local-deletion-migration.mjs';
const require=createRequire(import.meta.url),{loadLocalPrimaryModule:load}=require('./local-primary-modules.cjs');
await installLocalDeletion();
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const owner=new pg.Client(localPrimaryDatabaseConfig(state,'owner'));await owner.connect();
const browser=await chromium.launch({headless:true}),created=[],consoleErrors=[];
const suffix=randomBytes(6).toString('hex'),password='Local-deletion-'+randomBytes(12).toString('hex')+'!';
const hash=await load('identity').hashPassword(password),headers={'Origin':state.origin,'X-Blizhniy-Request':'1'};
const contexts=[];
async function context(){const value=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:900}});contexts.push(value);return value;}
async function api(ctx,path,data){return ctx.request.post(state.origin+path,{headers,data});}
async function login(ctx,email,secret){const response=await api(ctx,'/api/account/login',{email,password:secret,captchaToken:''});assert.equal(response.status(),200,'synthetic app login must succeed');}
async function open(ctx,path){const page=await ctx.newPage();page.on('pageerror',error=>consoleErrors.push(error.name));await page.goto(state.origin+path);return page;}
try{
 const testAccounts=[];
 for(const blocked of [false,true]){
  const email=`deletion-${blocked?'blocked':'owner'}-${suffix}@local.invalid`;
  const id=(await owner.query('insert into app.users(email,password_hash,email_verified_at,is_blocked) values($1,$2,clock_timestamp(),$3) returning id',[email,hash,blocked])).rows[0].id;
  created.push(id);testAccounts.push({id,email,blocked});
 }
 const normal=await context();await login(normal,testAccounts[0].email,password);
 const page=await open(normal,'/cabinet/udalit-akkaunt');
 await page.getByText(testAccounts[0].email,{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Запрос на удаление аккаунта',exact:true}).count(),1);
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Отправить запрос на удаление',exact:true}).click();
 await page.getByRole('heading',{name:'Заявка получена',exact:true}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'Заявка получена',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Отправить запрос на удаление',exact:true}).count(),0);
 // Limited login retains access to the rights request while ordinary login stays forbidden.
 const limited=await context();
 const denied=await api(limited,'/api/account/login',{email:testAccounts[1].email,password,captchaToken:''});assert.equal(denied.status(),401);
 const blockedPage=await open(limited,'/cabinet/udalit-akkaunt');
 await blockedPage.getByRole('heading',{name:'Доступ к своему запросу'}).waitFor();
 await blockedPage.getByLabel('Email',{exact:true}).fill(testAccounts[1].email);
 await blockedPage.getByLabel('Пароль',{exact:true}).fill(password);
 await blockedPage.getByRole('button',{name:'Войти для подачи запроса',exact:true}).click();
 await blockedPage.getByText(testAccounts[1].email,{exact:true}).waitFor();
 await blockedPage.getByRole('checkbox').check();await blockedPage.getByRole('button',{name:'Отправить запрос на удаление',exact:true}).click();
 await blockedPage.getByRole('heading',{name:'Заявка получена',exact:true}).waitFor();
 const limitedApp=await api(limited,'/api/account/session',{});assert.equal(limitedApp.status(),401);
 assert.equal((await api(limited,'/api/admin/deletion/list',{expectedAdminId:testAccounts[1].id,page:0})).status(),401);
 const adminAccount=JSON.parse(await readFile(join(stateDirectory,'accounts.json'),'utf8')).find(value=>value.role==='admin');
 assert.ok(adminAccount,'owned stand has synthetic administrator');
 const admin=await context();await login(admin,adminAccount.email,adminAccount.password);
 const adminPage=await open(admin,'/admin/account-deletion');
 for(const account of testAccounts){
  const card=adminPage.locator('article').filter({has:adminPage.getByRole('heading',{name:account.email,exact:true})});
  await card.getByRole('button',{name:'Начать рассмотрение',exact:true}).click();
  await card.getByLabel('Номер защищённого дела').fill('LOCAL_REVIEW_'+suffix);
  await card.getByRole('checkbox').check();await card.getByRole('button',{name:'Записать решение',exact:true}).click();
  await card.waitFor({state:'detached'});
 }
 await page.getByRole('button',{name:'Проверить состояние заявки',exact:true}).click();
 await page.getByRole('heading',{name:'Рассмотрена',exact:true}).waitFor();await page.getByText('В запросе отказано',{exact:true}).waitFor();
 await blockedPage.getByRole('button',{name:'Проверить состояние заявки',exact:true}).click();
 await blockedPage.getByRole('heading',{name:'Рассмотрена',exact:true}).waitFor();
 await blockedPage.getByRole('button',{name:'Выйти из доступа к заявке',exact:true}).click();
 await blockedPage.getByRole('heading',{name:'Доступ к своему запросу'}).waitFor();
 assert.equal((await api(limited,'/api/account/deletion/session',{access:'data-subject'})).status(),401);
 assert.deepEqual(consoleErrors,[],'new primary pages must have no JavaScript errors');
 console.log('Local deletion browser acceptance passed: owner request/reload, blocked limited login, scope isolation, admin review, status, logout.');
}finally{
 await Promise.allSettled(contexts.map(value=>value.close()));await browser.close();
 // Only accounts created above; immutable pseudonymous decision records remain.
 for(const id of created)await owner.query('delete from app.users where id=$1 and email like $2',[id,'deletion-%-'+suffix+'@local.invalid']);
 await owner.end();
}
