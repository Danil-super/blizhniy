import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
import * as availability from '../src/lib/booking-availability.ts';
const ts=createRequire(import.meta.url)('typescript');
function load(name,dependencies){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(path=>{if(!Object.hasOwn(dependencies,path))throw Error('Unapproved publication-check dependency');return dependencies[path];},exports);return exports;}
const booking=load('booking-details',{'./booking-availability':availability});
export const bookingDetails=booking;
export const publicationCheck=load('listing-publication-check',{'./booking-details':booking});
