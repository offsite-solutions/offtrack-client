import { L } from './config.mjs';

// Soronként egy becenév; project-szintű együttműködésnél zárójelben a szint.
export function formatCoworkers(list) {
  if (!list.length) return L('Ezen a repón más, becenévvel rendelkező felhasználó nem dolgozik.', 'Nobody else with a nickname works on this repo.');
  return list.map((c) => (c.level === 'project' ? `${c.nickname} (project)` : c.nickname)).join('\n');
}

export const NO_REPO = L(
  'A könyvtár nem git-repó távoli címmel (vagy a szerver sója nem elérhető), így nem állapítható meg, kik dolgoznak rajta.',
  'The directory is not a git repo with a remote (or the server salt is unavailable), so co-workers cannot be determined.',
);

const LEVEL = { task: L('feladatszint', 'task level'), project: L('projektszint', 'project level') };
export const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

// Az offtrack cowork list kimenete: együttműködések (becenév, szint, saját projekt) és függő felkérések.
export function formatCoworks({ coworks = [], incoming = [], outgoing = [] }) {
  const lines = coworks.map((c) => `${c.nickname}  ${LEVEL[c.level] ?? c.level}  ${L('saját projekt', 'own project')}: ${c.project ?? '-'}`);
  for (const r of incoming) {
    lines.push(L(`Bejövő felkérés: ${r.nickname} (${LEVEL[r.level]})${r.project ? `, javasolt saját projekt: ${r.project}` : ''}. Elfogadás: offtrack cowork accept ${r.nickname}${r.project ? '' : ' --project <saját projekt>'}`,
      `Incoming request: ${r.nickname} (${LEVEL[r.level]})${r.project ? `, suggested own project: ${r.project}` : ''}. Accept: offtrack cowork accept ${r.nickname}${r.project ? '' : ' --project <own project>'}`));
  }
  for (const r of outgoing) lines.push(L(`Kimenő felkérés: ${r.nickname} (${LEVEL[r.level]}), saját projekt: ${r.project}`, `Outgoing request: ${r.nickname} (${LEVEL[r.level]}), own project: ${r.project}`));
  return lines.length ? lines.join('\n') : L('Nincs együttműködésed és függő felkérésed.', 'You have no coworks and no pending requests.');
}

// Egy elem a becenév (és ha megadták, a saját projekt) szerint; több találatnál hiba a saját projektek felsorolásával.
function pick(list, nickname, project, none) {
  let found = list.filter((x) => same(x.nickname, nickname));
  if (project) found = found.filter((x) => same(x.project, project));
  if (found.length === 1) return { found: found[0] };
  if (!found.length) return { error: none };
  const names = found.map((x) => x.project ?? '-').join(', ');
  return { error: L(`${nickname} becenévhez több pár tartozik (saját projekt: ${names}); add meg: --project <saját projekt>.`,
    `${nickname} has several pairs with you (own project: ${names}); give --project <own project>.`) };
}

export const pickCowork = (coworks, nickname, project) =>
  pick(coworks, nickname, project, L(`Nincs ilyen együttműködésed: ${nickname}${project ? ` (${project})` : ''}`, `No such cowork: ${nickname}${project ? ` (${project})` : ''}`));

// A bejövő felkérés becenév szerint; a project itt az elfogadó saját projektje, csak többértelműségnél szűr.
export function pickRequest(incoming, nickname, project) {
  const none = L(`Nincs függő felkérésed tőle: ${nickname}`, `No pending request from: ${nickname}`);
  const r = pick(incoming, nickname, null, none);
  return r.error && project && incoming.some((x) => same(x.nickname, nickname)) ? pick(incoming, nickname, project, r.error) : r;
}
