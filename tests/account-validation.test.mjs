import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidAccountPassword, normalizeRegistrationName } from '../src/lib/account-validation.ts';

test('passwords accept 8–128 Unicode characters without trimming or composition rules', () => {
  for (const value of ['abcdefgh', '  abcd  ', 'пароль🙂🙂', 'a'.repeat(128), '🙂'.repeat(128)]) {
    assert.equal(isValidAccountPassword(value), true);
  }
  for (const value of ['', '1234567', '🙂'.repeat(7), ' '.repeat(8), 'a'.repeat(129), '🙂'.repeat(129), 'abcdefgh\0', 'abcdefgh\ud800', null]) {
    assert.equal(isValidAccountPassword(value), false);
  }
});

test('registration names are bounded printable text, not a mandatory full legal name', () => {
  assert.equal(normalizeRegistrationName('  Анна-Мария  '), 'Анна-Мария');
  assert.equal(normalizeRegistrationName('李'), '李');
  for (const value of [null, '', '   ', 'a'.repeat(121), 'Имя\nФамилия', '\ud800']) {
    assert.equal(normalizeRegistrationName(value), null);
  }
});
