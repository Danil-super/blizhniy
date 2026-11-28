import {publicSearchPattern,type PublicSearchInput} from './public-search-contract.ts';
import type {PublicSearchAnchor} from './public-search-cursor';
import {maxListingMediaTotalSize} from './media-limits.ts';
import {publicProfileNameSql,publicTextSql} from './publication-location-withdrawal.ts';
type Scope={source:string;eligible:string};
export type PublicSearchScopes={listing:Scope;work:Scope;service:Scope&{profileIdentity:boolean}};
/** Fixed server-composed fragments only: input never selects an SQL identifier. */
export function buildPublicSearchSql(input:PublicSearchInput,scopes:PublicSearchScopes,anchor:PublicSearchAnchor|null,reverse=false,textWithdrawals=false){
 const like=(field:string)=>`lower(coalesce(${field},'') collate pg_catalog.pg_unicode_fast) collate "C" like $1 escape '!'`;
 const match=(fields:string[])=>`($1::text is null or ${fields.map(like).join(' or ')})`;
 const city=(field:string)=>`($3::text is null or ${field}=$3)`;
 const pub=(rank:string,id:string,published:string,created:string,metadata="'{}'::jsonb")=>`${rank} as rank,${id} as id,${published} as published,${created} as created,0 as sort_order,''::text as parent,''::text as name,${metadata} as metadata`;
 const workMatch=(kind:'vacancy'|'workRequest')=>match([
  textWithdrawals?publicTextSql('w','title',true):'w.title',publicTextSql('w','description',textWithdrawals),"w.form->>'cityName'",'profession.name',
  kind==='vacancy'?publicTextSql('w','organization',textWithdrawals):"'Автор заказа'",
 ]);
 const profileName=scopes.service.profileIdentity
  ?`(select coalesce(${publicProfileNameSql('s',textWithdrawals)},'Специалист') from app.cabinet_profiles profile where profile.user_id=s.author_id)`:'s.title';
 const kinds="case l.listing_type when 'sell' then 'prodam' when 'buy' then 'kuplyu' when 'free' then 'otdam-darom' when 'rent' then 'arenda' end";
 const branches=[`
  select ${pub('1','l.id','l.published_at','l.created_at',"jsonb_build_object('categoryName',coalesce(parent.name,c.name))")}
   ${scopes.listing.source} where ${scopes.listing.eligible} and ${city('city.name')}
   and ${match([publicTextSql('l','title',textWithdrawals),publicTextSql('l','description',textWithdrawals),'city.name','coalesce(parent.name,c.name)',"case when c.parent_id is not null then c.name else '' end",kinds])}
  `,`select ${pub("case w.kind when 'vacancy' then 2 else 3 end",'w.id','w.published_at','w.created_at')}
   ${scopes.work.source} where ${scopes.work.eligible} and ${city("w.form->>'cityName'")}
   and ((w.kind='vacancy' and ${workMatch('vacancy')}) or (w.kind='workRequest' and ${workMatch('workRequest')}))
  `,`select ${pub("case s.kind when 'specialist' then 4 else 5 end",'s.id','s.published_at','s.created_at')}
   ${scopes.service.source} where ${scopes.service.eligible} and ${city("s.form->>'cityName'")}
   and ((s.kind='specialist' and ${match([profileName,'profession.name',"s.form->>'cityName'",scopes.service.profileIdentity?"''":publicTextSql('s','skills',textWithdrawals)])})
    or (s.kind='fair' and ${match([textWithdrawals?publicTextSql('s','title',true):'s.title',"s.form->>'category'",publicTextSql('s','description',textWithdrawals),"s.form->>'cityName'"])}))
  `,`select 6,c.id,null::timestamptz,null::timestamptz,c.sort_order,''::text,c.name,
   jsonb_build_object('slug',c.slug,'name',c.name,'description',coalesce((select string_agg(child.name,', ' order by child.sort_order,child.name,child.id) from
    (select name,min(sort_order) as sort_order,min(id::text) as id from app.categories where parent_id=c.id and active group by name) child),''))
   from app.categories c where c.parent_id is null and c.active
   and ($1::text is null or ${like('c.name')} or exists(select 1 from app.categories child where child.parent_id=c.id and child.active and ${like('child.name')}))
  `,`select 7,p.id,null::timestamptz,null::timestamptz,0,p.parent_name,p.name,jsonb_build_object('slug',p.slug,'name',p.name,'description',p.parent_name)
   from app.specialist_categories p where p.active and ${match(['p.name','p.parent_name'])}`];
 const relation=reverse?'<':'>';const pubRelation=reverse?'>':'<';
 const after=`($5::integer is null or rank ${relation} $5 or rank=$5 and (
  rank<=5 and (published,created,id) ${pubRelation} ($6::timestamptz,$7::timestamptz,$8::uuid)
  or rank=6 and (sort_order,name,id) ${relation} ($9::integer,$11::text,$8::uuid)
  or rank=7 and (parent,name,id) ${relation} ($10::text,$11::text,$8::uuid)))`;
 const asc=reverse?'desc':'asc',desc=reverse?'asc':'desc';
 const order=`rank ${asc},published ${desc} nulls last,created ${desc} nulls last,sort_order ${asc},parent ${asc},name ${asc},
  case when rank<=5 then id end ${desc},case when rank>5 then id end ${asc}`;
 // A later section receives only the remaining candidate budget. Explicit
 // MATERIALIZED CTEs keep each earlier bounded result stable and evaluated once.
 // LIMIT 0 avoids executing later sources once the page candidate window is full.
 const ordered=reverse?[...branches].reverse():branches;
 const names=ordered.map((_,index)=>`search_${index}`);
 const ctes=ordered.map((branch,index)=>{
  const remaining=index?`greatest(0,$4-(${names.slice(0,index).map(name=>`(select count(*) from ${name})`).join('+')}))`:'$4';
  return `${names[index]} as materialized (select * from (${branch}) candidates(rank,id,published,created,sort_order,parent,name,metadata)
   where ${after} order by ${order} limit ${remaining})`;
 });
 const text=`with ${ctes.join(',\n')}
  select rank,id,to_char(published at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "publishedAt",
  to_char(created at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",sort_order as "sortOrder",parent,name,metadata
  from (${names.map(name=>`select * from ${name}`).join(' union all ')}) candidates
  order by ${order} limit $4`;
 return{text,values:[publicSearchPattern(input.query),maxListingMediaTotalSize,input.cityName??null,25,anchor?.rank??null,
  anchor?.publishedAt??null,anchor?.createdAt??null,anchor?.id??null,anchor?.sortOrder??0,anchor?.parent??'',anchor?.name??'']};
}
