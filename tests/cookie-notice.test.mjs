import assert from 'node:assert/strict';
import test from 'node:test';
import {cookieNoticeName,cookieNoticeAcknowledgement,hasCookieNoticeAcknowledgement} from '../src/lib/cookie-notice.ts';
test('cookie notice accepts only one exact acknowledgement and never interprets an auth cookie',()=>{
 assert.equal(hasCookieNoticeAcknowledgement(''),false);
 assert.equal(hasCookieNoticeAcknowledgement('__Host-blizhniy_session=synthetic'),false);
 assert.equal(hasCookieNoticeAcknowledgement(cookieNoticeName+'=v1'),true);
 assert.equal(hasCookieNoticeAcknowledgement('other=x; '+cookieNoticeName+'=v1; extra=y'),true);
 for(const value of ['v2','true','v1junk',''])assert.equal(hasCookieNoticeAcknowledgement(cookieNoticeName+'='+value),false);
 assert.equal(hasCookieNoticeAcknowledgement(cookieNoticeName+'=v1; '+cookieNoticeName+'=v1'),false);
});
test('acknowledgement is a non-authorizing host-only HTTPS preference lasting one year',()=>{
 const now=Date.UTC(2026,9,29),value=cookieNoticeAcknowledgement(now);
 assert.ok(value.startsWith(cookieNoticeName+'=v1;'));
 for(const attribute of ['Path=/','Secure','SameSite=Lax','Max-Age=31536000','Expires=Fri, 29 Oct 2027 00:00:00 GMT'])assert.ok(value.includes(attribute),attribute);
 assert.doesNotMatch(value,/Domain=|HttpOnly|session=|token=/i);
});
