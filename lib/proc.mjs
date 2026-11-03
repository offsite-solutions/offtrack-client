import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { IS_WIN } from './platform.mjs';

// A szülőlánc első `claude` folyamata. Ha nincs ilyen (például tesztben), a közvetlen szülő.
// A lookup(pid) a folyamat szülőjét és nevét adja ({ ppid, name }), vagy null-t, ha nem ismert.
export function findClaude(start, lookup) {
  let pid = start;
  for (let i = 0; pid > 1 && i < 30; i++) {
    const p = lookup(pid);
    if (!p) break;
    if (basename(p.name) === 'claude') return pid;
    pid = p.ppid;
  }
  return start;
}

function psLookup(pid) {
  let line;
  try {
    line = execFileSync('ps', ['-o', 'ppid=,comm=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
  const m = line.match(/^(\d+)\s+(.*)$/);
  return m ? { ppid: Number(m[1]), name: m[2] } : null;
}

// A PowerShell `pid ppid név` sorai folyamatonként; a név .exe nélkül, kisbetűvel, hogy a claude.exe is `claude` legyen.
export function parseWinProcs(text) {
  const procs = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), name: m[3].replace(/\.exe$/i, '').toLowerCase() });
  }
  return procs;
}

// Windowson nincs ps: egyetlen PowerShell-hívás adja a teljes folyamattáblát (lassú, ezért a hook csak ritkán kéri).
function winLookup() {
  let text = '';
  try {
    text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }'],
    { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { /* nincs PowerShell vagy lejárt: marad a közvetlen szülő */ }
  const procs = parseWinProcs(text);
  return (pid) => procs.get(pid) ?? null;
}

export function claudePid() {
  return findClaude(process.ppid, IS_WIN ? winLookup() : psLookup);
}
