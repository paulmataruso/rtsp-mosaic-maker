import {
  randomBytes,
  scryptSync,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadEnv } from '../config/env.js';

/**
 * Symmetric encryption for camera passwords at rest.
 *
 * Format (single string, colon-separated base64):
 *   v1:<salt>:<iv>:<authTag>:<ciphertext>
 *
 * The 32-byte key is derived with scrypt from APP_SECRET. If APP_SECRET is not
 * provided, a random key file is created under DATA_DIR (0600) and reused, so
 * the deployment still works out of the box while staying encrypted at rest.
 */

const VERSION = 'v1';
const KEY_LEN = 32;

let keyMaterial: Buffer | undefined;

function resolveKeyMaterial(): Buffer {
  if (keyMaterial) return keyMaterial;
  const env = loadEnv();
  if (env.APP_SECRET && env.APP_SECRET.length >= 8) {
    keyMaterial = Buffer.from(env.APP_SECRET, 'utf8');
    return keyMaterial;
  }
  const keyPath = join(env.DATA_DIR, 'secret.key');
  if (existsSync(keyPath)) {
    keyMaterial = readFileSync(keyPath);
    return keyMaterial;
  }
  mkdirSync(dirname(keyPath), { recursive: true });
  const generated = randomBytes(48);
  writeFileSync(keyPath, generated, { mode: 0o600 });
  try {
    chmodSync(keyPath, 0o600);
  } catch {
    /* best effort on platforms without chmod */
  }
  keyMaterial = generated;
  return keyMaterial;
}

function deriveKey(salt: Buffer): Buffer {
  return scryptSync(resolveKeyMaterial(), salt, KEY_LEN);
}

export function encryptSecret(plaintext: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    salt.toString('base64'),
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join(':');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('Malformed encrypted secret');
  }
  const [, saltB64, ivB64, tagB64, ctB64] = parts as [string, string, string, string, string];
  const salt = Buffer.from(saltB64, 'base64');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  const key = deriveKey(salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Constant-time string comparison for credentials. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // Still burn ~equal time.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

/** For tests. */
export function __resetCryptoForTest(secret?: string): void {
  keyMaterial = secret ? Buffer.from(secret, 'utf8') : undefined;
}
