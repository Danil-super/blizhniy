export function publicationTextRange(value:string,start:number,end:number){
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<=start||!value.isWellFormed())return null;
 let offset=0,original=0,from:number|undefined;
 // A textarea normalizes CRLF, and its offsets count UTF-16 code units.
 for(const character of value.match(/\r\n|[\s\S]/gu)??[]){
  if(offset===start)from=original;
  if(offset===end)break;
  offset+=character==='\r\n'?1:character.length;
  original+=character==='\r\n'?2:1;
 }
 return from!==undefined&&offset===end?{start:from,end:original}:null;
}

export const publicationTextLabels={
 title:'Название',description:'Описание',organization:'Работодатель',schedule:'График',workFormat:'Формат работы',
 requirements:'Требования',responsibilities:'Обязанности',conditions:'Условия',skills:'Навыки',experience:'Опыт и квалификация',
} as const;
export type PublicationTextField=keyof typeof publicationTextLabels;
