export type PublicSearchResult={title:string;description:string;href:string;images?:string[];type:'Объявление'|'Вакансия'|'Заказ'|'Специалист'|'Ярмарка'|'Категория'|'Профессия'};
export type PublicSearchInput={query:string;cityName?:string;page:number;cursor?:string};
export type PublicSearchPage={items:PublicSearchResult[];hasMore:boolean;nextCursor?:string;previousCursor?:string};
export class PublicSearchError extends Error{constructor(){super('Public search unavailable');}}
export function parsePublicSearchInput(value:PublicSearchInput):PublicSearchInput{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||
  Reflect.ownKeys(value).some(key=>typeof key!=='string'||!['query','cityName','page','cursor'].includes(key))||!Object.hasOwn(value,'query')||!Object.hasOwn(value,'page')||typeof value.query!=='string'||
  value.query.length>200||value.query!==value.query.trim()||!value.query.isWellFormed()||/[\u0000-\u001f\u007f-\u009f]/.test(value.query)||
  value.cityName!==undefined&&(typeof value.cityName!=='string'||!value.cityName||value.cityName.length>200||value.cityName!==value.cityName.trim()||!value.cityName.isWellFormed()||/[\u0000-\u001f\u007f-\u009f]/.test(value.cityName))||
  !Number.isSafeInteger(value.page)||value.page<1||value.page>1000||value.cursor!==undefined&&(typeof value.cursor!=='string'||!value.cursor||value.cursor.length>4096))throw new PublicSearchError();
 return{query:value.query,...(value.cityName===undefined?{}:{cityName:value.cityName}),page:value.page,...(value.cursor===undefined?{}:{cursor:value.cursor})};
}
/** ESCAPE '!' makes SQL wildcard syntax literal, including a literal backslash. */
export function publicSearchPattern(query:string):string|null{return query?'%'+query.toLowerCase().replace(/[!%_]/g,'!$&')+'%':null;}
