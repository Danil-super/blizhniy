// A separate owned loopback Next process, no account/DB/provider credentials or dotenv.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {observeReportDelivery} from './local-csp-report-delivery.mjs';
import {startReportTestTls} from './local-csp-https-fixture.mjs';
import {chromium} from 'playwright';
const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const tls=await startReportTestTls(port),origin=tls.origin;
const child=spawn(process.execPath,[join(process.cwd(),'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:process.cwd(),env:{PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',BLIZHNIY_AUTH_MODE:'local',BLIZHNIY_CSP_MODE:'report-only',SITE_URL:origin,__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore','ignore','ignore']});
let browser,exit=false;child.once('exit',()=>{exit=true;});
try{
 for(const end=Date.now()+20000;;){assert.equal(exit,false,'owned report-only process stays alive');try{const response=await fetch(`http://127.0.0.1:${port}`);if(response.ok)break;}catch(error){if(error.name!=='TypeError')throw error;}assert.ok(Date.now()<end,'owned report-only process starts');await new Promise(resolve=>setTimeout(resolve,100));}
 browser=await chromium.launch({channel:'chromium',args:['--short-reporting-delay','--proxy-server=http://127.0.0.1:1']});const context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.name));const collect=await observeReportDelivery(page,origin);
 await context.addInitScript(()=>{window.__cspReportOnlyViolations=[];document.addEventListener('securitypolicyviolation',event=>window.__cspReportOnlyViolations.push({directive:event.effectiveDirective,disposition:event.disposition}));});
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==origin)return route.abort();
  if(req.isNavigationRequest()&&url.pathname==='/'){
   const response=await route.fetch(),headers=response.headers();assert.ok(headers['content-security-policy-report-only']);assert.equal(headers['content-security-policy'],undefined);
   const html=(await response.text()).replace('<head>','<head><script>window.__cspReportOnlyProbe=true</script>');
   await route.fulfill({response,body:html,headers});return;
  }
  return route.continue();
 });
 await page.goto(origin);await page.waitForFunction(()=>window.__cspReportOnlyProbe===true);
 const city=page.locator('header button[aria-haspopup="listbox"]:visible');await city.click();await page.getByPlaceholder('Введите город',{exact:true}).fill('Краснодар');await page.getByRole('option',{name:'Краснодар',exact:true}).waitFor();
 await page.waitForFunction(()=>window.__cspReportOnlyViolations.some(event=>event.directive==='script-src-elem'&&event.disposition==='report'));
 const reports=await collect();
 assert.ok(reports.every(status=>status===204),'report-only collector accepts actual browser reports');assert.deepEqual(errors,[]);
 console.log('Report-only CSP Chromium passed: isolated loopback process, nonce SSR hydration, synthetic inline probe reported and allowed, sanitized same-origin collector204; no DB or providers.');
}finally{
 tls.close();await browser?.close();if(!exit){child.kill('SIGTERM');await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,5000))]);if(!exit){child.kill('SIGKILL');await once(child,'exit');}}
}
