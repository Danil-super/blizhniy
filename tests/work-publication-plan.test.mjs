import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {getBootstrapPlan} from '../scripts/bootstrap-postgres.mjs';
test('work publications are explicit opt-in and preserve the entire previously approved migration prefix',()=>{
 const prior=getBootstrapPlan({includeConfirmationNotice:true}),next=getBootstrapPlan({includeWorkPublications:true});
 assert.equal(prior.length,15);assert.equal(next.length,16);
 assert.deepEqual(next.slice(0,15),prior);assert.equal(next[15].name,'0016-work-publications.sql');
 assert.equal(getBootstrapPlan().some(row=>row.name==='0016-work-publications.sql'),false);
 assert.throws(()=>getBootstrapPlan({includeWorkPublications:'true'}));
});
test('work schema has no implicit grants/import or destructive upgrade and rollback refuses nonempty records',()=>{
 const sql=readFileSync(new URL('../database/migrations/0016-work-publications.sql',import.meta.url),'utf8');
 assert.match(sql,/create table app\.work_publications/);assert.match(sql,/create table app\.work_publication_photos/);
 assert.match(sql,/references app\.users\(id\) on delete cascade/);assert.match(sql,/unique\(author_id,kind,creation_key\)/);
 assert.match(sql,/revoke all on app\.work_publications from public/);assert.doesNotMatch(sql,/grant |drop table|insert into/i);
 const down=readFileSync(new URL('../database/migrations/0016-work-publications.down.sql',import.meta.url),'utf8');
 assert.match(down,/Refusing to remove nonempty work publications/);assert.match(down,/access exclusive/);
});
