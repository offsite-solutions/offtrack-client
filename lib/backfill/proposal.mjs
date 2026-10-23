// A javaslatfájl: a felhasználó PhpStormban szerkeszti, az `offtrack import` olvassa vissza.

const KIND_HU = { stop: 'megálló', branch: 'ág', manual: 'kézi', idea: 'ötlet' };
const HU_KIND = Object.fromEntries(Object.entries(KIND_HU).map(([k, v]) => [v, k]));
const ITEM_RE = /^- (megálló|ág|kézi|ötlet) (\d{4}-\d{2}-\d{2}): (.+)$/;
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

export function writeProposal({ project, cwd, sessions, from, threads, omitted = 0, file }) {
  const path = file ?? `~/offtrack-backfill/${slug(project)}.md`;
  const lines = [
    `# offTrack-javaslat: ${project}`,
    `<!-- offtrack-backfill project="${attr(project)}" cwd="${attr(cwd ?? '')}" sessions="${sessions}" from="${from}" -->`,
    'Szerkeszd szabadon: törölj sort, írd át a szöveget vagy a dátumot, mozgass tételt másik szál alá.',
    `Típusok: megálló, ág, kézi, ötlet. Felküldés: offtrack import ${path}`,
  ];
  if (omitted) lines.push(`Figyelem: a méretkorlát miatt ${omitted} régebbi session kimaradt.`);
  for (const t of threads) {
    const items = [...(t.items ?? [])].filter((it) => KIND_HU[it.kind]).sort((a, b) => a.date.localeCompare(b.date));
    if (!items.length) continue;
    lines.push('', `## Szál: ${t.title ?? '(alap)'}`);
    for (const it of items) lines.push(`- ${KIND_HU[it.kind]} ${it.date}: ${it.text.replace(/\s*\n\s*/g, ' ').trim()}`);
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
    const t = line.match(/^## Szál:\s*(.+)$/);
    if (t) {
      const title = t[1].trim() === '(alap)' ? null : t[1].trim();
      cur = threads.find((x) => x.title === title);
      if (!cur) threads.push((cur = { title, items: [] }));
      return;
    }
    if (!line.startsWith('- ')) return;
    const m = line.match(ITEM_RE);
    if (!m || !validDate(m[2]) || !m[3].trim()) {
      warnings.push(`${i + 1}. sor: nem értelmezhető`);
      return;
    }
    if (!cur) threads.push((cur = { title: null, items: [] }));
    cur.items.push({ kind: HU_KIND[m[1]], text: m[3].trim(), date: m[2] });
  });
  if (!head?.project) throw new Error('A fájlnak nincs offtrack-backfill fejléce.');
  return { project: head.project, cwd: head.cwd || null, threads: threads.filter((t) => t.items.length), warnings };
}
