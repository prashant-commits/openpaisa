import type { AuditInput, AuditReport } from './types.js';

/** Run the full audit. Pure function: same input, same output. Lane B implements. */
export function runAudit(input: AuditInput): AuditReport {
  void input;
  throw new Error('runAudit: not implemented yet');
}
