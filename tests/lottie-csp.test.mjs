import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';

const require=createRequire(import.meta.url),ts=require('typescript'),player='lottie-web/build/player/lottie_light';
test('both SVG animation callers load the expression-free player under nonce-only CSP',()=>{
 for(const file of ['src/components/AnimatedLocationIcon.tsx','src/components/listings/ListingViewCounter.tsx']){
  const ast=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),imports=[];
  function visit(node){
   if(ts.isImportDeclaration(node)&&!node.importClause?.isTypeOnly&&node.moduleSpecifier.text.startsWith('lottie-web'))imports.push(node.moduleSpecifier.text);
   if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text.startsWith('lottie-web'))imports.push(node.arguments[0].text);
   ts.forEachChild(node,visit);
  }
  visit(ast);assert.deepEqual(imports,[player],file);
 }
});
test('the installed light player contains no eval or Function constructor calls',()=>{
 const ast=ts.createSourceFile('player.js',readFileSync(require.resolve(player),'utf8'),ts.ScriptTarget.Latest,true),dynamic=[];
 function visit(node){if((ts.isCallExpression(node)||ts.isNewExpression(node))&&ts.isIdentifier(node.expression)&&['eval','Function'].includes(node.expression.text))dynamic.push(node.expression.text);ts.forEachChild(node,visit);}
 visit(ast);assert.deepEqual(dynamic,[]);
});
test('shipped SVG keyframes retain their values without controller expressions or rendered effects',()=>{
 const location=JSON.parse(readFileSync(new URL('../location.json',import.meta.url),'utf8')),eyes=JSON.parse(readFileSync(new URL('../eyes.json',import.meta.url),'utf8'));
 const control=[...location.layers,...location.assets.flatMap(asset=>asset.layers??[])].find(layer=>layer.nm==='control');assert.ok(control);
 const controls=Object.fromEntries(control.ef.map(effect=>[effect.nm,effect.ef[0].v]));
 assert.equal(controls.stroke.a,0);assert.equal(controls.stroke.k,2);
 for(const color of ['primary','secondary'])assert.equal(controls[color].a,0);
 let expressions=0;
 function visit(value){
  if(!value||typeof value!=='object')return;
  if(value.ef)for(const effect of value.ef)assert.ok([2,5,7].includes(effect.ty),'light player must not drop a rendered effect');
  if(typeof value.x==='string'){
   expressions++;const color=value.x.match(/^var \$bm_rt;\n\$bm_rt = comp\('wired-outline-18-location-pin'\)\.layer\('control'\)\.effect\('(primary|secondary)'\)\('Color'\);$/)?.[1];
   if(color){assert.equal(value.a,0);assert.deepEqual(value.k,[...controls[color].k,1]);}
   else{
    assert.equal(value.x,"var $bm_rt;\n$bm_rt = $bm_mul($bm_div(value, 2), comp('wired-outline-18-location-pin').layer('control').effect('stroke')('Menu'));");
    if(value.a===0)assert.ok(Number.isFinite(value.k)&&value.k>=0);
    else{assert.equal(value.a,1);assert.ok(Array.isArray(value.k)&&value.k.length>0);}
   }
  }
  for(const item of Object.values(value))visit(item);
 }
 visit(location);assert.equal(expressions,30);expressions=0;visit(eyes);assert.equal(expressions,0);
});
