import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

// A szülőlánc első `claude` folyamata. Ha nincs ilyen (például tesztben), a közvetlen szülő.
export function claudePid() {
  let pid = process.ppid;
  for (let i = 0; pid > 1 && i < 30; i++) {
    let line;
    try {
      line = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim();
    } catch {
      break;
    }
    const m = line.match(/^(\d+)\s+(.*)$/);
    if (!m) break;
    if (basename(m[2]) === 'claude') return pid;
    pid = Number(m[1]);
  }
  return process.ppid;
}
