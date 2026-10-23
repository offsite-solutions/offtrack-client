import { readFileSync } from 'node:fs';
import { pidFile } from './config.mjs';
import { claudePid } from './proc.mjs';

const read = (f) => { try { return readFileSync(f, 'utf8').trim() || null; } catch { return null; } };

// A hook által megjegyzett session (a /clear és a /resume után is a friss); végső tartalék az indulási env-érték.
export function currentSession() {
  return read(pidFile(process.ppid)) ?? read(pidFile(claudePid())) ?? (process.env.CLAUDE_CODE_SESSION_ID || null);
}
