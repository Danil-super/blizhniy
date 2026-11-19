import assert from 'node:assert/strict';
import {createServer, get} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {once} from 'node:events';
import {chromium} from 'playwright';
import sharp from 'sharp';

const first='12345678-1234-4321-8765-123456789abc', second='22345678-1234-4321-8765-123456789abc';
const payment='32345678-1234-4321-8765-123456789abc', editedTitle='Черновик до перехода';

export async function testCachedCabinetScreen(origin, draftPath) {
  const app = new URL(origin);
  assert.equal(app.protocol, 'http:');
  assert.equal(app.hostname, '127.0.0.1');
  assert.equal(app.origin, origin);
  let active=first;
  const photo=await sharp({create:{width:8,height:8,channels:3,background:'navy'}}).webp().toBuffer();
  const browser=await chromium.launch({channel:'chromium',ignoreDefaultArgs:['--disable-back-forward-cache']});
  const fixture=createServer(async(req,res)=>{
    let upstream;
    try {
      const target=new URL(req.url,origin);
      assert.equal(target.origin,origin);
      if(target.pathname==='/fixture/change' && req.method==='POST'){active=second;res.writeHead(204).end();return;}
      if(target.pathname.startsWith('/fixture/')){res.setHeader('Content-Type','text/html');res.end('<title>Control</title>');return;}
      if(target.pathname==='/api/account/session'){res.end(JSON.stringify({user:{id:active,email:'user@example.invalid',role:'user',isBlocked:false}}));return;}
      if(target.pathname==='/api/account/media/read' && active===first){res.writeHead(200,{'Content-Type':'image/webp'}).end(photo);return;}
      if(target.pathname==='/api/account/payments'){
        const items=active===first?[{id:payment,targetType:'listing',amount:'399.00',status:'succeeded',isTest:true,createdAt:'2026-11-01T12:00:00.000000Z'}]:[];
        res.end(JSON.stringify({items,nextCursor:null}));return;
      }
      if(target.pathname.startsWith('/api/account/')){res.writeHead(404).end('{"error":{"code":"NOT_FOUND"}}');return;}
      const headers={...req.headers};delete headers.host;delete headers.connection;
      if(draftPath && target.pathname==='/razmestit/obyavlenie')headers.cookie='__Host-blizhniy_session='+'a'.repeat(64);
      const request = get({
        hostname: '127.0.0.1', port: app.port, path: target.pathname + target.search, headers,
      });
      [upstream] = await once(request, 'response');
      const reply = { ...upstream.headers };
      delete reply.connection;
      delete reply['transfer-encoding'];
      // Test the cached-document branch even in Chromium versions that evict no-store pages.
      if(req.headers['sec-fetch-dest']==='document'){
        assert.match(reply['cache-control']??'',/no-store/);
        reply['cache-control']='private, no-cache';
      }
      res.writeHead(upstream.statusCode, reply);
      await pipeline(upstream, res);
    } catch {
      upstream?.destroy();
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end();
    }
  });
  try {
    fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
    const base='http://127.0.0.1:'+fixture.address().port;
    const context=await browser.newContext(),page=await context.newPage(),other=await context.newPage();
    await other.goto(base+'/fixture/control');
    await page.addInitScript(({payment,title,draft})=>{
      window.privateFields=()=>draft?{
        title:document.querySelector('input[name="title"]')?.value===title,
        price:document.querySelector('input[name="price"]')?.value==='199.99',
        phone:!!sessionStorage.fixturePhone && document.querySelector('input[name="phone"]')?.value===sessionStorage.fixturePhone,
        photo:document.querySelector('figure img[src^="blob:"]')!==null,
      }:{
        payment:document.body.innerText.includes(payment),
        amount:!!document.querySelector('[aria-label="История платежей"] li p')?.textContent.includes('399'),
      };
      addEventListener('pageshow',event=>{window.lastShow={cached:event.persisted,fields:window.privateFields()};});
      const original=window.fetch.bind(window);
      window.fetch=async(input,options)=>{
        if(sessionStorage.hold && new URL(input instanceof Request?input.url:input,location.href).pathname==='/api/account/session'){
          await new Promise(resolve=>(window.sessionWaiters??=[]).push(resolve));
        }
        return original(input,options);
      };
    },{payment,title:editedTitle,draft:Boolean(draftPath)});
    const url=base+(draftPath??'/cabinet/oplata');
    await page.goto(url);
    if(draftPath) {
      await page.locator('input[name="title"]').fill(editedTitle);
      await page.locator('input[name="phone"]').fill('+79991112233');
      await page.evaluate(()=>{sessionStorage.fixturePhone=document.querySelector('input[name="phone"]').value;});
    }
    else await page.getByText('Заказ '+payment,{exact:true}).waitFor();
    for(const changed of [false,true]){
      await page.waitForFunction(()=>Object.values(window.privateFields()).every(Boolean));
      await page.evaluate(()=>{sessionStorage.hold='yes';window.sessionWaiters=[];});
      await page.goto(base+'/fixture/away');
      if(changed) assert.equal(await other.evaluate(async()=>(await fetch('/fixture/change',{method:'POST'})).status),204);
      await page.evaluate(()=>history.back());
      await page.waitForURL(url,{waitUntil:'commit'});
      await page.waitForFunction(()=>window.lastShow && window.sessionWaiters?.length);
      const state=await page.evaluate(()=>({show:window.lastShow,waiting:window.privateFields()}));
      assert.equal(state.show.cached,true,'a real cached document was restored');
      for(const field of Object.keys(state.show.fields)){
        assert.equal(state.show.fields[field],false,field+' present at pageshow');
        assert.equal(state.waiting[field],false,field+' present before session reply');
      }
      await page.evaluate(()=>{delete sessionStorage.hold;window.sessionWaiters.splice(0).forEach(resolve=>resolve());});
      if(!changed) await page.waitForFunction(()=>Object.values(window.privateFields()).every(Boolean));
      else if(draftPath) await page.getByText('Аккаунт изменился.',{exact:false}).waitFor();
      else await page.getByText('Платежей пока нет',{exact:true}).waitFor();
      if(changed) assert.ok(await page.evaluate(()=>Object.values(window.privateFields()).every(value=>!value)),
        'the new account must not regain any previous values');
    }
  } finally {
    await browser.close();
    fixture.closeAllConnections();
    if(fixture.listening)await new Promise(resolve=>fixture.close(resolve));
  }
}
