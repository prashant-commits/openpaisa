import { useRef, useState } from 'react';

interface Props {
  files: File[];
  busy: boolean;
  onFiles: (files: File[]) => void;
  onRun: () => void;
  onSample: () => void;
}

export function Upload({ files, busy, onFiles, onRun, onSample }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const add = (list: FileList | null) => { if (list?.length) onFiles([...files, ...Array.from(list)]); };
  return (
    <section className="card" aria-labelledby="up-h">
      <h2 id="up-h">Add your statements</h2>
      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      >
        <p style={{ margin: 0 }}>Drop PDF or CSV statements here, or</p>
        <label>
          <span className="sr">Choose statement files (PDF or CSV)</span>
          <input ref={input} type="file" accept=".pdf,.csv,application/pdf,text/csv" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy}>Choose files</button>
        </label>
      </div>
      {files.length > 0 && (
        <ul className="filelist" aria-label="Selected files">
          {files.map((f, i) => <li key={`${f.name}-${i}`}>{f.name}</li>)}
        </ul>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="primary" disabled={busy || files.length === 0} onClick={onRun}>Run on my statements</button>
        <button type="button" disabled={busy} onClick={onSample}>Try with sample data</button>
        {files.length > 0 && <button type="button" disabled={busy} onClick={() => onFiles([])}>Clear files</button>}
      </div>
    </section>
  );
}
