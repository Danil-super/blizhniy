const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function bridge(enabled){
 const project='/synthetic/project',file='/private/state.json',calls=[];
 const state={version:1,project,origin:'https://127.0.0.1:3045',dbPort:35432,containerId:'a'.repeat(64),containerName:'blizhniy-primary-local-123456789abc',database:'blizhniy_prod',runtimePassword:'b'.repeat(64)};
 const metadata={Id:state.containerId,Name:'/'+state.containerName,Config:{Image:'postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873',Labels:{'blizhniy.primary-local':project}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:String(state.dbPort)}]}}};
 const socket={prototype:{connect(...args){calls.push(['socket',args]);return true;}}};
 const fakeFs={constants:fs.constants,openSync:()=>1,closeSync(){},fstatSync:()=>({isFile:()=>true,uid:42,mode:0o600,nlink:1,size:512}),lstatSync:value=>({isDirectory:()=>value==='/private',isFile:()=>value===file,uid:42,mode:value==='/private'?0o700:0o600,nlink:1,size:512}),realpathSync:value=>value,readFileSync:()=>JSON.stringify(state)};
 const sandbox={__dirname:project+'/scripts',process:{env:{PATH:'/synthetic/bin',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_STATE:file,BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,...(enabled?{BLIZHNIY_TELEGRAM_PHONE:'enabled'}:{})},getuid:()=>42},URL,Request,
  fetch:async(...args)=>{calls.push(['fetch',...args]);return true;},require:name=>{
   if(name==='node:fs')return fakeFs;if(name==='node:path')return path;if(name==='node:child_process')return{execFileSync:()=>JSON.stringify([metadata])};if(name==='node:net')return{Socket:socket};if(name==='pg')return{Pool:class{}};assert.fail('Unexpected preload dependency '+name);
  }};
 vm.runInNewContext(fs.readFileSync(new URL('../scripts/local-primary-preload.cjs',`file://${__filename}`),'utf8'),sandbox);
 return{calls,fetch:sandbox.fetch,connect:value=>socket.prototype.connect(value)};
}
test('default local bridge denies Telegram as well as merchant and SMTP network access',()=>{
 const b=bridge(false);for(const host of ['oauth.telegram.org','api.yookassa.ru','smtp.example.invalid']){assert.throws(()=>b.connect({host,port:443}));assert.throws(()=>b.fetch('https://'+host+'/token',{method:'POST'}));}assert.equal(b.calls.length,0);
});
test('explicit Telegram mode allows only official token/JWKS fetch and TLS port without enabling other services',async()=>{
 const b=bridge(true);await b.fetch('https://oauth.telegram.org/token',{method:'POST',redirect:'follow'});await b.fetch('https://oauth.telegram.org/.well-known/jwks.json');assert.equal(b.calls[0][2].redirect,'error');assert.equal(b.connect({host:'oauth.telegram.org',port:443}),true);
 for(const [url,method]of [['https://oauth.telegram.org/auth','GET'],['https://oauth.telegram.org/token?leak=1','POST'],['https://oauth.telegram.org/token','GET'],['https://oauth.telegram.org/.well-known/jwks.json','POST'],['https://api.yookassa.ru/v3/payments','POST'],['https://evil.invalid/token','POST']])assert.throws(()=>b.fetch(url,{method}));
 for(const value of [{host:'oauth.telegram.org',port:80},{host:'api.yookassa.ru',port:443},{host:'smtp.example.invalid',port:465}])assert.throws(()=>b.connect(value));
});
