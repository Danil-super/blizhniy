import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {nextFairEvent} from '../src/lib/fair-calendar.ts';

test('the same fair remains current throughout its entire Moscow calendar day', () => {
  const event = {date: '2026-11-29', endsAt: '2026-11-29T21:00:00.000Z'};
  for (const now of ['2026-11-12T00:00:00Z', '2026-11-28T21:00:00Z', '2026-11-29T12:00:00Z', '2026-11-29T20:59:59.999Z']) {
    assert.deepEqual(nextFairEvent(new Date(now)), event);
  }
  assert.deepEqual(nextFairEvent(new Date(event.endsAt)), {date: '2026-12-27', endsAt: '2026-12-27T21:00:00.000Z'});
});

test('the monthly schedule handles leap years and the year boundary', () => {
  assert.deepEqual(nextFairEvent(new Date('2024-02-01T00:00:00Z')), {date: '2024-02-25', endsAt: '2024-02-25T21:00:00.000Z'});
  assert.deepEqual(nextFairEvent(new Date('2026-12-31T23:00:00Z')), {date: '2027-01-31', endsAt: '2027-01-31T21:00:00.000Z'});
  assert.throws(() => nextFairEvent(new Date(NaN)), RangeError);
});

test('event identity and cutoff are independent of the server timezone', () => {
  for (const zone of ['UTC', 'Pacific/Honolulu', 'Asia/Tokyo']) {
    const value = execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
      "import {nextFairEvent} from './src/lib/fair-calendar.ts'; process.stdout.write(JSON.stringify(nextFairEvent(new Date('2026-11-29T20:00:00Z'))));"],
    {cwd: process.cwd(), env: {PATH: process.env.PATH, TZ: zone, LANG: 'C.UTF-8'}, encoding: 'utf8'});
    assert.deepEqual(JSON.parse(value), {date: '2026-11-29', endsAt: '2026-11-29T21:00:00.000Z'});
  }
});
