import assert from 'node:assert/strict';
import {test} from 'node:test';
import {allowLocalPrimaryRequest} from '../scripts/local-primary-origin.mjs';

const origin='https://127.0.0.1:3045';
const request=(path,headers={},method='GET')=>({url:path,method,socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:3045',...headers}});
const navigation={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'};
test('Telegram callback and its redirected review document can finish a cross-site top-level navigation',()=>{
 for(const path of ['/api/account/phone/telegram/callback?code=synthetic&state=synthetic','/cabinet/phone?error=cancelled','/cabinet/phone?attempt=synthetic']){
  assert.equal(allowLocalPrimaryRequest(request(path,navigation),origin,true),true);
  assert.equal(allowLocalPrimaryRequest(request(path,navigation),origin,false),false);
 }
});
test('Telegram return allowance does not admit foreign requests to other pages, APIs, frames or mutations',()=>{
 for(const path of ['/cabinet','/cabinet/phone/other','/api/account/phone/confirm','/api/account/profile','/api/account/phone/telegram/callback/other'])
  assert.equal(allowLocalPrimaryRequest(request(path,navigation),origin,true),false);
 for(const headers of [{...navigation,'sec-fetch-dest':'iframe'},{...navigation,'sec-fetch-mode':'cors'},{'sec-fetch-site':'cross-site'},
  {...navigation,host:'example.org'},{...navigation,origin:'https://example.org'}])
  assert.equal(allowLocalPrimaryRequest(request('/cabinet/phone',headers),origin,true),false);
 assert.equal(allowLocalPrimaryRequest(request('/cabinet/phone',navigation,'POST'),origin,true),false);
 const foreign=request('/cabinet/phone',navigation);foreign.socket.remoteAddress='192.0.2.1';
 assert.equal(allowLocalPrimaryRequest(foreign,origin,true),false);
});
test('ordinary same-origin local requests retain their origin and host checks',()=>{
 assert.equal(allowLocalPrimaryRequest(request('/api/account/profile',{origin,'sec-fetch-site':'same-origin'},'POST'),origin,false),true);
 assert.equal(allowLocalPrimaryRequest(request('/api/account/profile',{origin:'https://example.org'},'POST'),origin,true),false);
 assert.equal(allowLocalPrimaryRequest(request('/api/account/phone/telegram/callback',{...navigation,origin:'https://oauth.telegram.org'}),origin,true),true);
});
