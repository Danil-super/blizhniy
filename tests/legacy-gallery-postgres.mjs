import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createLocalPaymentDb } from '../scripts/local-payment-db.mjs';

test('legacy publication edits commit the parent, cover and ordered images together', async t => {
  const db = createLocalPaymentDb('gallery-' + randomUUID().slice(0, 8));
  try {
    await db.start();
    const owner = randomUUID();
    await db.sql(`insert into auth.users(id) values ('${owner}')`);
    const asService = sql => db.sql('set role service_role; ' + sql);
    for (const spec of [
      { parent: 'listings', child: 'listing_images', key: 'listing_id', folder: 'listings',
        extra: ',listing_type,category_id', values: ",'sell',(select id from categories limit 1)" },
      { parent: 'vacancies', child: 'vacancy_images', key: 'vacancy_id', folder: 'vacancies',
        extra: ',organization_name', values: ",'Example'", cover: 'logo_path' },
      { parent: 'work_requests', child: 'work_request_images', key: 'work_request_id', folder: 'work-requests',
        extra: '', values: '', cover: 'photo_path' },
    ]) {
      await t.test(spec.parent, async () => {
        const { parent, child, key, folder, cover, extra, values } = spec;
        const id = await asService(`insert into ${parent} (author_id,title,description,city_id,region_id${extra})
          select '${owner}','Before','Synthetic',id,region_id${values} from cities limit 1 returning id`);
        const scope = `id='${id}' and author_id='${owner}' and status='draft'`;
        const path = name => `${folder}/${owner}/${name}.webp`;
        const update = (title, paths, filter = scope) => asService(`update ${parent} set title='${title}'
          ${paths === undefined ? '' : ',replacement_image_paths=array[' + paths.map(p => "'" + p + "'").join(',') + ']::text[]'}
          where ${filter}`);
        const read = async () => JSON.parse(await db.sql(`select json_build_object(
          'title', p.title, 'input', p.replacement_image_paths, 'cover', ${cover ? 'p.' + cover : 'null'},
          'images', (select coalesce(json_agg(json_build_array(i.id, i.storage_path, i.sort_order) order by i.sort_order), '[]')
          from ${child} i where i.${key}=p.id)) from ${parent} p where id='${id}'`));
        await update('Before', [path('one'), path('two')]);
        const before = await read();
        assert.deepEqual(before.images.map(row => row.slice(1)), [[path('one'), 0], [path('two'), 1]]);
        assert.equal(before.cover, cover ? path('one') : null);
        assert.equal(before.input, null);
        await db.sql(`alter table ${child} add check (storage_path <> '${path('broken')}')`);
        await assert.rejects(update('Failed', [path('new'), path('broken')]), /check constraint/);
        assert.deepEqual(await read(), before, 'child write failure preserves original rows and cover');
        await assert.rejects(update('Failed', [folder + '/' + randomUUID() + '/other.webp']), /Invalid gallery paths/);
        await update('Wrong owner', [], `id='${id}' and author_id='${randomUUID()}'`);
        await update('Wrong status', [], `id='${id}' and status='published'`);
        assert.deepEqual(await read(), before);
        await update('Text only');
        assert.deepEqual(await read(), { ...before, title: 'Text only' });
        await update('Reordered', [path('two'), path('one')]);
        const reordered = await read();
        assert.deepEqual(reordered.images.map(row => row.slice(1)), [[path('two'), 0], [path('one'), 1]]);
        assert.equal(reordered.cover, cover ? path('two') : null);
        await Promise.all(['first', 'second'].map(name => update(name, [path(name), path(name + '-2')])));
        const last = await read();
        assert.ok(['first', 'second'].includes(last.title));
        assert.deepEqual(last.images.map(row => row.slice(1)), [[path(last.title), 0], [path(last.title + '-2'), 1]]);
        assert.equal(last.cover, cover ? path(last.title) : null);
        await update('Cleared', []);
        assert.deepEqual(await read(), { title: 'Cleared', input: null, cover: null, images: [] });
      });
    }
  } finally {
    const meta = await db.inspect();
    if (meta) await db.docker(['rm', '--force', '--volumes', meta.Id]);
  }
});
