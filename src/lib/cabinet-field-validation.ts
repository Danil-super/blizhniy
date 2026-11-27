/** Shared UX/schema predicates, not a replacement for SQL parameters or output escaping. */
export function validPlainText(value:string,multiline=false):boolean {
 const controls=multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/:/[\u0000-\u001f\u007f-\u009f]/;
 return value.isWellFormed()&&!controls.test(value)&&!/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value)&&
  !/<\s*(?:\/?[a-z][^<>]*|![^<>]*|\?[^<>]*)>/i.test(value);
}
export const personNamePattern="[\\p{L}\\p{M}][\\p{L}\\p{M} .'’\\-–]{1,119}";
export function validPersonName(value:string):boolean {
 return value.length>=2&&value.length<=120&&new RegExp(`^(?:${personNamePattern})$`,'u').test(value)&&validPlainText(value);
}
export const PROFILE_NAME_MAX_LENGTH=120;
export const PROFILE_NAME_ISSUE=`Введите имя буквами, до ${PROFILE_NAME_MAX_LENGTH} знаков. Допустимы пробелы, точка, дефис и апостроф.`;
const profileNameCore=`\\p{L}|${personNamePattern}`;
export const profileNamePattern=`\\s*(?:${profileNameCore})\\s*`;
const profileNameRegex=new RegExp(`^(?:${profileNameCore})$`,'u');

export function validProfileName(value:unknown):value is string {
 return typeof value==='string'&&value.length<=PROFILE_NAME_MAX_LENGTH&&profileNameRegex.test(value)&&validPlainText(value);
}

export function normalizeProfileName(value:unknown):string|null {
 if(typeof value!=='string'||value.length>PROFILE_NAME_MAX_LENGTH||!validPlainText(value))return null;
 const name=value.trim();
 return validProfileName(name)?name:null;
}

export function validPhone(value:string):boolean {
 if(!value)return true;
 const digits=value.replace(/\D/g,'');
 return /^[+\d ().-]+$/.test(value)&&(digits.length===10||digits.length===11&&/^[78]/.test(digits))&&
  (value.match(/\+/g)?.length??0)<=1&&(!value.includes('+')||value.startsWith('+'));
}
export function validEmail(value:string):boolean {
 return !value||value.length<=254&&validPlainText(value)&&/^[^\s@<>"(),;:\\]+@[^\s@<>"(),;:\\]+\.[^\s@<>"(),;:\\]+$/.test(value);
}
export function validWebUrl(value:string):boolean {
 if(!value)return true;
 if(!validPlainText(value)||/[\s<>\\]/.test(value)||!/^https?:\/\//i.test(value))return false;
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!!url.hostname&&!url.username&&!url.password;}catch{return false;}
}
/** Report, do not silently rewrite arbitrary strings into different amounts. */
export function validMoneyInput(value:string):boolean {
 return !value||/^(0|[1-9]\d{0,9})(?:[.,]\d{1,2})?$/.test(value);
}

const checksum=(value:string,weights:number[])=>weights.reduce((sum,weight,index)=>sum+weight*Number(value[index]),0)%11%10;
export function validInn(value:string,length=value.length):boolean {
 if((length!==10&&length!==12)||value.length!==length||!/^\d+$/.test(value)||/^0+$/.test(value))return false;
 return length===10?checksum(value,[2,4,10,3,5,9,4,6,8])===Number(value[9]):
  checksum(value,[7,2,4,10,3,5,9,4,6,8])===Number(value[10])&&checksum(value,[3,7,2,4,10,3,5,9,4,6,8])===Number(value[11]);
}

export function validRegistrationNumber(value:string,length=value.length):boolean {
 return (length===13||length===15)&&value.length===length&&/^\d+$/.test(value)&&!/^0+$/.test(value)&&
  Number(BigInt(value.slice(0,-1))%BigInt(length===13?11:13)%BigInt(10))===Number(value.at(-1));
}
