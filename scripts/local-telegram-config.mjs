import {openSync,closeSync,fstatSync,lstatSync,readFileSync,realpathSync,constants} from 'node:fs';
import {isAbsolute,dirname} from 'node:path';
import {readTelegramPhoneConfig} from '../src/lib/telegram-phone-config.ts';
/** Explicit optional local configuration. No dotenv or production secret fallback. */
export function readLocalTelegramConfig(file,origin){
 if(file===undefined)return{};
 if(!isAbsolute(file)||typeof origin!=='string'||!/^https:\/\/127\.0\.0\.1:\d{4,5}$/.test(origin))throw Error('Invalid local Telegram configuration');
 const parent=lstatSync(dirname(file));if(!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&511)!==448||realpathSync(dirname(file))!==dirname(file))throw Error('Unsafe local Telegram directory');
 let descriptor;
 try{
  descriptor=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const info=fstatSync(descriptor);
  if(!info.isFile()||info.uid!==process.getuid()||(info.mode&511)!==384||info.nlink!==1||info.size>2048||realpathSync(file)!==file)throw Error('Unsafe local Telegram file');
  const value=JSON.parse(readFileSync(descriptor,'utf8'));
  if(!value||Object.keys(value).sort().join()!=='clientId,clientSecret')throw Error('Invalid local Telegram settings');
  const env={BLIZHNIY_TELEGRAM_PHONE:'enabled',BLIZHNIY_TELEGRAM_CLIENT_ID:value.clientId,BLIZHNIY_TELEGRAM_CLIENT_SECRET:value.clientSecret,
   BLIZHNIY_TELEGRAM_CALLBACK_URL:origin+'/api/account/phone/telegram/callback',BLIZHNIY_LOCAL_PRIMARY:'enabled',BLIZHNIY_LOCAL_PRIMARY_ORIGIN:origin};
  readTelegramPhoneConfig(env);return env;
 }finally{if(descriptor!==undefined)closeSync(descriptor);}
}
