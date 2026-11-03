import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export class PasswordNeeded extends Error {
  constructor() { super('This PDF is password protected'); this.name = 'PasswordNeeded'; }
}
export class PasswordWrong extends Error {
  constructor() { super("That password didn't work"); this.name = 'PasswordWrong'; }
}

export interface TextItemLike { str: string; transform: number[] }

const SAME_LINE = 2;

/** Group text items into reading-order lines: top to bottom, left to right, joined by single spaces. */
export function groupItemsIntoLines(items: TextItemLike[]): string[] {
  const usable = items.filter((i) => i.str.trim() !== '' && i.transform.length >= 6);
  const sorted = [...usable].sort((a, b) => b.transform[5]! - a.transform[5]!);
  const lines: { y: number; items: TextItemLike[] }[] = [];
  for (const item of sorted) {
    const y = item.transform[5]!;
    const line = lines[lines.length - 1];
    if (line && Math.abs(line.y - y) <= SAME_LINE) line.items.push(item);
    else lines.push({ y, items: [item] });
  }
  return lines.map((l) =>
    l.items
      .sort((a, b) => a.transform[4]! - b.transform[4]!)
      .map((i) => i.str.trim())
      .join(' '),
  );
}

/** Extract text from a PDF locally. Pages are joined with a newline. */
export async function extractPdfText(data: ArrayBuffer, password?: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // pdfjs-dist 5.7 has no eval code path (the isEvalSupported option was removed), so the CSP needs no unsafe-eval.
  const task = pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    password,
  });
  try {
    const doc = await task.promise;
    const out: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter((i): i is typeof i & TextItemLike => 'str' in i && 'transform' in i);
      out.push(...groupItemsIntoLines(items));
    }
    await doc.destroy();
    return out.join('\n');
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err.name === 'PasswordException') {
      throw err.code === 2 ? new PasswordWrong() : new PasswordNeeded();
    }
    throw e;
  }
}
