import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,open,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareLocalPrimaryFixture,stateDirectory,stateFile} from './local-primary-fixture.mjs';
import {readLocalTelegramConfig} from './local-telegram-config.mjs';
import {createLocalPrimaryProxy} from './local-primary-proxy.mjs';
import {startLocalBookingExpiry} from './local-booking-expiry.mjs';

async function main(){
if(!['--prepare','--start','--background'].includes(process.argv[2])||process.argv.length!==3)throw Error('Usage: node --experimental-strip-types scripts/local-primary.mjs --prepare|--start|--background');
const state=await prepareLocalPrimaryFixture();
if(process.argv[2]==='--prepare')console.log(JSON.stringify({ready:true,origin:state.origin}));
else if(process.argv[2]==='--background'){
 if(Number(process.versions.node.split('.')[0])!==22)throw Error('Local primary requires Node22');
 const log=await open(join(stateDirectory,'launcher.log'),'a',0o600);
 const child=spawn(process.execPath,['--experimental-strip-types',join(state.project,'scripts/local-primary.mjs'),'--start'],{
  cwd:state.project,env:{PATH:process.env.PATH,LANG:'C.UTF-8',...(process.env.BLIZHNIY_LOCAL_TELEGRAM_CONFIG?{BLIZHNIY_LOCAL_TELEGRAM_CONFIG:process.env.BLIZHNIY_LOCAL_TELEGRAM_CONFIG}:{})},detached:true,stdio:['ignore',log.fd,log.fd],
 });
 await once(child,'spawn');await log.close();child.unref();
 await writeFile(join(stateDirectory,'launcher-process.json'),JSON.stringify({version:1,pid:child.pid,project:state.project,origin:state.origin}),{mode:0o600});
 console.log(JSON.stringify({starting:true,pid:child.pid,url:state.origin+'/__local'}));
}
else{
 if(Number(process.versions.node.split('.')[0])!==22)throw Error('Local primary requires the verified Node22 runtime');
 await readFile(join(state.project,'.next','BUILD_ID'),'utf8');
 process.env.NODE_ENV='test';
 process.env.BLIZHNIY_LOCAL_PRIMARY='enabled';
 process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN=state.origin;
 process.env.BLIZHNIY_LISTING_WORKFLOW='postmoderation';
 const telegram=readLocalTelegramConfig(process.env.BLIZHNIY_LOCAL_TELEGRAM_CONFIG,state.origin);
 Object.assign(process.env,telegram);
 const {localPrimaryPaymentHandler}=await import('./local-primary-payment.mjs');
 const proxy=await createLocalPrimaryProxy(state,{paymentHandler:localPrimaryPaymentHandler});
 proxy.server.listen(Number(new URL(state.origin).port),'127.0.0.1');
 try{await once(proxy.server,'listening');}catch(error){await proxy.close();throw error;}
 const env={...telegram,BLIZHNIY_CSP_MODE:'enforce',PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',
  BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_STATE:stateFile,BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_APPLICATION_CONTACT_VIEWS:'enabled',BLIZHNIY_BOOKING_LIFECYCLE:'local-v1',BLIZHNIY_WORK_OWNER_ACTIONS:'local-v1',
  BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_REMEMBERED_CAPTCHA:'enabled',BLIZHNIY_AUTH_CONFIRMATION_NOTICE:'enabled',
  BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_AUTH_RATE_SECRET:state.rateSecret,
  BLIZHNIY_AUTH_MAIL_KEY_FILE:join(stateDirectory,'mail-key.bin'),BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',
  BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:state.runtimePassword,
  BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:join(stateDirectory,'tls-cert.pem'),
  BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-local-not-used-by-smtp',
  TURNSTILE_SECRET_KEY:'synthetic-local-not-used-by-provider',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'synthetic-local-primary-site-key',
  BLIZHNIY_LISTING_CONTACT_METHOD:'enabled',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test'};
 const log=await open(join(stateDirectory,'next.log'),'a',0o600);
 const child=spawn(process.execPath,['--require',join(state.project,'scripts/local-primary-preload.cjs'),join(state.project,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(state.upstreamPort)],
  {cwd:state.project,env,stdio:['ignore',log.fd,log.fd]});
 await log.close();
 const expiry=startLocalBookingExpiry(state);
 let stopping=false;
 const stop=async()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');await expiry.close();await proxy.close();};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
 child.once('exit',async code=>{await stop();process.exitCode=code||0;});
 child.once('error',async()=>{console.error('Local application failed to start');await stop();process.exitCode=1;});
 console.log(`Локальный PostgreSQL-стенд: ${state.origin}/__local`);
 console.log('Только синтетические данные; письма перехватываются; внешние платежи и SMTP недоступны.');
}
}
main().catch(()=>{console.error('Локальный стенд не запущен. Проверьте собственную конфигурацию и занятость портов; рабочий сервер не изменён.');process.exitCode=1;});
