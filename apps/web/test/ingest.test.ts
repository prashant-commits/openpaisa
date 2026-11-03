import { describe, expect, it, vi } from 'vitest';
import type { ParsedStatement } from '@openpaisa/engine';
import { ingestFilesWith, type IngestDeps } from '../src/lib/ingest';
import { PasswordNeeded, PasswordWrong } from '../src/lib/pdfText';

const stmt = (id: string): ParsedStatement => ({
  account: { id, institution: 'Test Bank', kind: 'savings' }, transactions: [], warnings: [],
});
const file = (name: string, type = '') => new File(['x'], name, { type });

function deps(over: Partial<IngestDeps> = {}): IngestDeps {
  return {
    extractPdf: async () => 'good text',
    parse: (t) => {
      if (t.startsWith('good')) return stmt('a');
      throw new Error('Unsupported statement format. See CONTRIBUTING.md to add your bank.');
    },
    readText: async (f) => (f.name.startsWith('bad') ? 'junk' : 'good csv'),
    readBytes: async () => new ArrayBuffer(1),
    ...over,
  };
}

describe('ingestFilesWith', () => {
  it('skips a file when the password is wrong twice then cancelled', async () => {
    const ask = vi.fn()
      .mockResolvedValueOnce('nope1')
      .mockResolvedValueOnce('nope2')
      .mockResolvedValueOnce(null);
    let calls = 0;
    const d = deps({
      extractPdf: async () => { calls++; throw calls === 1 ? new PasswordNeeded() : new PasswordWrong(); },
    });
    const r = await ingestFilesWith(d, [file('locked.pdf')], ask);
    expect(r.statements).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.message).toMatch(/skipped/);
    expect(ask.mock.calls.map((c) => c[1])).toEqual([false, true, true]);
  });
  it('unlocks with the right password', async () => {
    const d = deps({
      extractPdf: async (_b, pw) => { if (pw !== 'secret') throw new PasswordNeeded(); return 'good pdf'; },
    });
    const r = await ingestFilesWith(d, [file('l.pdf', 'application/pdf')], async () => 'secret');
    expect(r.statements).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });
  it('reports unsupported text with the engine message', async () => {
    const r = await ingestFilesWith(deps(), [file('bad.csv')], async () => null);
    expect(r.errors[0]!.message).toMatch(/Unsupported statement format/);
  });
  it('processes the good file and reports the bad one', async () => {
    const r = await ingestFilesWith(deps(), [file('good.csv'), file('bad.csv')], async () => null);
    expect(r.statements).toHaveLength(1);
    expect(r.errors).toEqual([{ file: 'bad.csv', message: expect.stringMatching(/Unsupported/) }]);
  });
  it('turns a corrupt PDF into an error without crashing the batch', async () => {
    const d = deps({ extractPdf: async () => { throw new Error('Invalid PDF structure.'); } });
    const r = await ingestFilesWith(d, [file('x.pdf'), file('good.csv')], async () => null);
    expect(r.statements).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
  });
  it('reports an image-only PDF (empty text) as an unsupported-format error', async () => {
    const d = deps({ extractPdf: async () => '' });
    const r = await ingestFilesWith(d, [file('scan.pdf', 'application/pdf')], async () => null);
    expect(r.statements).toHaveLength(0);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.file).toBe('scan.pdf');
    expect(r.errors[0]!.message).toMatch(/Unsupported statement format/);
  });
});
