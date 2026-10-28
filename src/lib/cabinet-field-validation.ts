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
