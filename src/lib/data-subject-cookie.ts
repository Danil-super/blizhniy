export const dataSubjectCookieName='__Host-blizhniy_data_subject';
export function createDataSubjectCookie(token:string,maxAge:number):string{
 if(typeof window!=='undefined'||!Number.isInteger(maxAge)||maxAge<0||maxAge>3600||
  (maxAge===0?token!=='':!/^[a-f0-9]{64}$/.test(token)))throw Error('Invalid data subject cookie');
 const expires=new Date(maxAge===0?0:Date.now()+maxAge*1000).toUTCString();
 return `${dataSubjectCookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}; Expires=${expires}`;
}
export function readDataSubjectToken(request:Request):string|null{
 const header=request.headers.get('cookie')??'';if(header.length>4096)return null;
 const matches=header.split(';').map(value=>value.trim()).filter(value=>value.startsWith(dataSubjectCookieName+'='));
 if(matches.length!==1)return null;const token=matches[0].slice(dataSubjectCookieName.length+1);
 return /^[a-f0-9]{64}$/.test(token)?token:null;
}
