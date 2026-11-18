/** Canvas images are decoded locally: fetch(data:) is blocked by connect-src. */
export function imageDataUrlToBlob(source:string){
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(source);
 if(!match)throw new Error('Не удалось подготовить изображение.');
 return new Blob([Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0))],{type:match[1]});
}

export function croppedPhotoFile(source: string, originalName: string) {
  const blob = imageDataUrlToBlob(source);
  const base = originalName.replace(/\.[^.]+$/, "") || "photo";
  const extension = blob.type.slice("image/".length);
  return new File([blob], `${base}-crop.${extension}`, { type: blob.type });
}
