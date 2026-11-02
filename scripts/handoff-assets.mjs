import {collectPrebuiltFiles} from './verify-prebuilt-release.mjs';

/** Read-only collision check of immutable roots using the existing descriptor-
 * based inventory validator. Ingress retains both roots after process drain. */
export function verifyHandoffAssets(roots){
 if(!Array.isArray(roots)||roots.length!==2)throw new Error('Invalid asset roots');
 const hashes=new Map();let count=0,shared=0;
 for(const root of roots){
  const {files}=collectPrebuiltFiles(root);
  for(const [path,entry]of Object.entries(files)){
   count++;
   if(hashes.has(path)){if(hashes.get(path)!==entry.sha256)throw new Error('Asset path collision');shared++;}
   else hashes.set(path,entry.sha256);
  }
 }
 return {files:count,shared};
}
