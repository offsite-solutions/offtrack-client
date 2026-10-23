// Visszatöltés: a Claude Code beszélgetések beolvasása és tömörítése. A nyers szöveg nem hagyja el a gépet.
import { L } from '../config.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';

function entries(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* félig írt vagy hibás sor */ }
  }
  return out;
}

const isPrompt = (e) => e.type === 'user' && typeof e.message?.content === 'string';
const answerText = (e) => (e.type === 'assistant' && Array.isArray(e.message?.content)
  ? e.message.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n').trim() : '');

export function listSessions({ root = join(homedir(), '.claude', 'projects'), days = 60, now = new Date() } = {}) {
  const since = now.getTime() - days * 86400000;
  const out = [];
  let dirs = [];
  try { dirs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return out; }
  for (const d of dirs) {
    for (const f of readdirSync(join(root, d.name)).filter((x) => x.endsWith('.jsonl'))) {
      const file = join(root, d.name, f);
      if (statSync(file).mtimeMs < since) continue;
      const es = entries(file);
      const first = es.find((e) => e.cwd);
      if (!first) continue;
      const times = es.map((e) => e.timestamp).filter(Boolean).sort();
      out.push({ file, sessionId: first.sessionId ?? basename(f, '.jsonl'), cwd: first.cwd, start: times[0], end: times[times.length - 1],
        prompts: es.filter(isPrompt).length });
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

const stamp = (iso) => (iso ? `[${iso.slice(0, 10)} ${iso.slice(11, 16)}]` : '[?]');

// Csak a felhasználói promptok és a Claude szöveges válaszai; a limit fölött az eleje (60%) és a vége (40%) marad.
export function condense(file, { limit = 12000 } = {}) {
  const lines = [];
  for (const e of entries(file)) {
    if (isPrompt(e)) lines.push(`${stamp(e.timestamp)} ${L('Felhasználó', 'User')}: ${e.message.content.trim()}`);
    else {
      const a = answerText(e);
      if (a) lines.push(`${stamp(e.timestamp)} Claude: ${a}`);
    }
  }
  const text = lines.join('\n');
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.6);
  const tail = limit - head;
  return `${text.slice(0, head)}\n[… kihagyva …]\n${text.slice(-tail)}`;
}

// Projektenként: a hívó projektjeinek leghosszabb illeszkedő gyökere szerint, különben a cwd utolsó tagja.
export function groupByProject(sessions, projects) {
  const roots = projects.flatMap((p) => p.paths.map((path) => ({ name: p.name, path: path.replace(/\/+$/, '') })))
    .sort((a, b) => b.path.length - a.path.length);
  const groups = new Map();
  for (const s of sessions) {
    const cwd = s.cwd.replace(/\/+$/, '');
    const hit = roots.find((r) => cwd === r.path || cwd.startsWith(`${r.path}/`));
    const name = hit ? hit.name : basename(cwd);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(s);
  }
  return groups;
}
