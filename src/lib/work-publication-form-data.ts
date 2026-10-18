import {parseWorkPublicationForm,WorkPublicationInputError,type WorkPublicationKind} from './work-publication-contract.ts';

export function readWorkPublicationFormData(kind:WorkPublicationKind,data:FormData){
 const read=(name:string)=>String(data.get(name)??'').trim(),exact=read('locationMode')==='exact'&&read('mapPointSelected')==='1';
 const coordinate=(name:string)=>{const raw=read(name);if(!raw)throw new WorkPublicationInputError();return Number(raw.replace(',','.'));};
 const social=(value:string)=>value.startsWith('@')?`https://t.me/${value.slice(1)}`:value;
 const emailOrMessenger=read('emailOrMessenger'),isEmail=emailOrMessenger.includes('@')&&!emailOrMessenger.startsWith('@')&&!/^https?:/i.test(emailOrMessenger);
 const amount=read(kind==='vacancy'?'salary':'budget').replace(/\s/g,'').replace(',','.');
 const common={kind,title:read('title'),description:String(data.get('description')??''),cityName:(read('location')||read('city')).split(',')[0].trim()||null,
  professionName:read('profession')||null,district:read('district')||null,address:exact?read('address')||null:null,
  latitude:exact?coordinate('lat'):null,longitude:exact?coordinate('lng'):null,showExactAddress:exact,contactPhone:read('phone')||null,
  messengerUrl:social((!isEmail&&emailOrMessenger)||read('messengerUrl'))||null,placementRightConfirmed:['1','on'].includes(read('placementRightConfirmed'))};
 return parseWorkPublicationForm(kind,kind==='workRequest'?{...common,budget:amount||null}:{...common,salary:amount||null,
  employerType:read('employerType')==='private'?'person':read('employerType')||'organization',organization:read('organization')||null,
  inn:read('inn'),ogrn:read('ogrn'),ogrnip:read('ogrnip'),contactPerson:read('contactPerson')||null,email:(isEmail?emailOrMessenger:read('email'))||null,
  website:social(read('website'))||null,requirements:read('requirements')||null,responsibilities:read('responsibilities')||null,
  conditions:read('conditions')||null,schedule:read('schedule')||null,workFormat:read('workFormat')||null});
}
