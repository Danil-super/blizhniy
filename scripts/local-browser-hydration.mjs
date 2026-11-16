// Test evidence only: capture the throwing document before navigation changes the tab URL.
export async function observeBrowserHydration(context){
 const marker='__BLIZHNIY_REACT_HYDRATION__:',records=[];
 context.on('console',message=>{
  const text=message.text();if(!text.startsWith(marker))return;
  let value=null;
  try{if(text.length<=2048)value=JSON.parse(text.slice(marker.length));}catch{value=null;}
  const valid=value&&Object.keys(value).sort().join()==='documentPath,elapsedMs,timeOrigin'&&
   typeof value.documentPath==='string'&&value.documentPath.startsWith('/')&&value.documentPath.length<=1024&&!/[?#\x00-\x1f\x7f]/.test(value.documentPath)&&
   Number.isFinite(value.timeOrigin)&&value.timeOrigin>0&&Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0;
  if(records.length<100)records.push(valid?value:{invalidDiagnostic:true});
  else if(records.length===100)records.push({truncated:true});
 });
 await context.addInitScript(marker=>{
  window.addEventListener('error',event=>{
   if(!String(event.message).includes('React error #418'))return;
   console.debug(marker+JSON.stringify({documentPath:location.pathname,timeOrigin:performance.timeOrigin,elapsedMs:performance.now()}));
  });
 },marker);
 return records;
}
