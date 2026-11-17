import {normalizedImageByteLimit} from './media-upload-contract.ts';

export const maxPhotoSourceBytes=50*1024*1024;
/** Browser preparation only. The server still validates and re-encodes every upload. */
export async function preparePhotoFile(file:File):Promise<File>{
 if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type))throw Error('Поддерживаются JPEG, PNG, WebP и статичный GIF.');
 if(!file.size||file.size>maxPhotoSourceBytes)throw Error('Выберите фото до 50 МБ.');
 // Keep GIF/animated sources intact: flattening them would bypass the static-photo policy.
 const bytes=new Uint8Array(await file.arrayBuffer()),view=new DataView(bytes.buffer);
 let animated=file.type==='image/gif';
 if(file.type==='image/webp'&&bytes.length>=21)animated=(bytes[20]&2)!==0&&String.fromCharCode(...bytes.slice(12,16))==='VP8X';
 if(file.type==='image/png')for(let offset=8;offset+12<=bytes.length;){
  const length=view.getUint32(offset),kind=String.fromCharCode(...bytes.slice(offset+4,offset+8));
  if(kind==='acTL'){animated=true;break;}if(kind==='IDAT'||kind==='IEND'||length>bytes.length-offset-12)break;offset+=length+12;
 }
 if(animated){if(file.size>8*1024*1024)throw Error('Статичный GIF должен быть до 8 МБ.');return file;}
 let bitmap:ImageBitmap|undefined;
 const canvas=document.createElement('canvas');
 try{
  bitmap=await createImageBitmap(file);
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>64_000_000)throw Error('Разрешение фото превышает 64 мегапикселя.');
  const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context)throw Error('Не удалось обработать фото.');
  context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for(const quality of [0.86,0.76,0.62]){
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/webp',quality));
   if(blob?.type==='image/webp'&&blob.size>0&&blob.size<=normalizedImageByteLimit)return new File([blob],file.name,{type:blob.type,lastModified:file.lastModified});
  }
  throw Error('Не удалось сжать фото. Попробуйте сохранить его как JPEG или WebP.');
 }catch(error){
  if(error instanceof Error&&error.message.startsWith('Разрешение фото'))throw error;
  throw Error('Не удалось обработать фото. Выберите исправный JPEG, PNG или WebP.');
 }finally{bitmap?.close();canvas.width=canvas.height=0;}
}

export async function preparePhotoFiles(files:File[]){
 const accepted:File[]=[],rejectedMessages:string[]=[];
 // One decoder at a time keeps a batch of phone photos from exhausting browser memory.
 for(const file of files){try{accepted.push(await preparePhotoFile(file));}catch(error){rejectedMessages.push(`${file.name}: ${error instanceof Error?error.message:'Не удалось обработать фото.'}`);}}
 return{accepted,rejectedMessages};
}
