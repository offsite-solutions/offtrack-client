// A javaslatfájl: a felhasználó PhpStormban szerkeszti, az `offtrack import` olvassa vissza.
import { L } from '../config.mjs';

// A fájl a választott nyelven íródik; a beolvasó mindkét nyelv kulcsszavait elfogadja.
const KIND_WORD = { hu: { stop: 'megálló', branch: 'ág', manual: 'kézi', idea: 'ötlet' }, en: { stop: 'stop', branch: 'branch', manual: 'manual', idea: 'idea' } };
const WORD_KIND = Object.fromEntries(Object.values(KIND_WORD).flatMap((m) => Object.entries(m).map(([k, v]) => [v, k])));
const ITEM_RE = /^- (megálló|ág|kézi|ötlet|stop|branch|manual|idea) (\d{4}-\d{2}-\d{2}): (.+)$/;
const THREAD_RE = /^## (?:Szál|Thread):\s*(.+)$/;
const DEFAULT_TITLES = ['(alap)', '(default)'];
const TEXT = {
  hu: { title: 'offtrack-javaslat', edit: 'Szerkeszd szabadon: törölj sort, írd át a szöveget vagy a dátumot, mozgass tételt másik szál alá.',
    kinds: (path) => `Típusok: megálló, ág, kézi, ötlet. Felküldés: offtrack import ${path}`,
    omitted: (n) => `Figyelem: a méretkorlát miatt ${n} régebbi session kimaradt.`, thread: 'Szál', def: '(alap)' },
  en: { title: 'offtrack proposal', edit: 'Edit freely: delete lines, rewrite the text or the date, move items under another thread.',
    kinds: (path) => `Kinds: stop, branch, manual, idea. Upload: offtrack import ${path}`,
    omitted: (n) => `Note: ${n} older session(s) were left out because of the size limit.`, thread: 'Thread', def: '(default)' },
};
const HEAD_RE = /^<!-- offtrack-backfill (.*) -->$/;

export const slug = (name) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projekt';

const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const unattr = (v) => v.replace(/&quot;/g, '"').replace(/&amp;/g, '&');

const validDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

export function writeProposal({ project, cwd, sessions, from, threads, omitted = 0, file, lang = 'hu' }) {
  const x = TEXT[lang] ?? TEXT.hu;
  const words = KIND_WORD[lang] ?? KIND_WORD.hu;
  const path = file ?? `~/offtrack-backfill/${slug(project)}.md`;
  const lines = [
    `# ${x.title}: ${project}`,
    `<!-- offtrack-backfill project="${attr(project)}" cwd="${attr(cwd ?? '')}" sessions="${sessions}" from="${from}" -->`,
    x.edit,
    x.kinds(path),
  ];
  if (omitted) lines.push(x.omitted(omitted));
  for (const t of threads) {
    const items = [...(t.items ?? [])].filter((it) => words[it.kind]).sort((a, b) => a.date.localeCompare(b.date));
    if (!items.length) continue;
    lines.push('', `## ${x.thread}: ${t.title ?? x.def}`);
    for (const it of items) lines.push(`- ${words[it.kind]} ${it.date}: ${it.text.replace(/\s*\n\s*/g, ' ').trim()}`);
  }
  return lines.join('\n') + '\n';
}

export function parseProposal(text) {
  const lines = text.split(/\r?\n/);
  let head = null;
  const threads = [];
  const warnings = [];
  let cur = null;
  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const h = line.match(HEAD_RE);
    if (h && !head) {
      head = Object.fromEntries([...h[1].matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], unattr(m[2])]));
      return;
    }
    const t = line.match(THREAD_RE);
    if (t) {
      const title = DEFAULT_TITLES.includes(t[1].trim()) ? null : t[1].trim();
      cur = threads.find((x) => x.title === title);
      if (!cur) threads.push((cur = { title, items: [] }));
      return;
    }
    if (!line.startsWith('- ')) return;
    const m = line.match(ITEM_RE);
    if (!m || !validDate(m[2]) || !m[3].trim()) {
      warnings.push(L(`${i + 1}. sor: nem értelmezhető`, `line ${i + 1}: cannot be parsed`));
      return;
    }
    if (!cur) threads.push((cur = { title: null, items: [] }));
    cur.items.push({ kind: WORD_KIND[m[1]], text: m[3].trim(), date: m[2] });
  });
  if (!head?.project) throw new Error(L('A fájlnak nincs offtrack-backfill fejléce.', 'The file has no offtrack-backfill header.'));
  return { project: head.project, cwd: head.cwd || null, threads: threads.filter((t) => t.items.length), warnings };
}
