import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret, safeEqual } from '../lib/crypto.js';

describe('crypto', () => {
  it('round-trips a secret', () => {
    const plain = 'Sup3r$ecret:p@ss/word?';
    const blob = encryptSecret(plain);
    expect(blob).toMatch(/^v1:/);
    expect(blob).not.toContain(plain);
    expect(decryptSecret(blob)).toBe(plain);
  });

  it('produces a different ciphertext each time (random iv + salt)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('rejects a tampered ciphertext (GCM auth tag)', () => {
    const blob = encryptSecret('integrity');
    const parts = blob.split(':');
    const ct = Buffer.from(parts[4]!, 'base64');
    ct[0] = ct[0]! ^ 0xff;
    parts[4] = ct.toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('rejects a malformed blob', () => {
    expect(() => decryptSecret('not-a-real-blob')).toThrow(/Malformed/);
    expect(() => decryptSecret('v2:a:b:c:d')).toThrow();
  });

  it('safeEqual compares in constant time and by value', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });

  it('handles unicode', () => {
    const s = 'пароль—пароль—🔒';
    expect(decryptSecret(encryptSecret(s))).toBe(s);
  });
});
