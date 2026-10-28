// Browser redirects retain Sec-Fetch-Site across the entire OIDC return chain.
// Only its two GET documents may enter from another site; API mutations still
// require the local origin, session and CSRF checks.
export function allowLocalPrimaryRequest(request,origin,telegramEnabled){
 const local=new URL(origin),headers=request.headers;
 if(request.socket.remoteAddress!=='127.0.0.1'||headers.host!==local.host)return false;
 const path=new URL(request.url,origin).pathname;
 const callback=path==='/api/account/phone/telegram/callback';
 const telegramDocument=telegramEnabled===true&&request.method==='GET'&&
  (callback||path==='/cabinet/phone')&&headers['sec-fetch-mode']==='navigate'&&headers['sec-fetch-dest']==='document';
 if(headers.origin&&headers.origin!==origin&&!(telegramDocument&&callback&&headers.origin==='https://oauth.telegram.org'))return false;
 return headers['sec-fetch-site']!=='cross-site'||telegramDocument;
}
