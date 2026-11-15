import {PostgresPublicListingStore} from './postgres-public-listings';
import {PostgresPublicWorkStore} from './postgres-public-work';
import {PostgresPublicServiceStore} from './postgres-public-service';
import {parseListingDraftId} from './listing-draft-contract.ts';
import {parseProfessionCatalog} from './profession-catalog-contract.ts';
import {parsePublicSearchInput,PublicSearchError,type PublicSearchInput,type PublicSearchResult,type PublicSearchPage} from './public-search-contract.ts';
import {decodePublicSearchCursor,encodePublicSearchCursor,type PublicSearchAnchor} from './public-search-cursor';
import {buildPublicSearchSql} from './public-search-sql';
import type {PostgresDatabase,PostgresQueries} from './postgres';
import type {QueryResultRow} from 'pg';
type Candidate=PublicSearchAnchor&{metadata:Record<string,unknown>};
const key=(rank:number,id:string)=>rank+':'+id;
const anchorOf=({id,rank,publishedAt,createdAt,sortOrder,parent,name}:Candidate):PublicSearchAnchor=>({id,rank,publishedAt,createdAt,sortOrder,parent,name});
export class PublicSearchBudgetError extends PublicSearchError{}

/** SQL selects only matching candidates; existing public readers authorize/materialize bounded batches. */
export class PostgresPublicSearchStore{
 constructor(private readonly db:Pick<PostgresDatabase,'readTransaction'>,private readonly options:{postmoderation?:boolean;specialistProfileIdentity?:boolean}={}){
  if(typeof window!=='undefined')throw new PublicSearchError();
 }
 async search(value:PublicSearchInput,options:{onComplete?:()=>void;timeoutMs?:number;deadline?:number}={}):Promise<PublicSearchPage>{
  let delegated=false;
  try{
   const input=parsePublicSearchInput(value),cursor=input.cursor?decodePublicSearchCursor(input.cursor,input):null,reverse=cursor?.direction==='previous';
   const timeoutMs=options.timeoutMs??5000;
   if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000||
    options.deadline!==undefined&&(!Number.isFinite(options.deadline)||options.deadline<=performance.now()))throw new PublicSearchError();
   delegated=true;
   return await this.db.readTransaction(async transaction=>{
    let bytes=0,candidateCount=0;
    const tx:PostgresQueries={query:async<Row extends QueryResultRow>(text:string,values?:unknown[])=>{
     const result=await transaction.query<Row>(text,values);bytes+=Buffer.byteLength(JSON.stringify(result.rows));
     if(bytes>16777216)throw new PublicSearchBudgetError();return result;
    }};
    const listings=new PostgresPublicListingStore(tx,{postmoderation:this.options.postmoderation}),
     work=new PostgresPublicWorkStore(tx,{vacancyPostmoderation:this.options.postmoderation}),
     services=new PostgresPublicServiceStore(tx,{specialistProfileIdentity:this.options.specialistProfileIdentity});
    const scopes={listing:listings.searchScope(),work:work.searchScope(),service:services.searchScope()};
    let position:PublicSearchAnchor|null=cursor?anchorOf({...cursor,metadata:{}}):null,skip=cursor?0:(input.page-1)*24,exhausted=false;
    const accepted:Array<{candidate:Candidate;result:PublicSearchResult}>=[];
    while(accepted.length<25&&!exhausted){
     const query=buildPublicSearchSql(input,scopes,position,reverse);
     const rows=(await tx.query<Candidate>(query.text,query.values)).rows;
     candidateCount+=rows.length;if(rows.length>25||candidateCount>25100)throw new PublicSearchBudgetError();
     exhausted=rows.length<25;if(!rows.length)break;
     const ids=(min:number,max=min)=>rows.filter(row=>row.rank>=min&&row.rank<=max).map(row=>parseListingDraftId(row.id));
     // Sequential reads keep each search to one checked-out connection and one SQL statement at a time.
     const listingRows=await listings.readMany(ids(1)),workRows=await work.readMany(ids(2,3)),serviceRows=await services.readMany(ids(4,5));
     const material=new Map<string,PublicSearchResult>();
     for(const item of listingRows){
      const candidate=rows.find(row=>row.rank===1&&row.id===item.id),category=candidate?.metadata.categoryName;
      if(typeof category!=='string'||!category||category.length>200)continue;
      material.set(key(1,item.id),{title:item.title,description:`${category}, ${item.city}. ${item.description}`,href:`/obyavlenie/${item.id}`,type:'Объявление'});
     }
     for(const item of workRows){
      if('organization'in item)material.set(key(2,item.id),{title:item.title,description:`${item.organization}, ${item.city}. ${item.salary}`,href:`/vakansiya/${item.id}`,images:item.images,type:'Вакансия'});
      else material.set(key(3,item.id),{title:item.title,description:`${item.author}, ${item.city}. ${item.budget}`,href:`/rabota/zakazy/${item.id}`,type:'Заказ'});
     }
     for(const item of serviceRows){
      if('profession'in item)material.set(key(4,item.id),{title:`${item.name} - ${item.profession}`,description:`${item.city}. ${item.skills}. ${item.price}`,href:`/specialist/${item.id}`,type:'Специалист'});
      else material.set(key(5,item.id),{title:item.participantName,description:`${item.category}, ${item.city}. ${item.description}`,href:'/yarmarka-masterov',type:'Ярмарка'});
     }
     for(const candidate of rows){
      const reference=candidate.rank>=6?this.reference(candidate):undefined;
      const result=reference??material.get(key(candidate.rank,candidate.id));
      position=anchorOf(candidate);
      if(!result)continue;
      if(skip){skip--;continue;}
      accepted.push({candidate,result});if(accepted.length===25)break;
     }
    }
    const hasExtra=accepted.length>24,shown=accepted.slice(0,24);if(reverse)shown.reverse();
    if(!shown.length)return{items:[],hasMore:false};
    const hasMore=reverse?true:hasExtra;
    const hasPrevious=reverse?hasExtra:input.page>1;
    return{items:shown.map(item=>item.result),hasMore,
     ...(hasMore?{nextCursor:encodePublicSearchCursor(anchorOf(shown.at(-1)!.candidate),input,'next')}:{}),
     ...(hasPrevious?{previousCursor:encodePublicSearchCursor(anchorOf(shown[0].candidate),input,'previous')}:{})};
   },{timeoutMs,deadline:options.deadline,onComplete:options.onComplete});
  }finally{if(!delegated)options.onComplete?.();}
 }
 private reference(row:Candidate):PublicSearchResult|undefined{
  try{
   const {slug,name,description}=row.metadata;
   if(typeof slug!=='string'||slug.length>150||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)||typeof name!=='string'||!name||name.length>200||typeof description!=='string')return;
   if(row.rank===7){parseProfessionCatalog([{id:row.id,slug,name,parent:description,active:true}]);return{title:name,description,href:`/rabota/specialisty/${slug}`,type:'Профессия'};}
   if(row.rank===6)return{title:name,description,href:slug==='rabota'?'/rabota':slug==='yarmarka-masterov'?'/yarmarka-masterov':`/katalog/${slug}`,type:'Категория'};
  }catch{return;}
 }
}
