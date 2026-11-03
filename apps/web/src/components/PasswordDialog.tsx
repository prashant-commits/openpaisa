import { useEffect, useRef, useState } from 'react';

interface Props { fileName: string; retry: boolean; onSubmit: (pw: string | null) => void }

export function PasswordDialog({ fileName, retry, onSubmit }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pw, setPw] = useState('');
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} aria-labelledby="pw-h" onCancel={(e) => { e.preventDefault(); onSubmit(null); }}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(pw); }} style={{ display: 'grid', gap: 12 }}>
        <h2 id="pw-h">Password needed</h2>
        <p style={{ margin: 0, overflowWrap: 'anywhere' }}>{fileName} is password protected. The password stays on this device.</p>
        {retry && <p role="alert" style={{ margin: 0, color: 'var(--act)', fontWeight: 700 }}>That password didn't work</p>}
        <label>PDF password
          <input type="password" autoFocus autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <div className="row">
          <button type="submit" className="primary">Unlock</button>
          <button type="button" onClick={() => onSubmit(null)}>Skip this file</button>
        </div>
      </form>
    </dialog>
  );
}
