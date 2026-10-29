import {createHash} from 'node:crypto';
import {lstatSync,readdirSync,readFileSync,realpathSync,chmodSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const invalid=()=>new Error('Invalid prebuilt release');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicPath=name=>!name.split('/').some(part=>['.git','.pm2','.codex','.npmrc','.previous-release'].includes(part)||
 part==='.env'||part.startsWith('.env.')||/\.(pem|key|crt)$/i.test(part));
const relativePath=name=>typeof name==='string'&&name.length>0&&name.length<=4096&&!/[\\\u0000-\u001f\u007f]/.test(name)&&
 !name.startsWith('/')&&!name.split('/').some(part=>!part||part==='.'||part==='..')&&publicPath(name);

/** Only a fresh, owned package, before runtime environment files are copied. */
export function collectPrebuiltFiles(root){
 if(!isAbsolute(root)||resolve(root)!==root||realpathSync(root)!==root)throw invalid();
 const files=Object.create(null),directories=[];let bytes=0,count=0;
 function visit(path,relative,depth){
  if(depth>100)throw invalid();
  const info=lstatSync(path);
  if(info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o7022))throw invalid();
  if(info.isDirectory()){
   directories.push(path);
   for(const name of readdirSync(path)){
    const child=relative?relative+'/'+name:name;
    if(!relativePath(child))throw invalid();visit(path+'/'+name,child,depth+1);
   }
  }else{
   if(!info.isFile()||info.nlink!==1||info.size>128*1024*1024)throw invalid();
   if(relative==='release-manifest.json')return;
   if(++count>20000||(bytes+=info.size)>1024*1024*1024)throw invalid();
   files[relative]={sha256:hash(readFileSync(path)),mode:info.mode&0o111?0o755:0o644};
  }
 }
 visit(root,'',0);return{files,directories};
}

/** Archive SHA256 is checked by the installer before this module executes. */
export function preparePrebuiltRelease(root,commit){
 if(!/^[a-f0-9]{40}$/.test(commit??''))throw invalid();
 const metadata=lstatSync(root+'/release-manifest.json');
 if(!metadata.isFile()||metadata.isSymbolicLink()||metadata.uid!==process.getuid()||metadata.nlink!==1||metadata.size>16*1024*1024)throw invalid();
 const manifest=JSON.parse(readFileSync(root+'/release-manifest.json','utf8'));
 if(manifest?.format!==2||manifest.commit!==commit||manifest.buildId!==commit||
  manifest.platform!==process.platform||manifest.arch!==process.arch||manifest.platform!=='linux'||manifest.arch!=='x64'||
  !/^v22\.\d+\.\d+$/.test(manifest.node??'')||!/^22\.\d+\.\d+$/.test(process.versions.node)||
  Number(manifest.node.split('.')[1])<18||Number(process.versions.node.split('.')[1])<Number(manifest.node.split('.')[1])||
  !/^\d+\.\d+$/.test(manifest.glibc??'')||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw invalid();
 const runtimeGlibc=process.report.getReport().header.glibcVersionRuntime;
 if(!/^\d+\.\d+$/.test(runtimeGlibc??''))throw invalid();
 const [buildMajor,buildMinor]=manifest.glibc.split('.').map(Number),[major,minor]=runtimeGlibc.split('.').map(Number);
 if(major<buildMajor||major===buildMajor&&minor<buildMinor)throw invalid();
 for(const [name,entry]of Object.entries(manifest.files)){
  if(!relativePath(name)||name==='release-manifest.json'||!entry||typeof entry!=='object'||
   Object.keys(entry).sort().join()!=='mode,sha256'||!/^([a-f0-9]{64})$/.test(entry.sha256??'')||![0o644,0o755].includes(entry.mode))throw invalid();
 }
 const {files,directories}=collectPrebuiltFiles(root),names=Object.keys(files);
 if(names.length!==Object.keys(manifest.files).length)throw invalid();
 for(const [name,entry]of Object.entries(files))if(!Object.hasOwn(manifest.files,name)||
  manifest.files[name].sha256!==entry.sha256||manifest.files[name].mode!==entry.mode)throw invalid();
 for(const name of ['server.js','.next/BUILD_ID','package-lock.json','ecosystem.config.cjs','scripts/web-runtime.cjs',
  'scripts/check-auth-captcha-env.cjs','scripts/rollback-release.sh','scripts/auth-mail-worker.mjs',
  'node_modules/@next/env/package.json','node_modules/nodemailer/package.json'])if(!Object.hasOwn(files,name))throw invalid();
 if(readFileSync(root+'/.next/BUILD_ID','utf8').trim()!==commit||
  hash(readFileSync(root+'/package-lock.json'))!==manifest.lockfileSha256)throw invalid();
 // No env or runtime data exists in this fresh tree. Only verified code is made readable.
 for(const directory of directories)chmodSync(directory,0o755);
 for(const [name,entry]of Object.entries(files))chmodSync(root+'/'+name,entry.mode);
 chmodSync(root+'/release-manifest.json',0o644);
 return{commit,files:names.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==4)throw invalid();console.log(JSON.stringify(preparePrebuiltRelease(process.argv[2],process.argv[3])));}
 catch{console.error('Prebuilt integrity or compatibility check failed');process.exitCode=1;}
}
