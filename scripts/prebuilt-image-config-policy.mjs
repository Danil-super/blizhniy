// Bound the unchanged standalone image matcher configuration before executing its modules.
export function assertPrebuiltImageConfig(source){
 try{
  if(typeof source!=='string'||source.length>2*1024*1024)throw Error();
  const lines=[...source.matchAll(/^const nextConfig = (.+)$/gm)];
  if(lines.length!==1)throw Error();
  const config=JSON.parse(lines[0][1]),images=config?.images;
  if(config.assetPrefix!==''||!images||typeof images!=='object'||Array.isArray(images)||
   images.localPatterns!==undefined||!Array.isArray(images.remotePatterns)||images.remotePatterns.length!==0||
   !Array.isArray(images.domains)||images.domains.length!==0)throw Error();
  return true;
 }catch{throw Error('Prebuilt image matcher policy failed');}
}
