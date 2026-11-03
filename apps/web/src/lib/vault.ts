import type { AuditReport } from '@openpaisa/engine';

const ITER = 310_000;
const BAD = "Couldn't decrypt — check the passphrase";

interface Envelope { v: 1; kdf: 'PBKDF2-SHA256'; iter: number; salt: string; iv: string; ct: string }

const b64 = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iter: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Encrypt the report with AES-GCM 256; the key comes from the passphrase via PBKDF2-SHA256. */
export async function encryptReport(report: AuditReport, passphrase: string): Promise<Blob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITER);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(report))),
  );
  const env: Envelope = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  return new Blob([JSON.stringify(env)], { type: 'application/json' });
}

/** Decrypt an export. Any failure (wrong passphrase, corrupt or foreign file) gives the same message. */
export async function decryptReport(file: Blob | string, passphrase: string): Promise<AuditReport> {
  try {
    const text = typeof file === 'string' ? file : await file.text();
    const env = JSON.parse(text) as Envelope;
    if (env.v !== 1 || env.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(env.iter) || env.iter < ITER) throw new Error('bad');
    const key = await deriveKey(passphrase, unb64(env.salt), env.iter);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
    return JSON.parse(new TextDecoder().decode(plain)) as AuditReport;
  } catch {
    throw new Error(BAD);
  }
}
