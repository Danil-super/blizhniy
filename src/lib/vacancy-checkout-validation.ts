import {checkWorkPublicationForm,type WorkPublicationForm} from './work-publication-contract';
type Vacancy=Extract<WorkPublicationForm,{kind:'vacancy'}>;
export type VacancyEmployerInput=Pick<Vacancy,'employerType'|'organization'|'inn'|'ogrn'|'ogrnip'|'contactPerson'|'contactPhone'|'email'|'messengerUrl'|'website'>;
const web=(value:string)=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!!u.hostname&&!u.username&&!u.password;}catch{return false;}};
const messenger=(value:string)=>/^@[A-Za-z0-9_]{5,32}$/.test(value)||web(value);
const checksum=(value:string,weights:number[])=>weights.reduce((sum,weight,index)=>sum+weight*Number(value[index]),0)%11%10;
function validInn(value:string,length:10|12){
 if(!new RegExp(`^\\d{${length}}$`).test(value)||/^0+$/.test(value))return false;
 return length===10?checksum(value,[2,4,10,3,5,9,4,6,8])===Number(value[9]):
  checksum(value,[7,2,4,10,3,5,9,4,6,8])===Number(value[10])&&checksum(value,[3,7,2,4,10,3,5,9,4,6,8])===Number(value[11]);
}
const registration=(value:string,length:13|15)=>new RegExp(`^\\d{${length}}$`).test(value)&&!/^0+$/.test(value)&&
 Number(BigInt(value.slice(0,-1))%BigInt(length===13?11:13)%BigInt(10))===Number(value.at(-1));
/** Complete purchase validation, separate from permissive partial draft storage. */
export function checkVacancyEmployer(form:VacancyEmployerInput):string[]{
 const issues:string[]=[],name=form.organization?.trim()??'',phone=form.contactPhone?.replace(/\D/g,'')??'';
 if(name.length<2||name.length>120)issues.push('Укажите имя или название работодателя от 2 до 120 символов.');
 if(!form.contactPhone||!/^[+\d\s().-]+$/.test(form.contactPhone)||!(phone.length===10||phone.length===11&&/^[78]/.test(phone)))issues.push('Укажите корректный российский телефон работодателя.');
 if(form.employerType==='person'){
  if(!/^[\p{L}][\p{L}\s.'’–-]{1,59}$/u.test(name))issues.push('Введите имя частного работодателя буквами.');
  if(form.inn||form.ogrn||form.ogrnip)issues.push('Реквизиты организации не относятся к частному лицу.');
 }else{
  const length=form.employerType==='ip'?12:10;
  if(!validInn(form.inn,length))issues.push(`Проверьте ИНН: нужны ${length} цифр с корректной контрольной суммой.`);
  if(form.employerType==='organization'&&(form.ogrnip||form.ogrn&&!registration(form.ogrn,13)))issues.push('Проверьте ОГРН организации.');
  if(form.employerType==='ip'&&(form.ogrn||form.ogrnip&&!registration(form.ogrnip,15)))issues.push('Проверьте ОГРНИП предпринимателя.');
  if(!form.contactPerson||form.contactPerson.trim().length<2)issues.push('Укажите контактное лицо.');
  if(!form.email&&!form.messengerUrl)issues.push('Укажите email или мессенджер для связи.');
 }
 if(form.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))issues.push('Проверьте контактный email.');
 if(form.messengerUrl&&!messenger(form.messengerUrl))issues.push('Проверьте мессенджер: @username или ссылка http/https.');
 if(form.website&&!web(form.website))issues.push('Укажите адрес сайта, начинающийся с https:// или http://.');
 return issues;
}
export function checkVacancyCheckoutForm(form:WorkPublicationForm):string[]{
 if(form.kind!=='vacancy')return ['Для оплаты нужна вакансия.'];
 const issues=[...checkWorkPublicationForm(form),...checkVacancyEmployer(form)];
 if(form.salary!==null&&(!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(form.salary)||Number(form.salary)<=0))issues.push('Укажите положительную оплату или оставьте поле пустым: «По договорённости».');
 return [...new Set(issues)];
}
