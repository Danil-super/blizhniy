import type {ListingFormDraft} from '@/lib/listing-form-contract';
import {categories} from '@/lib/data';
const kinds={prodam:'Продам',kuplyu:'Куплю','otdam-darom':'Отдам даром',arenda:'Аренда'};
const bookingLabels:Record<string,string>={mode:'Тип аренды',priceWeekday:'Будни, ₽/сутки',priceWeekend:'Выходные, ₽/сутки',pricePerPerson:'Стоимость с человека, ₽',extraGuestPrice:'Дополнительный гость, ₽',minNights:'Минимум ночей',includedGuests:'Гостей включено',maxGuests:'Максимум гостей',availableFrom:'Доступно с',availableTo:'Доступно до',tourDate:'Дата похода',checkInTime:'Заезд',checkOutTime:'Выезд',tourTime:'Время начала',included:'Что включено',rules:'Правила',tourDuration:'Продолжительность',tourDifficulty:'Сложность',tourMeetingPoint:'Место встречи',blockedDates:'Недоступные даты'};
export function ListingModerationFields({form}:{form:ListingFormDraft}){
 const category=categories.find(item=>item.slug===form.categorySlug)?.name??form.categorySlug??'Не указана';
 const fields=[['Тип',kinds[form.kind]],['Цена в объявлении',form.price?`${form.price.replace('.',',')} ₽`:'Не указана'],['Категория',[category,form.subcategoryName].filter(Boolean).join(' / ')],
  ['Город и район',[form.cityName,form.district].filter(Boolean).join(', ')||'Не указаны'],['Адрес',form.address??'Не указан'],
  ['Точный адрес на сайте',form.showExactAddress?'Показывать':'Скрывать'],['Телефон',form.contactPhone??'Не указан'],['Мессенджер',form.messengerUrl??'Не указан'],['Основной способ связи',form.contactMethod==='messenger'?'Мессенджер':'Телефон']];
 return <><dl className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{fields.map(([label,value])=><div key={label} className="min-w-0 rounded-lg bg-slate-50 p-3"><dt className="text-xs font-semibold text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm font-medium text-slate-900">{value}</dd></div>)}</dl>
  {form.latitude!==null&&<p className="mt-3 break-words text-xs text-slate-500">Точка на карте: {form.latitude}, {form.longitude}</p>}
  {form.booking&&<section className="mt-5 rounded-lg border border-blue-100 p-4" aria-label="Параметры аренды"><h3 className="font-bold">Параметры аренды</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(form.booking).map(([key,value])=><div key={key}><dt className="text-sm text-slate-500">{bookingLabels[key]??key}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm">{key==='mode'?(value==='stay'?'Проживание':'Поход'):Array.isArray(value)?value.join(', '):String(value)}</dd></div>)}</dl></section>}
 </>;
}
