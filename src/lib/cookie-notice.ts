/** Display preference only; never consulted for session or resource access. */
export const cookieNoticeName='__Host-blizhniy_cookie_notice';
export const cookieNoticeOpenEvent='blizhniy-cookie-notice-open';
export function hasCookieNoticeAcknowledgement(cookies:string):boolean{
 const values=cookies.split(';').map(value=>value.trim()).filter(value=>value.startsWith(cookieNoticeName+'='));
 return values.length===1&&values[0]===cookieNoticeName+'=v1';
}
export function cookieNoticeAcknowledgement(now=Date.now()):string{
 const seconds=31536000;
 return `${cookieNoticeName}=v1; Path=/; Secure; SameSite=Lax; Max-Age=${seconds}; Expires=${new Date(now+seconds*1000).toUTCString()}`;
}
