import {readMediaRetentionEnabled} from '../src/lib/media-retention-config.ts';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,open,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareLocalPrimaryFixture,stateDirectory,stateFile} from './local-primary-fixture.mjs';
import {readLocalTelegramConfig} from './local-telegram-config.mjs';
import {createLocalPrimaryProxy} from './local-primary-proxy.mjs';
import {startLocalBookingExpiry} from './local-booking-expiry.mjs';
import {startLocalPrimaryServices} from './local-primary-services.mjs';
import {readServiceCheckoutEnabled} from '../src/lib/service-checkout-config.ts';
import {readSpecialistCheckoutEnabled} from '../src/lib/specialist-checkout-config.ts';
import {startLocalServicePublicationQueue} from './local-service-publication-queue.mjs';
import {readPlacementRenewalsEnabled} from '../src/lib/placement-renewal-config.ts';
import {createLocalStartupStep} from './local-primary-startup.mjs';

async function main(){
const refunds=process.argv[3]==='--refunds';
const userAccess=process.env.BLIZHNIY_LOCAL_USER_ACCESS==='enabled';
const tariffs=process.env.BLIZHNIY_ADMIN_TARIFFS==='local-v1';
if(process.env.BLIZHNIY_ADMIN_TARIFFS!==undefined&&(!tariffs||!userAccess))throw Error('Invalid local tariff mode');
if(process.env.BLIZHNIY_LOCAL_USER_ACCESS!==undefined&&!userAccess)throw Error('Invalid local user operator mode');
if(!['--prepare','--start','--background'].includes(process.argv[2])||!(process.argv.length===3||process.argv.length===4&&refunds&&process.argv[2]!=='--prepare'))throw Error('Invalid local primary command');
const step=createLocalStartupStep();
const state=await step('fixture',()=>prepareLocalPrimaryFixture());
if(process.argv[2]==='--prepare')console.log(JSON.stringify({ready:true,origin:state.origin}));
else if(process.argv[2]==='--background'){
 if(Number(process.versions.node.split('.')[0])!==22)throw Error('Local primary requires Node22');
 const log=await open(join(stateDirectory,'launcher.log'),'a',0o600);
 const child=spawn(process.execPath,['--experimental-strip-types',join(state.project,'scripts/local-primary.mjs'),'--start',...(refunds?['--refunds']:[])],{
  cwd:state.project,env:{...(tariffs?{BLIZHNIY_ADMIN_TARIFFS:'local-v1'}:{}),...(userAccess?{BLIZHNIY_LOCAL_USER_ACCESS:'enabled'}:{}),...(process.env.BLIZHNIY_SPECIALIST_CHECKOUT?{BLIZHNIY_SPECIALIST_CHECKOUT:process.env.BLIZHNIY_SPECIALIST_CHECKOUT}:{}),PATH:process.env.PATH,LANG:'C.UTF-8',...(process.env.BLIZHNIY_LOCAL_TELEGRAM_CONFIG?{BLIZHNIY_LOCAL_TELEGRAM_CONFIG:process.env.BLIZHNIY_LOCAL_TELEGRAM_CONFIG}:{}),...(process.env.BLIZHNIY_PLACEMENT_RENEWALS?{BLIZHNIY_PLACEMENT_RENEWALS:process.env.BLIZHNIY_PLACEMENT_RENEWALS}:{}),...(process.env.BLIZHNIY_MEDIA_RETENTION?{BLIZHNIY_MEDIA_RETENTION:process.env.BLIZHNIY_MEDIA_RETENTION}:{}),...(process.env.BLIZHNIY_SERVICE_CHECKOUT?{BLIZHNIY_SERVICE_CHECKOUT:process.env.BLIZHNIY_SERVICE_CHECKOUT}:{})},detached:true,stdio:['ignore',log.fd,log.fd],
 });
 await once(child,'spawn');await log.close();child.unref();
 await writeFile(join(stateDirectory,'launcher-process.json'),JSON.stringify({version:1,pid:child.pid,project:state.project,origin:state.origin}),{mode:0o600});
 console.log(JSON.stringify({starting:true,pid:child.pid,url:state.origin+'/__local'}));
}
else{
 if(Number(process.versions.node.split('.')[0])!==22)throw Error('Local primary requires the verified Node22 runtime');
 await step('build',()=>readFile(join(state.project,'.next','BUILD_ID'),'utf8'));
 process.env.NODE_ENV='test';
 process.env.BLIZHNIY_LOCAL_PRIMARY='enabled';
 process.env.BLIZHNIY_LOCAL_PRIMARY_ORIGIN=state.origin;
 process.env.BLIZHNIY_LISTING_WORKFLOW='postmoderation';
 const telegram=await step('configuration',()=>readLocalTelegramConfig(process.env.BLIZHNIY_LOCAL_TELEGRAM_CONFIG,state.origin));
 Object.assign(process.env,telegram);
 const {localPrimaryPaymentHandler}=await import('./local-primary-payment.mjs');
 const env={...telegram,...(tariffs?{BLIZHNIY_ADMIN_TARIFFS:'local-v1'}:{}),...(readSpecialistCheckoutEnabled()?{BLIZHNIY_SPECIALIST_CHECKOUT:'local-v1'}:{}),...(readMediaRetentionEnabled()?{BLIZHNIY_MEDIA_RETENTION:'local-v1'}:{}),...(readServiceCheckoutEnabled()?{BLIZHNIY_SERVICE_CHECKOUT:'local-v1'}:{}),...(readPlacementRenewalsEnabled()?{BLIZHNIY_PLACEMENT_RENEWALS:'local-v1'}:{}),BLIZHNIY_CSP_MODE:'enforce',PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'production',__NEXT_PROCESSED_ENV:'true',NEXT_TELEMETRY_DISABLED:'1',
  BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_STATE:stateFile,BLIZHNIY_LOCAL_PRIMARY_ORIGIN:state.origin,BLIZHNIY_LISTING_WORKFLOW:'postmoderation',BLIZHNIY_APPLICATION_CONTACT_VIEWS:'enabled',BLIZHNIY_BOOKING_LIFECYCLE:'local-v1',BLIZHNIY_WORK_OWNER_ACTIONS:'local-v1',BLIZHNIY_CHECKOUT_CANCELLATION:'local-v1',
  BLIZHNIY_AUTH_MODE:'postgres',BLIZHNIY_AUTH_REMEMBERED_CAPTCHA:'enabled',BLIZHNIY_AUTH_CONFIRMATION_NOTICE:'enabled',
  BLIZHNIY_AUTH_ORIGIN:'https://xn----9sbphbgks4a4a.xn--p1ai',BLIZHNIY_AUTH_RATE_SECRET:state.rateSecret,
  BLIZHNIY_AUTH_MAIL_KEY_FILE:join(stateDirectory,'mail-key.bin'),BLIZHNIY_DB_HOST:'17e86f80f26733d39ef4b84d.twc1.net',
  BLIZHNIY_DB_PORT:'5432',BLIZHNIY_DB_NAME:'blizhniy_prod',BLIZHNIY_DB_USER:'blizhniy_runtime',BLIZHNIY_DB_PASSWORD:state.runtimePassword,
  BLIZHNIY_DB_SSL_MODE:'verify-full',BLIZHNIY_DB_CA_FILE:join(stateDirectory,'tls-cert.pem'),
  BLIZHNIY_MAIL_MODE:'timeweb',BLIZHNIY_SMTP_USER:'notifications@ближний-ру.рф',BLIZHNIY_SMTP_PASSWORD:'synthetic-local-not-used-by-smtp',
  TURNSTILE_SECRET_KEY:'synthetic-local-not-used-by-provider',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'synthetic-local-primary-site-key',
  BLIZHNIY_LISTING_CONTACT_METHOD:'enabled',BLIZHNIY_LISTING_CHECKOUT:'prepare-only',BLIZHNIY_PAYMENT_MODE:'test',...(refunds?{BLIZHNIY_REFUND_ADMIN:'local-test'}:{})};
 const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  const services=await step('services',()=>startLocalPrimaryServices({signal:controller.signal,
   ...(refunds?{createRefunds:signal=>step('refunds',async()=>(await import('./local-primary-refunds.mjs')).startLocalPrimaryRefunds({stateFile,signal,report:async event=>console.info(JSON.stringify(event))}))}:{}),
   ...(userAccess?{createUserAccess:signal=>step('user-access',async()=>(await import('./local-primary-user-access.mjs')).startLocalPrimaryUserAccess(signal))}:{}),
   createProxy:(socket,signal,userSocket)=>step('proxy',async()=>{
    const proxy=await createLocalPrimaryProxy(state,{paymentHandler:localPrimaryPaymentHandler,...(socket?{refundOperatorSocket:socket}:{}),...(userSocket?{userAccessOperatorSocket:userSocket,tariffs}:{})});
    try{signal.throwIfAborted();proxy.server.listen(Number(new URL(state.origin).port),'127.0.0.1');await once(proxy.server,'listening');signal.throwIfAborted();return proxy;}
    catch(error){await proxy.close();throw error;}
   }),
   startApplication:(signal,userSocket)=>step('application',async()=>{
    const log=await open(join(stateDirectory,'next.log'),'a',0o600);let child,done,closing;
    const close=()=>closing??=(async()=>{
     if(!child)return;
     if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
     const timer=setTimeout(()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');},5000);timer.unref();
     try{await done;}finally{clearTimeout(timer);}
    })();
    try{
     signal.throwIfAborted();child=spawn(process.execPath,['--require',join(state.project,'scripts/local-primary-preload.cjs'),join(state.project,'node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(state.upstreamPort)],{cwd:state.project,env:{...env,...(userSocket?{BLIZHNIY_USER_ACCESS_OPERATOR:'local-v1',BLIZHNIY_USER_ACCESS_SOCKET:userSocket}:{})},stdio:['ignore',log.fd,log.fd]});
     done=new Promise(resolve=>{child.once('error',()=>resolve(1));child.once('exit',code=>resolve(code??1));});
     const spawned=once(child,'spawn').then(()=>true,()=>false);await log.close();if(!await spawned)throw Error('Local app spawn failed');signal.throwIfAborted();return{done,close};
    }catch(error){try{await log.close();}finally{await close();}throw error;}
   }),
   startExpiry:()=>step('expiry',async()=>{
    const booking=startLocalBookingExpiry(state);let services;
    try{if(readServiceCheckoutEnabled())services=startLocalServicePublicationQueue(state);
     return{close:async()=>{try{await services?.close();}finally{await booking.close();}}};
    }catch(error){await booking.close();throw error;}
   }),
   onReady:async()=>{console.log(`Локальный PostgreSQL-стенд: ${state.origin}/__local`);console.log('Только синтетические данные; письма перехватываются; внешние платежи и SMTP недоступны.');},
  }));
  process.exitCode=await services.done;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
}
main().catch(()=>{console.error('Локальный стенд не запущен. Проверьте собственную конфигурацию и занятость портов; рабочий сервер не изменён.');process.exitCode=1;});
