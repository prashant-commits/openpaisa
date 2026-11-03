import { parseStatement } from '@openpaisa/engine';
import type { ParsedStatement } from '@openpaisa/engine';
import { extractPdfText, PasswordNeeded, PasswordWrong } from './pdfText';

export type AskPassword = (fileName: string, retry: boolean) => Promise<string | null>;
export interface IngestError { file: string; message: string }
export interface IngestResult { statements: ParsedStatement[]; errors: IngestError[] }

export interface IngestDeps {
  extractPdf(data: ArrayBuffer, password?: string): Promise<string>;
  parse(text: string): ParsedStatement;
  readText(file: File): Promise<string>;
  readBytes(file: File): Promise<ArrayBuffer>;
}

const isPdf = (f: File): boolean => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Dependency-injected core, so the flow can be tested without pdf.js. Never throws for a single bad file. */
export async function ingestFilesWith(
  deps: IngestDeps, files: File[], askPassword: AskPassword,
): Promise<IngestResult> {
  const statements: ParsedStatement[] = [];
  const errors: IngestError[] = [];

  for (const file of files) {
    try {
      let text: string;
      if (isPdf(file)) {
        const bytes = await deps.readBytes(file);
        let password: string | undefined;
        let retry = false;
        for (;;) {
          try {
            text = await deps.extractPdf(bytes, password);
            break;
          } catch (e) {
            if (!(e instanceof PasswordNeeded || e instanceof PasswordWrong)) throw e;
            const answer = await askPassword(file.name, e instanceof PasswordWrong || retry);
            if (answer === null) {
              errors.push({ file: file.name, message: 'Password not provided, file skipped.' });
              text = '';
              break;
            }
            password = answer;
            retry = true;
          }
        }
        if (text === '') continue;
      } else {
        text = await deps.readText(file);
      }
      statements.push(deps.parse(text));
    } catch (e) {
      errors.push({ file: file.name, message: e instanceof Error ? e.message : 'Could not read this file.' });
    }
  }
  return { statements, errors };
}

const browserDeps: IngestDeps = {
  extractPdf: extractPdfText,
  parse: parseStatement,
  readText: (f) => f.text(),
  readBytes: (f) => f.arrayBuffer(),
};

export function ingestFiles(files: File[], askPassword: AskPassword): Promise<IngestResult> {
  return ingestFilesWith(browserDeps, files, askPassword);
}
