const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');

test('removing a photo below the shared limit clears the obsolete full-capacity warning',()=>{
 const states=[],refs=[];let stateIndex=0,refIndex=0;
 const hooks={
  useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return[states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},
  useRef(initial){const index=refIndex++;return refs[index]??=( {current:initial} );},
  useCallback:callback=>callback,useEffect(){},
 };
 const output={},code=ts.transpileModule(fs.readFileSync('src/components/FormPhotoUploader.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText;
 new Function('exports','require',code)(output,name=>{
  if(name==='react')return hooks;
  if(name==='@/components/auth/AccountAuthProvider')return{usePrimaryAccountAuth:()=>null};
  if(name==='@/lib/media-upload-contract')return require('../src/lib/media-upload-contract.ts');
  if(name==='@/components/SquareImageCropper')return{SquareImageCropper:()=>null};
  if(name==='@/components/StoredMedia')return{StoredMediaImage:()=>null};
  if(name==='@/lib/client-listing-media')return{productionListingMedia:{read(){throw Error('Unexpected media read');}}};
  if(name==='@/lib/listing-thumbnail-queue')return{createListingThumbnailQueue:read=>read};
  if(name==='@/lib/media-limits')return{filterFormPhotoFiles:files=>({accepted:files,rejectedMessages:[]}),formPhotoLimitText:()=>''};
  return require(name);
 });
 const props={label:'Фото',description:'Фото заказа',maxPhotos:3,savedMedia:{owner:'11111111-1111-4111-8111-111111111111',photos:[1,2,3].map(n=>({id:`22222222-2222-4222-8222-${String(n).padStart(12,'0')}`}))}};
 function render(){stateIndex=0;refIndex=0;return output.FormPhotoUploader(props);}
 function nodes(value){if(Array.isArray(value))return value.flatMap(nodes);if(!value||typeof value!=='object')return[];return[value,...nodes(value.props?.children)];}
 const input=nodes(render()).find(node=>node.type==='input'&&node.props.type==='file');
 input.props.onChange({target:{files:[{}]},currentTarget:{value:'over-limit'}});
 const full=render();
 assert.ok(nodes(full).some(node=>node.type==='p'&&node.props.children==='Можно добавить не больше 3 фото.'),'The over-limit action must first display its warning');
 nodes(full).find(node=>node.type==='button'&&node.props['aria-label']==='Убрать Фото 1').props.onClick();
 const after=nodes(render());
 assert.equal(after.filter(node=>node.type==='figure').length,2,'Removing from a full set must free one slot');
 assert.ok(!after.some(node=>node.type==='p'&&node.props.children==='Можно добавить не больше 3 фото.'),'A full-capacity warning cannot remain after a slot is freed');
 assert.equal(after.filter(node=>node.type==='input'&&node.props.name==='keepPhotoIds').length,2,'The retained IDs must match the visible count');
});
