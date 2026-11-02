const uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const publicPhoto=new RegExp(`^/api/(?:listings|work-publications|service-publications)/${uuid}/photos/${uuid}$`);
/** Native image errors do not expose status. Retry only this same-origin public GET, never uploads/private POSTs. */
export function createPublicPhotoRetry(source:string,retry:()=>void){
 let count=0,disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
 const clear=()=>{clearTimeout(timer);timer=undefined;};
 return{
  failed(){
   if(disposed||!publicPhoto.test(source)||count>=2)return false;
   if(timer!==undefined)return true;
   const delay=1000*2**count+Math.floor(Math.random()*251);count++;
   timer=setTimeout(()=>{timer=undefined;if(!disposed)retry();},delay);return true;
  },
  loaded(){clear();},
  dispose(){disposed=true;clear();},
 };
}
