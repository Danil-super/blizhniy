const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),noop=()=>null;
function runtime(overrides={}){
 const cache=new Map();
 function load(relative){
  const base=path.resolve(root,relative),file=[base,base+'.ts',base+'.tsx'].find(candidate=>fs.existsSync(candidate));assert.ok(file,relative);
  if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('exports','require',code)(out,name=>{
   if(Object.hasOwn(overrides,name))return overrides[name];
   if(name==='next/link')return{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
   if(name==='next/image')return{__esModule:true,default:({unoptimized,...props})=>{void unoptimized;return React.createElement('img',props);}};
   if(name==='@/lib/client-listing-media')return{productionListingMedia:{read(){throw Error('No private reads during SSR');}}};
   if(name==='@/lib/local-account')return{notifyAccountSessionChange(){}};
   if(name.startsWith('@/'))return load('src/'+name.slice(2));
   if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name));
   return require(name);
  });return out;
 }return load;
}
function assertHeading(html,title,price){
 assert.equal((html.match(/<h1\b/g)??[]).length,1);
 const heading=html.indexOf('<h1'),gallery=html.indexOf('data-gallery');
 assert.ok(heading>=0&&gallery>heading,'Title must precede the gallery');
 assert.ok(html.indexOf(price,heading)>heading&&html.indexOf(price,heading)<gallery,'Price must follow the title before photos');
 assert.equal(html.split(price).length-1,1,'Price must not be duplicated in mobile/desktop panels');
 assert.match(html,new RegExp(`<h1[^>]*>${title}</h1>`));
}
test('actual vacancy page shares the order title/price/profession-first hierarchy without losing employer or terms',async()=>{
 const vacancy={id:'11111111-1111-4111-8111-111111111111',title:'Мастер по ремонту',salary:'45 000 ₽',profession:'Сантехник',organization:'ООО Ремонт',city:'Крымск',status:'published',images:[],schedule:'5/2',workFormat:'На месте',description:'Ремонт оборудования',publishedAt:'2026-10-23T10:00:00Z'};
 const load=runtime({'next/navigation':{notFound(){throw Error('Unexpected 404');}},'@/lib/vacancy-store':{getStoredVacancyById:async()=>vacancy},'@/lib/mock-store':{},'@/lib/runtime-mode':{shouldShowFallbackContent:()=>false},'@/lib/supabase-rest':{isUuid:()=>true},'@/components/SiteHeader':{SiteHeader:noop},'@/components/BackLink':{BackLink:noop},'@/components/DetailImageGallery':{DetailImageGallery:()=>React.createElement('div',{'data-gallery':'vacancy'})},'@/components/LocationMap':{LocationMap:noop},'@/components/VacancyApplicationButton':{VacancyApplicationButton:noop},'@/components/listings/ListingViewTracker':{ListingViewTracker:noop}});
 const html=renderToStaticMarkup(await load('src/app/vakansiya/[slug]/page.tsx').default({params:Promise.resolve({slug:vacancy.id})}));
 assertHeading(html,vacancy.title,vacancy.salary);
 assert.ok(html.indexOf('Сантехник')>html.indexOf('<h1'));
 for(const value of ['ООО Ремонт','5/2','На месте','Ремонт оборудования','Размещено'])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/<span[^>]*bg-blue-50[^>]*text-\[#0875d1\][^>]*>5\/2/,'Schedule text needs sufficient contrast on its pale background');
});
test('actual listing detail has one title/price header before gallery and retains contact/share/seller actions',()=>{
 const source=fs.readFileSync(path.resolve(root,'src/components/listings/ListingPages.tsx'),'utf8'),ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='ListingDetailPage');assert.ok(fn);
 const load=runtime(),bindings={};
 for(const name of ['SiteHeader','ListingViewTracker','Breadcrumbs','BackLink','ListingKindBadge','StatusBadge','MapPin','Phone','Mail','MessageCircle','LocationMap','BookingCalculator','DeliveryInfoCard'])bindings[name]=noop;
 Object.assign(bindings,{PublicationHeading:fs.existsSync(path.resolve(root,'src/components/PublicationHeading.tsx'))?load('src/components/PublicationHeading.tsx').PublicationHeading:noop,PublicationDates:load('src/components/PublicationDates.tsx').PublicationDates,
  ListingMediaGallery:()=>React.createElement('div',{'data-gallery':'listing'}),ListingShareButton:()=>React.createElement('button',null,'Поделиться'),ListingSellerCard:()=>React.createElement('div',null,'Продавец'),
  hasListingMapPoint:()=>false,listingSellerStats:()=>({}),normalizeMessengerHref:()=>null,listingPlaceLabel:()=> 'Крымск',formatPublicationDateTime:()=>'',formatListingDateOnly:()=>'',listingSellerName:()=> 'Продавец',sellerProfileHref:()=>'/prodavets/test',showDeliveryUi:false,notFound(){throw Error('Unexpected 404');}});
 const out={},code=ts.transpileModule(fn.getText(ast),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new Function('exports','require',...Object.keys(bindings),code)(out,require,...Object.values(bindings));
 const listing={slug:'synthetic',title:'Комод из дерева',kind:'prodam',status:'published',price:'3 500 ₽',city:'Крымск',categoryName:'Мебель',categorySlug:'mebel',phone:'+79991234567',description:'Описание комода',images:[]};
 const html=renderToStaticMarkup(out.ListingDetailPage({slug:listing.slug,listingOverride:listing}));assertHeading(html,listing.title,listing.price);
 for(const value of ['Позвонить','Поделиться','Продавец','Описание комода'])assert.ok(html.includes(value),value);
});
for(const status of ['published','blocked','archived','expired','sold'])test(`cabinet ${status} listing omits Details while retaining its owner actions`,()=>{
 const Card=runtime()('src/components/listings/CabinetListingCard.tsx').CabinetListingCard;
 const html=renderToStaticMarkup(React.createElement(Card,{owner:'11111111-1111-4111-8111-111111111111',item:{id:'22222222-2222-4222-8222-222222222222',revision:'3',title:'Комод',kind:'prodam',price:'3500.00',card:{status,city:'Крымск',coverPhotoId:null,blockReason:status==='blocked'?'Исправьте описание':null}},managePublication:true,open:false,onToggle(){}},null));
 assert.doesNotMatch(html,/Подробнее|Статус и оплата/);assert.ok(html.includes('Действия'));
 assert.match(html,/<summary[^>]+text-blue-800/,'Owner actions must remain readable on the pale hover background');
 if(['published','blocked','archived'].includes(status))assert.ok(html.includes('Редактировать'));
 if(status==='published')assert.ok(html.includes('Посмотреть'));
});
test('seller labels and profile link use readable foregrounds in the unified detail sidebar',()=>{
 const Seller=runtime()('src/components/listings/ListingSellerCard.tsx').ListingSellerCard;
 const html=renderToStaticMarkup(React.createElement(Seller,{sellerName:'Продавец',listingTitle:'Комод',profileHref:'/prodavets/synthetic'}));
 assert.doesNotMatch(html,/text-slate-400/);
 assert.match(html,/<a[^>]+text-blue-800[^>]*>[\s\S]*?Профиль продавца/);
});

test('public photo galleries start on the first slide without inline CSS', () => {
 const load = runtime();
 const images = ['/one.webp', '/two.webp'];
 const {DetailImageGallery} = load('src/components/DetailImageGallery');
 const {ListingMediaGallery} = load('src/components/listings/ListingMediaGallery');
 const galleries = [
  React.createElement(DetailImageGallery, {images, title: 'Фото', fallbackIcon: null}),
  React.createElement(ListingMediaGallery, {media: images.map(src => ({kind: 'image', src})), title: 'Фото'}),
 ];
 for (const gallery of galleries) {
  const html = renderToStaticMarkup(gallery);
  assert.match(html, /transition-transform/);
  assert.doesNotMatch(html, /\sstyle=/i);
 }
});

test('listing grid displays the Moscow publication day on either side of local midnight', () => {
  const load = runtime({
    './ListingShareButton': { ListingShareButton: noop },
    './ListingViewCounter': { ListingViewCounter: noop },
    '@/components/StoredMedia': { StoredMediaImage: noop },
  });
  const { ListingGridCard } = load('src/components/listings/ListingCard.tsx');
  const listing = { slug: 'table', kind: 'prodam', title: 'Стол', price: '500 ₽', city: 'Анапа' };
  const previousZone = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Europe/Moscow', 'America/Los_Angeles']) {
      process.env.TZ = zone;
      for (const [publishedAt, expected] of [
        ['2026-12-31T20:59:59Z', '31 декабря 2026'],
        ['2026-12-31T21:00:00Z', '1 января 2027'],
      ]) {
        const markup = renderToStaticMarkup(React.createElement(ListingGridCard, { listing: { ...listing, publishedAt } }));
        assert.ok(markup.includes(expected), `${zone}: ${publishedAt} should display ${expected}`);
      }
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});
