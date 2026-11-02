import { L } from './config.mjs';

function threadLines(lines, threads, owner = null) {
  for (const t of threads) {
    const title = t.title ?? L('fő szál', 'main thread');
    lines.push(owner ? `#${t.id} ${title} · ${owner}` : `#${t.id} ${title}`);
    for (const it of t.items) {
      const tags = [];
      if (it.kind === 'manual') tags.push(it.assignee ? `[${L('kézi', 'manual')}: ${it.assignee}]` : `[${L('kézi', 'manual')}]`);
      if (it.kind === 'idea') tags.push(`[${L('ötlet', 'idea')}]`);
      if (it.status === 'in_progress') tags.push(`[${L('folyamatban', 'in progress')}]`);
      if (it.due_date) tags.push(`[${L('határidő', 'deadline')}: ${it.due_date}]`);
      // származás: a munkatárstól kapottnál becenév és a forrástétel, különben a forrásprojekt
      const o = it.origin;
      if (o?.nickname) tags.push(o.item_id ? `[← ${o.nickname}: #${o.item_id}]` : `[← ${o.nickname}]`);
      else if (o?.project) tags.push(o.item_id ? `[← ${o.project} #${o.item_id}]` : `[← ${o.project}]`);
      lines.push(`  #${it.id} ${it.text}${tags.length ? ' ' + tags.join(' ') : ''}`);
    }
  }
}

// A projekt nyitott tételei szálanként, olvasható szövegként (a /projects/:slug/items?cowork=1 válaszából; a régi
// szerver tömböt ad). A munkatársak szálai külön blokkban, a becenévvel.
export function formatItems(data) {
  const threads = Array.isArray(data) ? data : data.threads ?? [];
  const cowork = Array.isArray(data) ? [] : data.cowork ?? [];
  if (!threads.length && !cowork.length) return L('Nincs nyitott tétel.', 'No open items.');
  const lines = [];
  threadLines(lines, threads);
  for (const c of cowork) {
    if (lines.length) lines.push('');
    threadLines(lines, c.threads, c.nickname);
  }
  return lines.join('\n');
}
