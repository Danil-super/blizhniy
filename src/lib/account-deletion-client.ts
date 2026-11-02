import {consumeAccountCaptchaResponse} from './local-account';

const messages:Record<string,string>={UNAUTHENTICATED:'Сессия завершилась или аккаунт изменился. Войдите снова.',
 INVALID_CREDENTIALS:'Проверьте email и пароль.',INVALID_INPUT:'Проверьте заполненные поля.',CAPTCHA_REQUIRED:'Пройдите проверку ещё раз.',
 RATE_LIMITED:'Слишком много попыток. Повторите позже.',REQUEST_CHANGED:'Заявка уже изменилась. Обновите её состояние.'};
export class DeletionClientError extends Error{
 constructor(readonly code:string){super(messages[code]??'Не удалось получить ответ сервера. Проверьте состояние заявки перед повторной отправкой.');}
}
/** Cookies remain HttpOnly; no token is returned to or stored by this adapter. */
export async function deletionRequest<T>(action:string,body:unknown,admin=false):Promise<T>{
 if(!/^[a-z]+$/.test(action))throw new DeletionClientError('INVALID_INPUT');
 try{
  const response=await fetch(`/api/${admin?'admin':'account'}/deletion/${action}`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',
   signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Blizhniy-Request':'1'},body:JSON.stringify(body)});
  consumeAccountCaptchaResponse(response);
  const payload=await response.json();
  if(!response.ok)throw new DeletionClientError(typeof payload?.error?.code==='string'?payload.error.code:'DELETION_UNAVAILABLE');
  if(response.status!==200||!payload||typeof payload!=='object'||Array.isArray(payload))throw new DeletionClientError('DELETION_UNAVAILABLE');
  return payload as T;
 }catch(error){if(error instanceof DeletionClientError)throw error;throw new DeletionClientError('DELETION_UNAVAILABLE');}
}
export const deletionStatus={requested:'Заявка получена',in_review:'На рассмотрении',resolved:'Рассмотрена'};
export const deletionResolution={fulfilled:'Исполнение подтверждено оператором',partly_retained:'Часть данных сохранена по основанию',declined:'В запросе отказано'};
export const deletionDate=(value:string)=>new Date(value).toLocaleString('ru-RU',{dateStyle:'medium',timeStyle:'short'});
