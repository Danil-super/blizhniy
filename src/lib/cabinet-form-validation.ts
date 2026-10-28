import {validPlainText,validPersonName,validPhone,validEmail,validWebUrl,validMoneyInput} from './cabinet-field-validation.ts';
import {normalizeMessengerHref} from './messenger-url.ts';
import {professions} from './data.ts';
/** Explicit field semantics: never apply text restrictions to passwords, files or tokens. */
export function cabinetFieldIssue(name:string,value:string,multiline=false):string {
 if(!value||['password','newPassword','confirmPassword'].includes(name))return '';
 if(!validPlainText(value,multiline))return 'Введите обычный текст без HTML-разметки и скрытых управляющих символов.';
 if(['name','contactPerson','personName'].includes(name)&&!validPersonName(value.trim()))return 'Введите имя буквами; допустимы пробел, дефис и апостроф.';
 if(['phone','contactPhone'].includes(name)&&!validPhone(value.trim()))return 'Введите российский телефон: 10 цифр или 11 цифр с 7/8.';
 if(name==='email'&&!validEmail(value))return 'Введите email в формате name@example.ru.';
 if(['href','website','videoUrl','organizationWebsite'].includes(name)&&!validWebUrl(value))return 'Введите ссылку http:// или https:// без логина и пароля.';
 if(name==='messengerUrl'&&!normalizeMessengerHref(value))return 'Введите @username или ссылку на мессенджер.';
 if(name==='emailOrMessenger'&&!validEmail(value)&&!normalizeMessengerHref(value))return 'Введите email, @username или ссылку на мессенджер.';
 if(['price','salary','budget'].includes(name)||/^booking(?:Price|ExtraGuestPrice)/.test(name)){
  if(!validMoneyInput(value))return 'Введите сумму до 9 999 999 999,99: только цифры и до двух знаков после запятой.';
 }
 if(['inn','ogrn','ogrnip','organizationInn','organizationOgrn'].includes(name)){
  const lengths=name.toLowerCase().includes('inn')?[10,12]:name==='ogrn'?[13]:name==='ogrnip'?[15]:[13,15];
  if(!/^\d+$/.test(value)||!lengths.includes(value.length))return `Нужны только цифры: ${lengths.join(' или ')}.`;
 }
 if(/^booking(?:MinNights|IncludedGuests|MaxGuests)$/.test(name)&&(!/^[1-9]\d*$/.test(value)||Number(value)>9999999999))return 'Введите положительное целое число.';
 if(name==='profession'&&!professions.some(item=>item.active&&item.name===value))return 'Выберите профессию из списка.';
 return '';
}
type Control=HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
export function validateCabinetControl(control:Control):string {
 if(control.matches(':disabled')||control instanceof HTMLInputElement&&['hidden','checkbox','radio','file','password','submit','button'].includes(control.type)||'readOnly'in control&&control.readOnly)return '';
 const issue=cabinetFieldIssue(control.name,control.value,control instanceof HTMLTextAreaElement);
 const employer=control.form?.querySelector<HTMLInputElement>('input[name="employerType"]:not(:disabled)')?.value;
 const message=issue||(control.name==='organization'&&employer==='person'&&control.value&&!validPersonName(control.value.trim())?'Введите имя частного работодателя буквами.':'');
 control.setCustomValidity(message);
 return message;
}
export function validateFilledCabinetFields(form:HTMLFormElement):boolean {
 for(const control of Array.from(form.elements)){
  if(!(control instanceof HTMLInputElement||control instanceof HTMLTextAreaElement||control instanceof HTMLSelectElement))continue;
  if(validateCabinetControl(control)){control.reportValidity();return false;}
 }
 return true;
}
