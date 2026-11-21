const assert = require('node:assert/strict');
const test = require('node:test');
const {loadLocalPrimaryModule} = require('../scripts/local-primary-modules.cjs');
const {publicationOpenGraph} = loadLocalPrimaryModule('publication-open-graph');
const {publicMediaUrl} = loadLocalPrimaryModule('storage-upload');
const publication = '875e7118-865b-4f59-ae33-acdb3aa50ba4';
const photo = '132cd017-1d3b-4ec5-bf87-b58b7de757db';
const preview = images => publicationOpenGraph('Объявление', 'Описание', '/obyavlenie/'+publication, images);

test('social previews use the first public photo for all publication backends', () => {
  for (const resource of ['listings', 'work-publications', 'service-publications']) {
    const cover = '/api/'+resource+'/'+publication+'/photos/'+photo;
    assert.deepEqual(preview(['/api/account/media', cover, '/brand/logo.jpg']).images, [cover]);
  }
  const legacy = publicMediaUrl('vacancies/'+publication+'/'+photo+'.jpg');
  assert.deepEqual(preview([legacy]).images, [legacy]);
});

test('cards with missing or unsupported images share the site logo', () => {
  const links = ['blob:local', 'data:image/png;base64,eA==', 'https://cdn.example.invalid/photo.jpg',
    '/api/account/media', publicMediaUrl('listings/private.png')+'?token=test'];
  assert.deepEqual(preview(links).images, ['/brand/logo.jpg']);
  assert.deepEqual(preview([]).images, ['/brand/logo.jpg']);
});
