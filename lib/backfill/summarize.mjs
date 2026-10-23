// Projektenkénti összefoglalás egy `claude -p` hívással: a tömörített sessionökből szálak és tételek.
import { spawn } from 'node:child_process';

const TIMEOUT_MS = 10 * 60 * 1000;

export function buildPrompt(project, condensedSessions) {
  return `Az alábbi Claude Code beszélgetések a(z) „${project}” projekthez tartoznak, időrendben.
Készíts belőlük offtrack-összefoglalót. A válaszod csak JSON legyen, más szöveg nélkül, ebben az alakban:
{"threads":[{"title": string|null, "items":[{"kind":"stop|branch|manual|idea","text": string,"date":"ÉÉÉÉ-HH-NN"}]}]}

Szabályok:
- stop (megálló): lezárt, önálló lépés, ami elkészült.
- branch (ág): nyitva maradt teendő. Egy összefüggő javaslatlista egyetlen ág.
- manual (kézi): olyan teendő, amit a felhasználónak magának kell elvégeznie.
- idea (ötlet): a jövőre utaló felvetés.
- Ami egy későbbi beszélgetésben elkészült, az megálló, nem ág.
- A szöveg magyar, 1–3 mondat, eredményközpontú.
- A date az esemény napja a beszélgetés időbélyegei szerint.
- A szál címe null, ha nincs külön munkafolyam; különálló munkafolyamnak rövid címet adj.

Beszélgetések:

${condensedSessions.join('\n\n---\n\n')}
`;
}

function parseModel(text) {
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return v && Array.isArray(v.threads) ? v : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const m = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  return m ? tryParse(m[1]) : null;
}

export async function summarize(project, condensed, { run = spawnClaude } = {}) {
  const out = await run(buildPrompt(project, condensed));
  let result = out;
  try {
    const wrapper = JSON.parse(out);
    if (wrapper && typeof wrapper.result === 'string') result = wrapper.result;
  } catch { /* nem burkolt kimenet */ }
  const parsed = parseModel(result);
  if (!parsed) throw new Error(`A(z) ${project} összefoglalója nem értelmezhető.`);
  return parsed;
}

export function spawnClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json'], {
      env: { ...process.env, OFFTRACK_DISABLE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('A claude -p hívás túllépte a 10 perces időkorlátot.'));
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else {
        let why = err.trim();
        try { why = JSON.parse(out).result || why; } catch { /* nem JSON */ }
        reject(new Error(`A claude -p hívás hibával állt le (${code}): ${String(why).slice(0, 300)}`));
      }
    });
    child.stdin.end(prompt);
  });
}
