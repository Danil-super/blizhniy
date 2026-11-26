import 'server-only';
import type {MetadataRoute} from 'next';
import {getProductionPublicListingStore} from './production-public-listing-runtime';
import {getProductionPublicWorkStore} from './production-public-work-runtime';
import {getProductionPublicServiceStore} from './production-public-service-runtime';

type Page={entries:Array<{id:string;publishedAt?:string}>;hasMore:boolean};
const batchSize=100;

/** Uses exactly the public readers' eligibility and DTO validation, with no owner access or legacy fallback. */
export async function listPrimarySitemapEntries(base:string):Promise<MetadataRoute.Sitemap>{
 const [listings,work,services]=await Promise.all([
  getProductionPublicListingStore(),getProductionPublicWorkStore(),getProductionPublicServiceStore(),
 ]);
 const sources:Array<{prefix:string;batchSize:number;read:(limit:number,offset:number)=>Promise<Page>}>= [
  {prefix:'/obyavlenie',batchSize:1000,read:(limit,offset)=>listings.sitemapPage(limit,offset)},
  {prefix:'/vakansiya',batchSize,read:(limit,offset)=>work.sitemapPage('vacancy',limit,offset)},
  {prefix:'/rabota/zakazy',batchSize,read:(limit,offset)=>work.sitemapPage('workRequest',limit,offset)},
  {prefix:'/specialist',batchSize,read:(limit,offset)=>services.sitemapPage(limit,offset)},
 ];
 const entries:MetadataRoute.Sitemap=[];
 for(const source of sources){
  for(let offset=0;;offset+=source.batchSize){
   // A single sitemap has a finite capacity. Never silently omit the remainder.
   if(offset>=50000)throw Error('Public sitemap requires partitioning');
   const page=await source.read(source.batchSize,offset);
   for(const item of page.entries){
    const date=item.publishedAt;
    const lastModified=date&&Number.isFinite(Date.parse(date))?new Date(date):undefined;
    entries.push({url:`${base}${source.prefix}/${item.id}`,lastModified,changeFrequency:'weekly',priority:0.7});
   }
   if(!page.hasMore)break;
  }
 }
 return entries;
}
