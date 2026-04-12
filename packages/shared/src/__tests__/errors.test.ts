import { describe, expect, it } from 'vitest';
import { DevkitError, DevkitErrorCode, generateOpId } from '../errors';

describe('generateOpId', () => {
  it('matches expected format op_XXXXXX_XXXXXX', () => {
    const id = generateOpId();
    expect(id).toMatch(/^op_[0-9a-f]{6}_\d{6}$/);
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateOpId()));
    expect(ids.size).toBeGreaterThan(190);
  });
});

describe('DevkitError', () => {
  it('extends Error', () => {
    const err = new DevkitError(DevkitErrorCode.BACKEND_UNAVAILABLE, 'backend down');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(DevkitError);
  });

  it('preserves message and code', () => {
    const err = new DevkitError(DevkitErrorCode.DEX_MANIFEST_NOT_FOUND, 'no manifest');
    expect(err.message).toBe('no manifest');
    expect(err.code).toBe(DevkitErrorCode.DEX_MANIFEST_NOT_FOUND);
    expect(err.name).toBe('DevkitError');
  });

  it('supports cause via options', () => {
    const cause = new Error('original');
    const err = new DevkitError(DevkitErrorCode.DEX_DEPLOY_FAILED, 'deploy failed', { cause });
    expect((err as { cause?: unknown }).cause).toBe(cause);
  });
});

describe('DevkitError.is', () => {
  it('returns true for DevkitError instances', () => {
    expect(DevkitError.is(new DevkitError(DevkitErrorCode.UNKNOWN, 'x'))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(DevkitError.is(new Error('x'))).toBe(false);
  });

  it('returns false for non-error values', () => {
    expect(DevkitError.is(null)).toBe(false);
    expect(DevkitError.is('string')).toBe(false);
    expect(DevkitError.is(undefined)).toBe(false);
  });
});

describe('DevkitError.hasCode', () => {
  it('returns true when code matches', () => {
    const err = new DevkitError(DevkitErrorCode.KEYSTORE_LOCKED, 'locked');
    expect(DevkitError.hasCode(err, DevkitErrorCode.KEYSTORE_LOCKED)).toBe(true);
  });

  it('returns false when code does not match', () => {
    const err = new DevkitError(DevkitErrorCode.KEYSTORE_LOCKED, 'locked');
    expect(DevkitError.hasCode(err, DevkitErrorCode.NODE_NOT_RUNNING)).toBe(false);
  });

  it('returns false for non-DevkitError', () => {
    expect(DevkitError.hasCode(new Error('x'), DevkitErrorCode.UNKNOWN)).toBe(false);
  });
});
