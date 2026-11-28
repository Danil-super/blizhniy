import assert from 'node:assert/strict';
import {test} from 'node:test';
import {publicationTextRange} from '../src/lib/publication-text-selection.ts';

test('publication text selection agrees with PostgreSQL character offsets around emoji',()=>{
 const value='до 😺 скрыть после';
 assert.deepEqual(publicationTextRange(value,6,12),{start:5,end:11});
 assert.deepEqual(publicationTextRange(value,3,5),{start:3,end:4});
 assert.equal(publicationTextRange(value,4,5),null);
 assert.equal(publicationTextRange(value,6,6),null);
 assert.equal(publicationTextRange(value,0,99),null);
 assert.deepEqual(publicationTextRange('а\r\nб\rв',2,5),{start:3,end:6});
});
