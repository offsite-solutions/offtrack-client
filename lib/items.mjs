import { L } from './config.mjs';

// A projekt nyitott tételei szálanként, olvasható szövegként (a /projects/:slug/items válaszából).
export function formatItems(threads) {
  if (!threads.length) return L('Nincs nyitott tétel.', 'No open items.');
  const lines = [];
  for (const t of threads) {
    lines.push(`#${t.id} ${t.title}`);
    for (const it of t.items) {
      const tags = [];
      if (it.kind === 'manual') tags.push(it.assignee ? `[${L('kézi', 'manual')}: ${it.assignee}]` : `[${L('kézi', 'manual')}]`);
      if (it.kind === 'idea') tags.push(`[${L('ötlet', 'idea')}]`);
      if (it.status === 'in_progress') tags.push(`[${L('folyamatban', 'in progress')}]`);
      if (it.due_date) tags.push(`[${L('határidő', 'deadline')}: ${it.due_date}]`);
      lines.push(`  #${it.id} ${it.text}${tags.length ? ' ' + tags.join(' ') : ''}`);
    }
  }
  return lines.join('\n');
}
