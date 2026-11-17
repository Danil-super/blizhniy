"use client";
/** Decimal database values must never pass through the digits-only listing mask. */
export function WorkAmountField({kind,value}:{kind:'vacancy'|'workRequest';value:string|null|undefined}){
 return <label className="grid min-w-0 gap-2 text-sm font-bold text-slate-700">{kind==='vacancy'?'Оплата':'Стоимость работ'}
  <span className="relative block"><input name={kind==='vacancy'?'salary':'budget'} defaultValue={value??''} inputMode="decimal"
   pattern="[0-9]+([.,][0-9]{1,2})?" maxLength={13} placeholder="5000" title="Положительная сумма, например 45000 или 45000,50. Можно оставить пустым."
   onBeforeInput={event=>{const text=(event.nativeEvent as InputEvent).data;if(text&&/[^0-9.,]/.test(text))event.preventDefault();}}
   onPaste={event=>{if(/[^0-9.,]/.test(event.clipboardData.getData('text')))event.preventDefault();}}
   onInput={event=>{const input=event.currentTarget;
    if(/^[0-9]*([.,][0-9]{0,2})?$/.test(input.value))input.dataset.validAmount=input.value;
    else input.value=input.dataset.validAmount??value??'';
    input.setCustomValidity(input.value&&Number(input.value.replace(',','.'))<=0?'Сумма должна быть больше нуля.':'');}}
   className="min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white py-2 pl-3 pr-9 text-base font-normal"/>
   <span className="pointer-events-none absolute inset-y-0 right-3 inline-flex items-center font-normal" aria-hidden="true">₽</span></span>
  <span className="text-xs font-normal text-slate-600">Если сумма не определена, оставьте поле пустым.</span>
 </label>;
}
