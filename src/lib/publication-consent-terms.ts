import {publicationTextLabels,type PublicationTextField} from './publication-text-selection.ts';

export const publicationTermsChoices={
 none:'Без дополнительных условий и запретов',
 'no-transfer':'Запретить дальнейшую передачу данных',
 'view-only':'Разрешить только просмотр',
} as const;
export type PublicationTermsChoice=keyof typeof publicationTermsChoices;
export type PublicPublicationTerms={category:string;terms:PublicationTermsChoice}[];

export function isPublicationTermsChoice(value:unknown):value is PublicationTermsChoice{
 return typeof value==='string'&&Object.hasOwn(publicationTermsChoices,value);
}

const categories={
 location:'Точный адрес и координаты',phone:'Телефон',messenger:'Мессенджер',
 name:'Имя из профиля',avatar:'Фото профиля',link:'Ссылка',
} as const;

export function publicationTermsCategory(category:string):string|undefined{
 if(Object.hasOwn(categories,category))return categories[category as keyof typeof categories];
 if(/^photo:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(category))return 'Фотография';
 if(category.startsWith('text-field:')){
  const field=category.slice(11);
  if(Object.hasOwn(publicationTextLabels,field))return publicationTextLabels[field as PublicationTextField];
 }
}

export function parsePublicPublicationTerms(value:unknown):PublicPublicationTerms|undefined{
 if(value===undefined)return;
 if(!Array.isArray(value)||value.length>64)throw Error('Invalid publication terms');
 const rows:PublicPublicationTerms=[];
 const seen=new Set<string>();
 for(const row of value){
  if(!row||typeof row!=='object'||Object.getPrototypeOf(row)!==Object.prototype||
     Object.keys(row).length!==2||typeof row.category!=='string'||!publicationTermsCategory(row.category)||
     !isPublicationTermsChoice(row.terms)||seen.has(row.category))throw Error('Invalid publication terms');
  seen.add(row.category);
  rows.push({category:row.category,terms:row.terms});
 }
 return rows.length?rows:undefined;
}
