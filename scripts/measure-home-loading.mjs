// Read-only laboratory measurement. Fresh browser contexts; cache disabled.
// BASE_URL=http://127.0.0.1:3048 node scripts/measure-home-loading.mjs
import { chromium } from 'playwright';
const base=process.env.BASE_URL;
if(!base)throw new Error('BASE_URL required');
const profiles={mobile:{viewport:{width:412,height:823},deviceScaleFactor:1.75,cpu:4,latency:150,throughput:1638.4},desktop:{viewport:{width:1350,height:940},deviceScaleFactor:1,cpu:1,latency:40,throughput:10240}};
const browser=await chromium.launch();
try{for(const [profile,p]of Object.entries(profiles))for(let run=1;run<=3;run++){
 const context=await browser.newContext({viewport:p.viewport,deviceScaleFactor:p.deviceScaleFactor});
 const page=await context.newPage();const cdp=await context.newCDPSession(page);
 const errors=[];const requests=[];page.on('pageerror',e=>errors.push(e.message));
 await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:p.latency,downloadThroughput:p.throughput*1024/8,uploadThroughput:p.throughput*1024/8});
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:p.cpu});
 cdp.on('Network.responseReceived',e=>requests.push({id:e.requestId,url:e.response.url,type:e.type,mime:e.response.mimeType,status:e.response.status,bytes:0}));
 cdp.on('Network.loadingFinished',e=>{const r=requests.find(r=>r.id===e.requestId);if(r)r.bytes=e.encodedDataLength;});
 await page.addInitScript(()=>{window.__lcp=0;window.__cls=0;new PerformanceObserver(list=>{for(const e of list.getEntries())window.__lcp=e.startTime;}).observe({type:'largest-contentful-paint',buffered:true});new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)window.__cls+=e.value;}).observe({type:'layout-shift',buffered:true});});
 const response=await page.goto(base,{waitUntil:'load',timeout:60000});await page.waitForTimeout(2500);
 const metrics=await page.evaluate(()=>({lcp:window.__lcp,cls:window.__cls,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,overflow:document.documentElement.scrollWidth>innerWidth,hero:[...document.querySelectorAll('img[fetchpriority="high"]')].map(i=>({src:i.currentSrc,width:i.clientWidth,naturalWidth:i.naturalWidth})),images:document.images.length}));
 const images=requests.filter(r=>r.type==='Image');console.log(JSON.stringify({profile,run,status:response.status(),...metrics,imageBytes:images.reduce((n,r)=>n+r.bytes,0),totalBytes:requests.reduce((n,r)=>n+r.bytes,0),imageRequests:images.map(({url,bytes,mime,status})=>({url,bytes,mime,status})),errors}));await context.close();
}}finally{await browser.close();}
