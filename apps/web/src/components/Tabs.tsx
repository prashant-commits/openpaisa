import { useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface TabDef { id: string; label: string; content: ReactNode }

export function Tabs({ tabs, label }: { tabs: TabDef[]; label: string }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (to: number) => { const n = (to + tabs.length) % tabs.length; setActive(n); refs.current[n]?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(active + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(active - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(tabs.length - 1); }
  };
  return (
    <div>
      <div role="tablist" aria-label={label} className="tablist" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button
            key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" type="button"
            id={`tab-${t.id}`} aria-controls={`panel-${t.id}`} aria-selected={i === active}
            tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)}
          >{t.label}</button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.id} role="tabpanel" id={`panel-${t.id}`} aria-labelledby={`tab-${t.id}`} className="tabpanel" hidden={i !== active}>
          {i === active && t.content}
        </div>
      ))}
    </div>
  );
}
