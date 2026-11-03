// Trust check: the engine and the web app must never make network calls.
// Fails CI if any network API appears in source. Allowed exceptions need a
// line comment "// network-ok: <reason>" and a reviewer's sign-off.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['packages/engine/src', 'apps/web/src'];
const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /\bEventSource\b/, /import\s*\(\s*['"]https?:/, /from\s+['"]https?:/];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs)$/.test(f) && files.push(p); } };
roots.forEach((r) => { try { walk(r); } catch { /* root may not exist yet */ } });

let bad = 0;
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (line.includes('network-ok:')) return;
    for (const re of banned) if (re.test(line)) { console.error(`${f}:${i + 1}: network API not allowed: ${line.trim()}`); bad++; }
  });
}
if (bad) { console.error(`\n${bad} network call(s) found. OpenPaisa must work fully offline.`); process.exit(1); }
console.log(`No network APIs in ${files.length} source files.`);
