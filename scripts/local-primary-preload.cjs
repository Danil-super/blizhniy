// Explicit local launcher only. Production never imports this bridge. Real SQL
// is sent to the independently owned loopback fixture, never to a remote host.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const file=process.env.BLIZHNIY_LOCAL_PRIMARY_STATE;
if(process.env.BLIZHNIY_LOCAL_PRIMARY!=='enabled'||!file||!path.isAbsolute(file))throw Error('Local primary bridge is not enabled');
const parent=fs.lstatSync(path.dirname(file)),info=fs.lstatSync(file);
if(!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&511)!==448||fs.realpathSync(path.dirname(file))!==path.dirname(file)||
 !info.isFile()||info.uid!==process.getuid()||(info.mode&511)!==384||info.nlink!==1||info.size>8192||fs.realpathSync(file)!==file)throw Error('Unsafe local primary bridge state');
const state=JSON.parse(fs.readFileSync(file,'utf8'));
if(state.version!==1||state.project!==fs.realpathSync(path.join(__dirname,'..'))||state.origin!==process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN||
 !/^https:\/\/127\.0\.0\.1:\d{4,5}$/.test(state.origin)||!Number.isInteger(state.dbPort)||state.dbPort<1024||state.dbPort>65535||
 !/^[a-f0-9]{64}$/.test(state.containerId)||!/^blizhniy-primary-local-[a-f0-9]{12}$/.test(state.containerName)||state.database!=='blizhniy_prod'||
 !/^[a-f0-9]{64}$/.test(state.runtimePassword))throw Error('Invalid local primary bridge state');
const meta=JSON.parse(cp.execFileSync('docker',['--host','unix:///var/run/docker.sock','inspect',state.containerId],{env:{PATH:process.env.PATH},timeout:10000,maxBuffer:65536}))[0];
if(meta.Id!==state.containerId||meta.Name!=='/'+state.containerName||meta.Config?.Labels?.['blizhniy.primary-local']!==state.project||
 meta.Config.Image!=='postgres@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873'||
 JSON.stringify(meta.NetworkSettings?.Ports)!==JSON.stringify({'5432/tcp':[{HostIp:'127.0.0.1',HostPort:String(state.dbPort)}]}))throw Error('Foreign local primary database');
const pg=require('pg'),Pool=pg.Pool;
pg.Pool=class extends Pool{
 constructor(config){
  if(config?.host!=='17e86f80f26733d39ef4b84d.twc1.net'||config.database!=='blizhniy_prod'||config.user!=='blizhniy_runtime'||
   config.password!==state.runtimePassword||config.port!==5432||config.ssl?.rejectUnauthorized!==true||config.connectionString||config.stream)throw Error('Unexpected local primary database configuration');
  super({...config,host:'127.0.0.1',port:state.dbPort,ssl:false});
 }
};
// Fail closed for any accidental external SDK/socket use, including SMTP and
// merchant traffic. This process can talk only to local components of the stand.
const telegramEnabled=process.env.BLIZHNIY_TELEGRAM_PHONE==='enabled';
const net=require('node:net'),connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 const value=Array.isArray(args[0])?args[0][0]:args[0];
 const options=typeof value==='object'?value:null;
 const host=options?.host??(typeof args[1]==='string'?args[1]:undefined);
 const port=options?.port??(typeof value==='number'||typeof value==='string'?Number(value):undefined);
 if(options?.path||!Number.isInteger(Number(port))||Number(port)<1||Number(port)>65535||host&&!['127.0.0.1','::1','localhost'].includes(host)&&!(telegramEnabled&&host==='oauth.telegram.org'&&Number(port)===443))throw Error('External network disabled in local primary stand');
 return connect.apply(this,args);
};
const actualFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(!['127.0.0.1','[::1]','localhost'].includes(url.hostname)){
  const method=String(init?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
  if(!telegramEnabled||url.origin!=='https://oauth.telegram.org'||url.username||url.password||url.search||url.hash||
   !(method==='POST'&&url.pathname==='/token'||method==='GET'&&url.pathname==='/.well-known/jwks.json'))throw Error('External fetch disabled in local primary stand');
  return actualFetch(input,{...init,redirect:'error'});
 }
 return actualFetch(input,init);
};
