// No real provider request, token exchange, phone binding or personal-data output.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {REGISTRATION_LEGAL_VERSIONS as legal} from '../src/lib/registration-legal.ts';
import {stateDirectory,stateFile,docker} from './local-primary-fixture.mjs';
import {readLocalPrimaryState,validateLocalPrimaryContainer} from './local-primary-config.mjs';
const state=readLocalPrimaryState(stateFile,process.cwd());
validateLocalPrimaryContainer(JSON.parse(await docker(['inspect',state.containerId]))[0],state);
const origin=state.origin,email='telegram-return-'+randomUUID()+'@local.invalid',password='SyntheticReturn-'+randomUUID()+'!';
const headers={Origin:origin,'Content-Type':'application/json','X-Blizhniy-Request':'1','Sec-Fetch-Site':'same-origin'};
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}});
 const registration=await context.request.post(origin+'/api/account/register',{headers,data:{name:'Проверка возврата',email,password,captchaToken:'',acceptedAgreement:true,acknowledgedPrivacy:true,agreementVersion:legal.agreement,privacyVersion:legal.privacy}});
 assert.equal(registration.status(),202);
 let token;const deadline=Date.now()+10000;
 while(!token&&Date.now()<deadline){
  for(const name of (await readdir(stateDirectory)).filter(name=>/^mail-[a-f0-9-]{36}\.json$/.test(name))){
   const mail=JSON.parse(await readFile(join(stateDirectory,name),'utf8'));if(mail.to===email)token=mail.text.match(/#token=([a-f0-9]{64})/)?.[1];
  }
  if(!token)await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(token);assert.equal((await context.request.post(origin+'/api/account/confirm',{headers,data:{token}})).status(),200);
 const login=await context.request.post(origin+'/api/account/login',{headers,data:{email,password,captchaToken:''}});
 assert.equal(login.status(),200,'Owned local synthetic login');
 const owner=(await login.json()).user.id;
 const start=await context.request.post(origin+'/api/account/phone/start',{headers,data:{expectedOwnerId:owner,returnTo:'/cabinet'}});
 assert.equal(start.status(),200,'Real session-bound attempt');
 const authorization=new URL((await start.json()).authorizationUrl);
 const callback=new URL('/api/account/phone/telegram/callback',origin);
 callback.searchParams.set('state',authorization.searchParams.get('state'));callback.searchParams.set('error','access_denied');
 await context.route('https://oauth.telegram.org/local-return-probe',route=>route.fulfill({contentType:'text/html',
  body:`<a href="${callback.href.replaceAll('&','&amp;')}">Return</a>`}));
 const page=await context.newPage(),responses=[];
 page.on('response',response=>{const url=new URL(response.url());if(url.origin===origin&&['/api/account/phone/telegram/callback','/cabinet/phone'].includes(url.pathname))responses.push({path:url.pathname,status:response.status()});});
 await page.goto('https://oauth.telegram.org/local-return-probe');
 await page.getByRole('link',{name:'Return',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Подтверждение отменено'}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('error'),'cancelled','Callback passed the exact session/state checks');
 assert.ok(responses.some(row=>row.path==='/api/account/phone/telegram/callback'&&row.status===303));
 assert.ok(responses.some(row=>row.path==='/cabinet/phone'&&row.status===200));
 assert.equal((await page.textContent('body')).includes('Local origin required'),false);
 const blocked=await context.request.get(origin+'/cabinet',{headers:{'Sec-Fetch-Site':'cross-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document'}});
 assert.equal(blocked.status(),403,'Unrelated cross-site page remains blocked');
 await page.goto(origin+'/cabinet');await page.getByRole('button',{name:'Настройки',exact:true}).click();
 const settings=page.getByRole('region',{name:'Настройки аккаунта',exact:true});await settings.waitFor();
 assert.equal(await page.getByText('Ваш профиль',{exact:true}).count(),0,'Collapsed profile is replaced by the editor');
 assert.equal(await settings.getByRole('heading',{name:'Аватарка',exact:true}).count(),0);
 await settings.getByLabel('Имя',{exact:true}).waitFor();
 assert.equal(await settings.getByLabel('Email для входа',{exact:true}).evaluate(input=>input.readOnly&&!input.disabled),true);
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1000});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No overflow at '+width);
 }
 await page.setViewportSize({width:1440,height:1000});
 await settings.screenshot({path:'/tmp/blizhniy-telegram-settings-compact.png'});
 await settings.getByRole('button',{name:'Закрыть',exact:true}).click();
 await page.getByRole('button',{name:'Настройки',exact:true}).waitFor();
 assert.equal(await page.getByText('Ваш профиль',{exact:true}).count(),1);
 await page.goto('https://oauth.telegram.org/local-return-probe');await page.getByRole('link',{name:'Return',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Попытка подтверждения недействительна'}).waitFor();
 console.log(JSON.stringify({passed:true,returnChain:responses,validSessionCallback:true,replayRejected:true,otherCrossSitePagesBlocked:true,compactSettings:true,responsive:[320,390,768,1440],realTelegramExchange:false,productionTouched:false}));
}finally{await browser.close();}
