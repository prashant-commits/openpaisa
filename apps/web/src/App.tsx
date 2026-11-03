import { useCallback, useRef, useState } from 'react';
import { runAudit } from '@openpaisa/engine';
import type { AuditReport } from '@openpaisa/engine';
import './styles.css';
import { sampleReport } from './demo/sampleReport';
import { ingestFiles } from './lib/ingest';
import type { IngestError } from './lib/ingest';
import { localIsoDate } from './lib/format';
import { TrustPanel, REPO_URL } from './components/TrustPanel';
import { Upload } from './components/Upload';
import { Headline } from './components/Headline';
import { InsightCard } from './components/InsightCard';
import { PasswordDialog } from './components/PasswordDialog';
import { MoneyView } from './components/MoneyView';
import { ExportImport } from './components/ExportImport';

const COMING_SOON = 'Analysis engine is coming soon — try the sample data';

export function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<IngestError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ fileName: string; retry: boolean } | null>(null);
  const resolver = useRef<((pw: string | null) => void) | null>(null);

  const askPassword = useCallback((fileName: string, retry: boolean) => new Promise<string | null>((resolve) => {
    resolver.current = resolve;
    setPrompt({ fileName, retry });
  }), []);

  const answer = (pw: string | null) => { setPrompt(null); resolver.current?.(pw); resolver.current = null; };

  const run = async () => {
    setBusy(true); setErrors([]); setNotice(null);
    try {
      const { statements, errors: errs } = await ingestFiles(files, askPassword);
      setErrors(errs);
      if (statements.length === 0) return;
      try {
        setReport(runAudit({ statements, asOf: localIsoDate() }));
      } catch (e) {
        setNotice(e instanceof Error && /not implemented/i.test(e.message) ? COMING_SOON : `Couldn't analyse these statements: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    } finally { setBusy(false); }
  };

  const reset = () => { setReport(null); setFiles([]); setErrors([]); setNotice(null); };

  return (
    <>
      <TrustPanel />
      <main className="wrap">
        {!report && (
          <>
            <Upload files={files} busy={busy} onFiles={setFiles} onRun={run} onSample={() => { setErrors([]); setNotice(null); setReport(sampleReport); }} />
            {busy && <p role="status" className="card">Reading your statements on this device…</p>}
            {notice && <p role="alert" className="card notice">{notice}</p>}
            {errors.map((e, i) => (
              <section key={`${e.file}-${i}`} className="card err" role="alert">
                <h3 style={{ overflowWrap: 'anywhere' }}>{e.file}</h3>
                <p style={{ margin: '0 0 4px' }}>{e.message}</p>
                <a href={`${REPO_URL}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer noopener">How to add support for your bank</a>
              </section>
            ))}
          </>
        )}
        {report && (
          <>
            <div className="row"><button type="button" onClick={reset}>Start over</button></div>
            <Headline report={report} />
            <section aria-labelledby="ins-h">
              <h2 id="ins-h">What to look at first</h2>
              <ul className="insights">{report.insights.map((i) => <InsightCard key={i.id} insight={i} />)}</ul>
            </section>
            <MoneyView report={report} />
            <ExportImport report={report} onImport={setReport} />
          </>
        )}
        {!report && <ExportImport report={null} onImport={setReport} />}
      </main>
      {prompt && <PasswordDialog fileName={prompt.fileName} retry={prompt.retry} onSubmit={answer} />}
    </>
  );
}
