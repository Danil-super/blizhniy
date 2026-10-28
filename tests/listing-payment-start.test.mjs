import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startListingPayment} from '../src/lib/listing-payment-start.ts';
const quote={listingId:'listing',revision:'1',tariff:{id:'listing-publication',amount:'199.00',durationDays:30},activePayment:null};
test('one explicit click previews and prepares an order, then reuses it',async()=>{
 let prepares=0;const transport={preview:async()=>quote,prepare:async()=>{prepares++;return{id:'order'};}};
 const attempt={input:null,uncertain:false};
 assert.equal(await startListingPayment(transport,'owner','listing','1',attempt,{}),'order');
 assert.equal(await startListingPayment(transport,'owner','listing','1',attempt,{}),'order');
 assert.equal(prepares,1);
});
test('explicit retry after null readback accepts the new offer without creating a fresh key',async()=>{
 let quoteValue=quote,first=true;const inputs=[];
 const transport={preview:async()=>quoteValue,prepare:async(_owner,input)=>{inputs.push({...input});if(first){first=false;throw Error('offer changed');}return{id:'order'};}};
 const attempt={input:null,uncertain:false};
 await assert.rejects(startListingPayment(transport,'owner','listing','1',attempt,{}));
 attempt.uncertain=false; // The UI has explicitly read back a null original order.
 quoteValue={...quote,tariff:{...quote.tariff,amount:'299.00'}};
 assert.equal(await startListingPayment(transport,'owner','listing','1',attempt,{}),'order');
 assert.equal(inputs[1].creationKey,inputs[0].creationKey);assert.equal(inputs[1].expectedAmount,'299.00');
});
test('existing order opens directly and unknown prepare is never repeated automatically',async()=>{
 const attempt={input:null,uncertain:false};let prepares=0;
 const transport={preview:async()=>quote,prepare:async()=>{prepares++;throw Error('lost response');}};
 await assert.rejects(startListingPayment(transport,'owner','listing','1',attempt,{}),/lost response/);
 const key=attempt.input.creationKey;assert.equal(attempt.uncertain,true);
 await assert.rejects(startListingPayment(transport,'owner','listing','1',attempt,{}));assert.equal(prepares,1);assert.equal(attempt.input.creationKey,key);
 assert.equal(await startListingPayment({...transport,preview:async()=>({...quote,activePayment:{id:'existing'}})},'owner','listing','1',{input:null,uncertain:false},{}),'existing');
 assert.equal(prepares,1);
});
