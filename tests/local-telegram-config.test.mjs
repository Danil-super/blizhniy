import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,mkdirSync,chmodSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {readLocalTelegramConfig} from '../scripts/local-telegram-config.mjs';
test('local Telegram settings require an explicit owned private file, no secret fallback or extra options',()=>{
 assert.deepEqual(readLocalTelegramConfig(undefined,'https://127.0.0.1:3045'),{});const dir=mkdtempSync(join(tmpdir(),'blizhniy-telegram-config-'));chmodSync(dir,0o700);const file=join(dir,'telegram.json'),origin='https://127.0.0.1:3045';
 try{writeFileSync(file,JSON.stringify({clientId:'12345678',clientSecret:'synthetic-only-test-secret-value'}),{mode:0o600});const result=readLocalTelegramConfig(file,origin);assert.equal(result.BLIZHNIY_TELEGRAM_CALLBACK_URL,origin+'/api/account/phone/telegram/callback');assert.equal(result.BLIZHNIY_TELEGRAM_PHONE,'enabled');
  symlinkSync(file,join(dir,'link.json'));assert.throws(()=>readLocalTelegramConfig(join(dir,'link.json'),origin));chmodSync(file,0o644);assert.throws(()=>readLocalTelegramConfig(file,origin));chmodSync(file,0o600);
  for(const value of [{clientId:'12345678',clientSecret:'synthetic-only-test-secret-value',callbackUrl:'https://evil.invalid'},{clientId:12345678,clientSecret:'synthetic-only-test-secret-value'},{clientId:'12345678',clientSecret:''}]){writeFileSync(file,JSON.stringify(value));assert.throws(()=>readLocalTelegramConfig(file,origin));}
  const child=join(dir,'public');mkdirSync(child,{mode:0o755});const unsafe=join(child,'telegram.json');writeFileSync(unsafe,'{}',{mode:0o600});assert.throws(()=>readLocalTelegramConfig(unsafe,origin));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
