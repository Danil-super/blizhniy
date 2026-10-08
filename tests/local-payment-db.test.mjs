import assert from 'node:assert/strict';
import test from 'node:test';
import { getLocalDbConfig, assertLocalContainer, getReferenceData } from '../scripts/local-payment-db.mjs';

test('local payment DB is offline and ignores cloud/Docker environment overrides', () => {
  const config = getLocalDbConfig();
  assert.equal(config.host, 'unix:///var/run/docker.sock');
  assert.equal(config.network, 'none');
  assert.match(config.image, /^postgres@sha256:[a-f0-9]{64}$/);
  assert.match(config.name, /^blizhniy-local-payments-[a-f0-9]{12}-dev$/);
  for (const scope of ['../production', '', 'a,b', '--privileged', 'x'.repeat(33)]) {
    assert.throws(() => getLocalDbConfig(scope), /scope/);
  }
});

test('container ownership, image and network must all match before accessing data', () => {
  const config = getLocalDbConfig('test');
  const valid = () => ({
    Id: 'a'.repeat(64), Name: `/${config.name}`,
    Config: { Image: config.image, Labels: config.labels },
    HostConfig: { NetworkMode: 'none', PortBindings: {} },
    NetworkSettings: { Ports: { '5432/tcp': null } },
  });
  assert.equal(assertLocalContainer(valid(), config), 'a'.repeat(64));
  for (const mutate of [
    value => { value.Config.Labels = {}; },
    value => { value.Name = '/production'; },
    value => { value.Config.Image = 'postgres:latest'; },
    value => { value.HostConfig.NetworkMode = 'bridge'; },
    value => { value.HostConfig.PortBindings = { '5432/tcp': [{ HostPort: '5432' }] }; },
    value => { value.NetworkSettings.Ports['5432/tcp'] = [{ HostIp: '0.0.0.0', HostPort: '5432' }]; },
  ]) {
    const value = valid(); mutate(value);
    assert.throws(() => assertLocalContainer(value, config), /local container/);
  }
});

test('clean reference seed contains the approved catalog and tariffs, never demo users or payments', () => {
  const seed = getReferenceData();
  assert.deepEqual(Object.keys(seed).sort(), ['categories', 'cities', 'professions', 'region', 'tariffs']);
  assert.equal(seed.cities.length, 26);
  assert.equal(seed.categories.length, 18);
  assert.equal(seed.professions.length, 14);
  assert.equal(seed.tariffs.length, 7);
  assert.equal(seed.categories.find(row => row.slug === 'sad-i-rasteniya').children.length, 17);
  assert.equal(seed.categories.find(row => row.slug === 'ritualnye-uslugi').children.length, 9);
  assert.equal(seed.tariffs.find(row => row.action === 'ad_marquee').price, 299);
  assert.equal(seed.tariffs.find(row => row.action === 'work_request_publication').durationDays, 30);
  assert.doesNotMatch(JSON.stringify(seed), /@|\+7861|contact_phone|provider_payment_id/);
});
