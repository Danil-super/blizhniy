import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createLocalPaymentDb } from '../scripts/local-payment-db.mjs';

test('draft creation receipts survive a lost response and distinguish owners, operations and edits', async t => {
  const db = createLocalPaymentDb('draft-replay-' + randomUUID().slice(0,8));
  try {
    await db.start();
    const owner = randomUUID(), other = randomUUID(), key = randomUUID();
    await db.sql(`insert into auth.users(id) values ('${owner}'), ('${other}')`);
    const role = await db.sql("select has_function_privilege('authenticated','public.create_work_draft_once(text,uuid,jsonb,text[])','execute'),has_table_privilege('anon','private.work_draft_creations','select'),has_table_privilege('service_role','private.work_draft_creations','update')");
    assert.equal(role, 'f|f|f');
    const [city_id,region_id] = (await db.sql('select id,region_id from cities limit 1')).split('|');
    for (const [table,folder,images] of [['vacancies','vacancies','vacancy_images'],['work_requests','work-requests','work_request_images']]) {
      await t.test(table, async () => {
        const create = (account, receiptKey, title, file = 'one', status = 'draft') => {
          const fields = {author_id:account,title,city_id,region_id,description:'Synthetic',status,show_exact_address:false,
            ...(table === 'vacancies' ? {organization_name:'Test org',employer_type:'organization',placement_right_confirmed:false,is_paid:false} : {request_type:'private_request'})};
          return db.sql(`set role service_role; select public.create_work_draft_once('${table}','${receiptKey}','${JSON.stringify(fields)}'::jsonb,array['${folder}/${account}/${file}.webp'])`);
        };
        const [first, simultaneous] = await Promise.all([create(owner,key,'Draft'),create(owner,key,'Draft')]);
        assert.match(first,/^[a-f0-9-]{36}$/); assert.equal(first,simultaneous);
        assert.equal(await create(owner,key,'Draft'),first);
        assert.equal(await db.sql(`select count(*) from ${table} where author_id='${owner}'`),'1');
        assert.equal(await create(owner,key,'Changed'), '');
        assert.equal(await create(owner,key,'Draft','changed-photo'), '');
        assert.notEqual(await create(other,key,'Draft'),first);
        assert.notEqual(await create(owner,randomUUID(),'Draft'),first);
        await db.sql(`alter table ${images} add check(storage_path not like '%/broken.webp')`);
        const retryKey=randomUUID();
        await assert.rejects(create(owner,retryKey,'Retry','broken'),/check constraint/);
        assert.equal(await db.sql(`select count(*) from private.work_draft_creations where creation_key='${retryKey}'`),'0');
        assert.match(await create(owner,retryKey,'Retry'),/^[a-f0-9-]{36}$/);
        await assert.rejects(create(owner,randomUUID(),'Paid','one','published'),/Invalid draft/);
        await db.sql(`delete from ${table} where id='${first}'`);
        assert.equal(await create(owner,key,'Draft'),first);
        assert.equal(await db.sql(`select count(*) from ${table} where id='${first}'`),'0');
      });
    }
  } finally {
    const meta = await db.inspect();
    if (meta) await db.docker(['rm','--force','--volumes',meta.Id]);
  }
});
