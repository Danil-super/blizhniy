export { PROFILE_NAME_ISSUE, PROFILE_NAME_MAX_LENGTH, normalizeProfileName as normalizeRegistrationName } from './cabinet-field-validation.ts';

// Shared browser/server policy. Never normalize, trim or persist a password here.
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MAX_CODE_UNITS = 256;

export function isValidAccountPassword(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > PASSWORD_MAX_CODE_UNITS ||
      !value.isWellFormed() || value.includes('\0') || !value.trim()) return false;
  const length = [...value].length;
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH;
}
