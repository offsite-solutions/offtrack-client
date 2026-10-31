#!/usr/bin/env node
// offtrack hook: minden Claude Code hook-eseményt a szervernek küld.
// Mindig 0-val lép ki, és soha nem blokkol, ha a szerver nem érhető el.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { send, enqueue, flushQueue } from './lib/api.mjs';
import { pidFile, contextFile, L, UPDATE_COMMAND } from './lib/config.mjs';
import { claudePid } from './lib/proc.mjs';
import { endsWithList } from './lib/transcript.mjs';
import { gitReport } from './lib/git.mjs';

const OFFLINE = () => L('[offtrack] A szerver nem érhető el, ez az utolsó ismert állapot; a jelentések helyben sorba kerülnek.', '[offtrack] The server is unreachable; this is the last known state. Reports are queued locally.');
const EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']);

function readText(file) {
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

async function main() {
  if (process.env.OFFTRACK_DISABLE === '1') return; // például a visszatöltés claude -p hívásaiban
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const event = input.hook_event_name;
  if (!EVENTS.has(event) || !input.session_id || !input.cwd) return;
  const pid = claudePid();

  const body = {
    event, session_id: input.session_id, cwd: input.cwd, claude_pid: pid,
    client: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
  };
  if (input.source) body.source = input.source;
  if (event === 'SessionStart') body.git = await gitReport(input.cwd);
  if (event === 'Stop') {
    body.stop_hook_active = input.stop_hook_active === true;
    body.has_open_list = endsWithList(input.transcript_path);
  }
  for (const k of Object.keys(body)) if (body[k] === null) delete body[k];

  if (event === 'SessionStart') writeFileSync(pidFile(pid), input.session_id, { mode: 0o600 });
  if (event === 'SessionEnd' && readText(pidFile(pid)) === input.session_id) unlinkSync(pidFile(pid));

  // A sorban állók előbb mennek; ha a sor nem ürült ki, az új esemény is a sorba kerül, hogy a sorrend megmaradjon.
  const drained = await flushQueue({ timeoutMs: 1500, budgetMs: 1000 });
  const res = drained ? await send('/api/v1/events', { body, timeoutMs: 1500 }) : { ok: false };
  if (!res.ok && event !== 'Stop') enqueue('/api/v1/events', body);

  if (event === 'SessionStart') {
    let context;
    if (res.ok && typeof res.data?.context === 'string') {
      context = res.data.context;
      writeFileSync(contextFile(input.cwd), context, { mode: 0o600 });
    } else {
      const cached = readText(contextFile(input.cwd));
      context = cached ? `${OFFLINE()}\n${cached}` : OFFLINE();
    }
    // ha van újabb kliens, a felhasználónak is szólunk (a systemMessage a terminálban látszik, nem a modellnek szól)
    const u = res.ok ? res.data?.update : null;
    const notice = u?.latest ? L(`[offtrack] Új kliensverzió: ${u.latest} (ezen a gépen: ${u.current ?? 'régebbi'}). Frissítés: ${UPDATE_COMMAND}`,
      `[offtrack] New client version: ${u.latest} (this machine: ${u.current ?? 'older'}). Update: ${UPDATE_COMMAND}`) : null;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context }, ...(notice ? { systemMessage: notice } : {}) }));
  } else if (event === 'Stop' && res.ok && res.data?.block === true) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason: res.data.reason }));
  }
}

try {
  await main();
} catch {
  // fail-open: csendes kilépés
}
// exitCode, nem exit(): macOS-en a pipe-ra írás aszinkron (docs/spike-results.md).
process.exitCode = 0;
