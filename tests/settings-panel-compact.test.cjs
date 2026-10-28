const assert=require('node:assert/strict');
const fs=require('node:fs');
const test=require('node:test');
const ts=require('typescript');
function renderSettings(){
 const source=fs.readFileSync(new URL('../src/components/cabinet/CabinetClient.tsx',`file://${__filename}`),'utf8');
 const ast=ts.createSourceFile('CabinetClient.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const node=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='SettingsPanel');
 const globals={useCookieCabinetProfile:()=>null,useState:value=>[value,()=>{}],toRussianPhoneE164:()=>null,
  PhoneVerificationButton:'phone-verification',AvatarEditor:'avatar-editor',ValidatedInput:'validated-input',CitySearchSelect:'city-select',Link:'a',Check:'check-icon',LockKeyhole:'lock-icon',ChevronDown:'chevron-icon',CabinetFormValidation:'form-validation'};
 const exports={},jsx=(type,props)=>({type,props});
 new Function('exports','require',...Object.keys(globals),ts.transpileModule(node.getText(ast)+'\nexports.SettingsPanel=SettingsPanel;',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}
 }).outputText)(exports,()=>({jsx,jsxs:jsx}),...Object.values(globals));
 return exports.SettingsPanel({identity:{ownerKey:'synthetic',email:'owner@local.invalid'},profile:{name:'Данил',phone:'',city:'Краснодар',email:'not-authority@local.invalid'},onClose(){},saveProfile:async value=>value});
}
function nodes(root){return !root||typeof root!=='object'?[]:[root,...[root.props?.children].flat(Infinity).flatMap(nodes)];}
function text(root){return typeof root==='string'?root:root&&typeof root==='object'?[root.props?.children].flat(Infinity).map(text).join(' '):'';}
test('account settings are width-bounded and keep secondary notification controls in an accessible disclosure',()=>{
 const tree=renderSettings(),all=nodes(tree);
 assert.match(tree.props.className,/max-w-3xl/);
 const disclosure=all.find(node=>node.type==='details');assert.ok(disclosure);
 assert.ok(nodes(disclosure).some(node=>node.type==='summary'&&text(node).includes('Уведомления')));
 assert.ok(all.some(node=>node.type==='button'&&text(node).includes('Сохранить настройки')));
 assert.ok(text(tree).includes('Смена пароля'));
});
test('login email is visibly immutable and copyable, bound to identity rather than a stale settings draft',()=>{
 const tree=renderSettings(),all=nodes(tree),email=all.find(node=>node.type==='input'&&node.props.type==='email');
 assert.ok(email);assert.equal(email.props.value,'owner@local.invalid');assert.equal(email.props.readOnly,true);
 assert.equal(email.props.onChange,undefined);assert.notEqual(email.props.disabled,true);
 assert.ok(text(tree).includes('Email для входа'));assert.ok(text(tree).includes('Нельзя изменить'));
 assert.ok(all.some(node=>node.type==='lock-icon'));
});
