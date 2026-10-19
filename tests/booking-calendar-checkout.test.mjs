import assert from 'node:assert/strict';import {test} from 'node:test';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import vm from 'node:vm';import * as calendar from '../src/lib/booking-availability.ts';
const require=createRequire(import.meta.url),ts=require('typescript'),source=readFileSync(new URL('../src/components/listings/BookingCalculator.tsx',import.meta.url),'utf8'),ast=ts.createSourceFile('calendar.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['BookingCalendar','toDate','dateKey','todayKey','maxDateKey','addDays','addDaysKey','nightsBetween','isWeekend','monthDays','monthKey','resolveStayStartLimit','resolveStayEndLimit','dateIsBookedByRequest','rangeHasUnavailableDates'];
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text));assert.equal(functions.length,names.length);
const exports={};vm.runInNewContext(ts.transpileModule(functions.map(node=>node.getText(ast)).join('\n')+'\nexports.calendar=BookingCalendar;exports.range=rangeHasUnavailableDates;exports.setRange=value=>rangeHasUnavailableDates=value;',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
 exports,Date,Set,...calendar,useState:initial=>[initial,()=>{}],ChevronLeft:'svg',ChevronRight:'svg',require:name=>{assert.equal(name,'react/jsx-runtime');return require(name);},
});
const id='10000000-0000-4000-8000-000000000001',booking={mode:'stay',priceWeekday:100,priceWeekend:150,minNights:2,maxGuests:4,includedGuests:2};
function day(date,extra={}){const tree=exports.calendar({booking,today:'2026-10-19',listingId:id,startDate:'2026-10-20',endDate:'',selectedDates:new Set(),requests:[{listingId:id,startDate:'2026-10-23',endDate:'2026-10-25',guests:1,status:'accepted'}],onDateClick(){},...extra});
 const find=node=>{if(!node||typeof node!=='object')return undefined;if(node.type==='button'&&node.key===date)return node;for(const child of [node.props?.children].flat(Infinity)){const value=find(child);if(value)return value;}};
 const button=find(tree);assert.ok(button);return button.props;
}
test('the shared calendar allows checkout on the first occupied or owner-blocked day when earlier nights are all free',()=>{
 assert.equal(day('2026-10-23').disabled,false);assert.equal(day('2026-10-22',{booking:{...booking,blockedDates:['2026-10-22']}}).disabled,false);
 assert.match(day('2026-10-23')['aria-label'],/23 октября 2026.*дата выезда/);
});
test('the shared calendar refuses an occupied start, a crossing period and fewer nights than the declared minimum',()=>{
 assert.equal(day('2026-10-23',{endDate:'2026-10-22'}).disabled,true);assert.equal(day('2026-10-25').disabled,true);assert.equal(day('2026-10-21').disabled,true);
});
test('typing a distant year never materializes a multi-year night array while rendering calendar cells',()=>{
 exports.setRange((start,end,...rest)=>{assert.ok(calendar.bookingNightsCount(start,end)<=30,'date range loop is bounded before it executes');return exports.range(start,end,...rest);});
 try{assert.equal(day('2026-10-23',{startDate:'0001-01-01'}).disabled,true);}finally{exports.setRange(exports.range);}
});
