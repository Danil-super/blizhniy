import {checkWorkPublicationForm,type WorkPublicationForm} from './work-publication-contract';
import {checkVacancyCheckoutForm} from './vacancy-checkout-validation';
export function checkWorkCheckoutForm(form:WorkPublicationForm):string[]{
 if(form.kind==='vacancy')return checkVacancyCheckoutForm(form);
 const issues=checkWorkPublicationForm(form);
 if(form.budget!==null&&(!/^(0|[1-9]\d{0,9})\.\d{2}$/.test(form.budget)||Number(form.budget)<=0))issues.push('Укажите положительный бюджет или оставьте поле пустым: «По договорённости».');
 if(form.messengerUrl){try{const url=new URL(form.messengerUrl);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)issues.push('Проверьте ссылку на мессенджер.');}catch{issues.push('Проверьте ссылку на мессенджер.');}}
 return issues;
}
