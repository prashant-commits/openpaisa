export const REPO_URL = 'https://github.com/prashant-commits/openpaisa';

export function TrustPanel() {
  return (
    <header className="trust" aria-label="Privacy">
      <div className="wrap">
        <div className="row"><span className="brand">OpenPaisa</span></div>
        <strong>Processed on this device. Nothing is uploaded.</strong>
        <span className="muted">
          How to check: open DevTools → Network, then add a statement. You'll see no requests.{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener">Source code on GitHub</a>
        </span>
      </div>
    </header>
  );
}
