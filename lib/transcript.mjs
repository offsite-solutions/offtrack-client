import { readFileSync } from 'node:fs';

const LIST = /^\s*([-*•]|\d+[.)])\s+\S/;

function entries(path) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* félig írt vagy hibás sor */ }
  }
  return out;
}

const textOf = (e) => (Array.isArray(e?.message?.content)
  ? e.message.content.filter((c) => c?.type === 'text').map((c) => c.text).join('\n') : '');

// Igaz, ha a legutóbbi felhasználói prompt utáni utolsó szöveges válasz legalább kételemű felsorolással zárul.
export function endsWithList(path) {
  const all = entries(path);
  let start = -1;
  all.forEach((e, i) => { if (e.type === 'user' && typeof e.message?.content === 'string') start = i; });
  const answer = all.slice(start + 1).filter((e) => e.type === 'assistant' && textOf(e).trim()).at(-1);
  if (!answer) return false;
  const lines = textOf(answer).replace(/\s+$/, '').split('\n');
  let items = 0;
  let questions = 0;
  let intro = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (LIST.test(l)) { items++; if (l.trim().endsWith('?')) questions++; }
    else if (l.trim() === '' || /^\s{2,}\S/.test(l)) continue;
    else { intro = l.trim(); break; }
  }
  // Teendőlista: legalább 3 elem, nem kérdés vezeti be (választási lehetőségek), és az elemek nem kérdések.
  return items >= 3 && !intro.endsWith('?') && questions * 2 < items;
}
