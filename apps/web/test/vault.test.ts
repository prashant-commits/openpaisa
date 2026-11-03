import { describe, expect, it } from 'vitest';
import { sampleReport } from '../src/demo/sampleReport';
import { decryptReport, encryptReport } from '../src/lib/vault';

describe('vault', () => {
  it('round-trips a report', async () => {
    const blob = await encryptReport(sampleReport, 'correct horse battery');
    expect(await decryptReport(blob, 'correct horse battery')).toEqual(sampleReport);
  });
  it('rejects a wrong passphrase with the friendly message', async () => {
    const blob = await encryptReport(sampleReport, 'correct horse battery');
    await expect(decryptReport(blob, 'wrong passphrase')).rejects.toThrow("Couldn't decrypt — check the passphrase");
  });
  it('rejects garbage input the same way', async () => {
    await expect(decryptReport('not json', 'x')).rejects.toThrow("Couldn't decrypt — check the passphrase");
  });
  it('uses fresh salt and IV each time', async () => {
    const a = JSON.parse(await (await encryptReport(sampleReport, 'passphrase1')).text());
    const b = JSON.parse(await (await encryptReport(sampleReport, 'passphrase1')).text());
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });
  it('records at least 310,000 iterations and the expected shape', async () => {
    const env = JSON.parse(await (await encryptReport(sampleReport, 'passphrase1')).text());
    expect(env.iter).toBeGreaterThanOrEqual(310_000);
    expect(env).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256' });
    expect(atob(env.salt)).toHaveLength(16);
    expect(atob(env.iv)).toHaveLength(12);
  });
  it('refuses a file whose iteration count was weakened', async () => {
    const env = JSON.parse(await (await encryptReport(sampleReport, 'passphrase1')).text());
    env.iter = 1;
    await expect(decryptReport(JSON.stringify(env), 'passphrase1')).rejects.toThrow("Couldn't decrypt");
  });
});
