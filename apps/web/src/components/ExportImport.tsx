import { useState } from 'react';
import type { AuditReport } from '@openpaisa/engine';
import { decryptReport, encryptReport } from '../lib/vault';

interface Props { report: AuditReport | null; onImport: (r: AuditReport) => void }

export function ExportImport({ report, onImport }: Props) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [impPass, setImpPass] = useState('');
  const [impMsg, setImpMsg] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const canExport = pass.length >= 8 && pass === confirm;

  const doExport = async () => {
    if (!report) return;
    setWorking(true); setExportMsg(null);
    try {
      const blob = await encryptReport(report, pass);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `openpaisa-report-${report.asOf}.opaisa.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMsg('Saved. Keep the passphrase safe: it cannot be recovered.');
    } catch { setExportMsg('Export failed on this browser.'); }
    finally { setWorking(false); }
  };

  const doImport = async () => {
    if (!file) return;
    setWorking(true); setImpMsg(null);
    try { onImport(await decryptReport(file, impPass)); }
    catch (e) { setImpMsg(e instanceof Error ? e.message : "Couldn't decrypt — check the passphrase"); }
    finally { setWorking(false); }
  };

  return (
    <section className="card" aria-labelledby="ei-h" style={{ display: 'grid', gap: 16 }}>
      <h2 id="ei-h" style={{ margin: 0 }}>Save or open a report</h2>
      <p className="muted" style={{ margin: 0 }}>Nothing is stored in this browser. The only copy is an encrypted file you download.</p>
      {report && (
        <fieldset style={{ display: 'grid', gap: 8 }}>
          <legend>Export, encrypted</legend>
          <label>Passphrase (at least 8 characters)
            <input type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          <label>Confirm passphrase
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          {pass !== '' && pass.length < 8 && <span role="alert" className="muted">Use at least 8 characters.</span>}
          {confirm !== '' && pass !== confirm && <span role="alert" className="muted">The passphrases don't match.</span>}
          <div className="row">
            <button type="button" className="primary" disabled={!canExport || working} onClick={doExport}>Download encrypted report</button>
          </div>
          {exportMsg && <span role="status">{exportMsg}</span>}
        </fieldset>
      )}
      <fieldset style={{ display: 'grid', gap: 8 }}>
        <legend>Import</legend>
        <label>Encrypted report file
          <input type="file" accept=".json,application/json" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setImpMsg(null); }} />
        </label>
        <label>Passphrase
          <input type="password" autoComplete="off" value={impPass} onChange={(e) => setImpPass(e.target.value)} />
        </label>
        <div className="row">
          <button type="button" disabled={!file || impPass === '' || working} onClick={doImport}>Open report</button>
        </div>
        {impMsg && <span role="alert" style={{ color: 'var(--act)', fontWeight: 700 }}>{impMsg}</span>}
      </fieldset>
    </section>
  );
}
