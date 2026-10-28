#!/usr/bin/env node
// offtrack parancssor.
import { writeFileSync, chmodSync, readFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { send, flushQueue, queueLength } from '../lib/api.mjs';
import { home, L, lang } from '../lib/config.mjs';
import { currentSession } from '../lib/session.mjs';
import { claudePid } from '../lib/proc.mjs';
import { formatItems } from '../lib/items.mjs';
import { listSessions, condense, groupByProject } from '../lib/backfill/sessions.mjs';
import { summarize } from '../lib/backfill/summarize.mjs';
import { writeProposal, parseProposal, slug } from '../lib/backfill/proposal.mjs';

const HELP_HU = `Használat:
  offtrack install [--lang hu|en]              hookok, MCP szerver, skill és CLAUDE.md-szabályok telepítése
  offtrack uninstall                           mindezek eltávolítása
  offtrack whoami                              melyik felhasználóként jelent ez a gép
  offtrack login                               a kliens-token beállítása ezen a gépen (a tokent a bemenetről olvassa)
  offtrack projects                            a projektjeim, a gyökérkönyvtáraim és a tagok
  offtrack list [<projekt>]                    a projekt nyitott tételei szálanként (projekt nélkül a hívó sessioné)
  offtrack attach <projekt> [--new]            a hívó Claude Code session csatolása egy projekthez (--new: új projekt)
  offtrack merge <honnan> <hova>               egy projekt beolvasztása egy másikba (mindkettő tulajdonosaként)
  offtrack root <projekt> <könyvtár>          gyökérkönyvtár (az alkönyvtárakkal); a projekt létrejön, ha nincs
  offtrack rename <projekt> <megjelenített név> megjelenített név (például GreenGo); üres névvel törlődik
  offtrack share <projekt> <email>             projekt megosztása (tulajdonosként)
  offtrack unshare <projekt> <email>           tag eltávolítása (tulajdonosként)
  offtrack transfer <projekt> <email>          a tulajdonjog átadása egy tagnak
  offtrack publish <tétel-id>                  saját ötlet publikálása a projekt tagjainak
  offtrack flush                               a sorban álló jelentések elküldése
  offtrack mobile url | revoke                 a mobil Claude connector titkos URL-je (új URL), illetve visszavonása
  offtrack backfill [--days 60] [--project <név>] [--dry]
                                               javaslatfájlok a régi sessionökből (~/offtrack-backfill/)
  offtrack import <fájl…>                      javaslatfájl felküldése
Adminisztráció:
  offtrack admin users
  offtrack admin user add <email> <név>
  offtrack admin user disable <email> [--transfer-to <email>]
  offtrack admin token <email> [címke]
  offtrack admin token revoke <email>
  offtrack admin allow list | add <domain, cím vagy '*' (bárki)> | remove <domain, cím vagy '*'>`;

const HELP_EN = `Usage:
  offtrack install [--lang hu|en]              install the hooks, MCP server, skill and CLAUDE.md rules
  offtrack uninstall                           remove all of these
  offtrack whoami                              who am I (by the token)
  offtrack login                               set the client token on this machine (read from standard input)
  offtrack projects                            my projects, my root directories and the members
  offtrack list [<project>]                    the project's open items by thread (without project, the calling session's)
  offtrack attach <project> [--new]            attach the calling Claude Code session to a project (--new: new project)
  offtrack merge <from> <into>                 merge a project into another (as owner of both)
  offtrack root <project> <directory>          root directory (with its subdirectories); creates the project if missing
  offtrack rename <project> <display name>     friendly name (for example GreenGo); empty name removes it
  offtrack share <project> <email>             share a project (as owner)
  offtrack unshare <project> <email>           remove a member (as owner)
  offtrack transfer <project> <email>          hand ownership to a member
  offtrack publish <item-id>                   publish your own idea to the project members
  offtrack flush                               send the offline queue
  offtrack mobile url | revoke                 the secret URL of the mobile Claude connector (new URL), or revoke it
  offtrack backfill [--days 60] [--project <name>] [--dry]
                                               proposal files from old sessions (~/offtrack-backfill/)
  offtrack import <file…>                      upload a proposal file
Administration:
  offtrack admin users
  offtrack admin user add <email> <name>
  offtrack admin user disable <email> [--transfer-to <email>]
  offtrack admin token <email> [label]
  offtrack admin token revoke <email>
  offtrack admin allow list | add <domain, address or '*' (anyone)> | remove <domain, address or '*'>`;
const help = () => L(HELP_HU, HELP_EN);

const enc = encodeURIComponent;
const req = (path, opts = {}) => send(path, { timeoutMs: 5000, force: true, ...opts });
const get = (path) => req(path, { method: 'GET' });
const errorOf = (r) => (r.status ? `${r.data?.error ?? `HTTP ${r.status}`}` : L('a szerver nem érhető el', 'the server is unreachable'));

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; if (data.includes('\n')) { process.stdin.pause(); resolve(data); } });
    process.stdin.on('end', () => resolve(data));
  });
}

function fail(msg) {
  console.error(`${L('Hiba', 'Error')}: ${msg}`);
  return 1;
}

// Sikeres válasznál a print fut, különben hibaüzenet és 1-es kód.
async function call(promise, print) {
  const r = await promise;
  if (!r.ok) return fail(errorOf(r));
  print(r.data);
  return 0;
}

async function admin([sub, ...args]) {
  if (sub === 'users' && args.length === 0) {
    return call(get('/api/v1/admin/users'), (d) => d.forEach((u) => console.log(`${u.email}  ${u.name}  ${u.status}${u.is_admin ? '  admin' : ''}`)));
  }
  if (sub === 'user' && args[0] === 'add' && args.length >= 3) {
    return call(req('/api/v1/admin/users', { body: { email: args[1], name: args.slice(2).join(' ') } }), (u) => console.log(`${L('Felvéve', 'Added')}: ${u.email} (${u.name})`));
  }
  if (sub === 'user' && args[0] === 'disable' && (args.length === 2 || (args.length === 4 && args[2] === '--transfer-to'))) {
    const body = args[3] ? { transfer_to: args[3] } : {};
    return call(req(`/api/v1/admin/users/${enc(args[1])}/disable`, { body }), () => console.log(`${L('Letiltva', 'Disabled')}: ${args[1]}`));
  }
  if (sub === 'token' && args[0] === 'revoke' && args.length === 2) {
    return call(req(`/api/v1/admin/users/${enc(args[1])}/tokens`, { method: 'DELETE' }), (d) => console.log(L(`Visszavonva: ${d.revoked} token`, `Revoked: ${d.revoked} token(s)`)));
  }
  if (sub === 'token' && args.length >= 1 && args.length <= 2) {
    return call(req(`/api/v1/admin/users/${enc(args[0])}/tokens`, { body: args[1] ? { label: args[1] } : {} }), (d) => {
      console.log(d.token);
      console.log(L('Figyelem: a token csak most látható. Add át biztonságosan; a címzett az offtrack login paranccsal állítja be (a bemenetről olvassa).',
        'Note: the token is shown only now. Hand it over securely; the recipient sets it with offtrack login (it reads standard input).'));
    });
  }
  if (sub === 'allow' && args[0] === 'list' && args.length === 1) {
    return call(get('/api/v1/admin/allow'), (d) => d.forEach((a) => console.log(`${a.kind}  ${a.value}`)));
  }
  if (sub === 'allow' && args[0] === 'add' && args.length === 2) {
    return call(req('/api/v1/admin/allow', { body: { value: args[1] } }), (a) => console.log(`${L('Engedélyezve', 'Allowed')} (${a.kind}): ${a.value}`));
  }
  if (sub === 'allow' && args[0] === 'remove' && args.length === 2) {
    return call(req(`/api/v1/admin/allow/${enc(args[1])}`, { method: 'DELETE' }), (d) => console.log(d.ok ? `${L('Törölve', 'Removed')}: ${args[1]}` : `${L('Nem volt a listán', 'Was not on the list')}: ${args[1]}`));
  }
  console.error(help());
  return 2;
}

const PROJECT_BUDGET = 60000;

// Projektenként a legfrissebb sessionök, amíg a tömörített szöveg belefér a keretbe; időrendben.
function prepare(list) {
  const picked = [];
  let total = 0;
  for (const s of [...list].reverse()) {
    const text = condense(s.file);
    if (picked.length && total + text.length > PROJECT_BUDGET) break;
    picked.unshift({ ...s, text });
    total += text.length;
  }
  return { picked, total, omitted: list.length - picked.length };
}

function freeName(dir, base) {
  for (let i = 1; ; i++) {
    const file = join(dir, `${base}${i === 1 ? '' : `-${i}`}.md`);
    if (!existsSync(file) && !existsSync(`${file}.imported`)) return file;
  }
}

async function backfill(args) {
  const opt = { days: 60, project: null, dry: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry') opt.dry = true;
    else if (args[i] === '--days' && /^\d+$/.test(args[i + 1] ?? '')) opt.days = Number(args[++i]);
    else if (args[i] === '--project' && args[i + 1]) opt.project = args[++i];
    else { console.error(help()); return 2; }
  }
  const pr = await get('/api/v1/projects');
  const projects = pr.ok && Array.isArray(pr.data) ? pr.data : [];
  if (!pr.ok) console.error(L(`Figyelem: a projektlista nem érhető el (${errorOf(pr)}); a könyvtárnév lesz a projekt neve.`,
    `Note: the project list is unavailable (${errorOf(pr)}); the directory name becomes the project name.`));
  const sessions = listSessions({ days: opt.days }).filter((s) => s.prompts >= 2);
  let groups = [...groupByProject(sessions, projects)];
  if (opt.project) {
    const want = opt.project.toLowerCase();
    const canon = projects.find((p) => p.name.toLowerCase() === want || p.display_name?.toLowerCase() === want)?.name.toLowerCase() ?? want;
    groups = groups.filter(([name]) => name.toLowerCase() === canon);
  }
  if (!groups.length) { console.log(L('Nincs feldolgozható session.', 'No sessions to process.')); return 0; }
  if (opt.dry) {
    let n = 0;
    for (const [name, list] of groups) {
      const { picked, total, omitted } = prepare(list);
      console.log(L(`${name}: ${picked.length} session, ${total} karakter${omitted ? ` (${omitted} régebbi kimarad)` : ''}`,
        `${name}: ${picked.length} session(s), ${total} characters${omitted ? ` (${omitted} older skipped)` : ''}`));
      n++;
    }
    console.log(L(`Összesen ${n} claude -p hívás kellene.`, `This would take ${n} claude -p call(s) in total.`));
    return 0;
  }
  const dir = join(homedir(), 'offtrack-backfill');
  mkdirSync(dir, { recursive: true });
  const written = [];
  let code = 0;
  for (const [name, list] of groups) {
    const { picked, omitted } = prepare(list);
    process.stderr.write(L(`${name}: ${picked.length} session összefoglalása…\n`, `${name}: summarising ${picked.length} session(s)…\n`));
    try {
      const { threads } = await summarize(name, picked.map((s) => s.text), { lang: lang() });
      const file = freeName(dir, slug(name));
      const root = projects.find((p) => p.name === name)?.paths?.[0];
      writeFileSync(file, writeProposal({ lang: lang(), project: name, cwd: root ?? picked[picked.length - 1].cwd, sessions: picked.length,
        from: (picked[0].start ?? '').slice(0, 10), threads, omitted, file: file.replace(homedir(), '~') }));
      written.push(file);
    } catch (e) {
      console.error(`${L('Hiba', 'Error')} (${name}): ${e.message}`);
      code = 1;
    }
  }
  if (written.length) {
    console.log(`${L('Elkészült', 'Done')}:\n${written.map((f) => `  ${f}`).join('\n')}`);
    console.log(L('Következő lépés: nézd át és szerkeszd a fájlokat, majd: offtrack import <fájl…>', 'Next: review and edit the files, then: offtrack import <file…>'));
  }
  return code;
}

async function importFiles(files) {
  let code = 0;
  for (const file of files) {
    let p;
    try { p = parseProposal(readFileSync(file, 'utf8')); } catch (e) { console.error(`${L('Hiba', 'Error')} (${file}): ${e.message}`); code = 1; continue; }
    for (const w of p.warnings) console.error(`${file}: ${w}`);
    const r = await send('/api/v1/import', { timeoutMs: 60000, force: true, body: { project: p.project, ...(p.cwd ? { cwd: p.cwd } : {}), threads: p.threads } });
    if (!r.ok) { console.error(`${L('Hiba', 'Error')} (${file}): ${errorOf(r)}`); code = 1; continue; }
    renameSync(file, `${file}.imported`);
    console.log(L(`${r.data.project}: ${r.data.created} új, ${r.data.skipped} kihagyva`, `${r.data.project}: ${r.data.created} new, ${r.data.skipped} skipped`));
  }
  return code;
}

async function main([cmd, ...args]) {
  if (cmd === 'install' || cmd === 'uninstall') return (await import('../install.mjs')).main([cmd, ...args]);
  if (cmd === 'whoami' && args.length === 0) {
    return call(get('/api/v1/me'), (u) => console.log(`${u.name} <${u.email}>${u.is_admin ? ' (admin)' : ''}`));
  }
  if (cmd === 'login' && args.length === 0) {
    // A token a bemenetről jön (nem parancssori paraméter), így nem kerül a shell-előzményekbe és a folyamatlistába.
    if (process.stdin.isTTY) process.stderr.write('Token: ');
    const token = (await readStdin()).trim();
    if (!token) return fail(L('Nincs token a bemeneten.', 'No token on standard input.'));
    const r = await req('/api/v1/me', { method: 'GET', token });
    if (!r.ok) return fail(L(`a token nem érvényes (${errorOf(r)}); a régi beállítás maradt.`, `the token is not valid (${errorOf(r)}); the previous setting is kept.`));
    const file = join(home(), 'client-token');
    writeFileSync(file, token + '\n', { mode: 0o600 });
    chmodSync(file, 0o600);
    console.log(`${L('Bejelentkezve', 'Signed in')}: ${r.data.name} <${r.data.email}>`);
    return 0;
  }
  if (cmd === 'projects' && args.length === 0) {
    return call(get('/api/v1/projects'), (list) => {
      for (const p of list) {
        const role = p.role === 'owner' ? L('[tulajdonos]', '[owner]') : p.role === 'member' ? L('[tag]', '[member]') : '';
        const members = (p.members ?? []).length > 1 ? `  (${L('tagok', 'members')}: ${p.members.join(', ')})` : '';
        const label = p.display_name ? `${p.display_name} (${p.name})` : p.name;
        console.log(`${label}  ${role}  ${(p.paths ?? []).join(', ')}${members}`.replace(/ {3,}/g, '  '));
      }
    });
  }
  if (cmd === 'list' && args.length <= 1) {
    let slug = args[0];
    if (!slug) {
      const s = await get(`/api/v1/sessions/by-pid/${claudePid()}`);
      if (s.status === 404) return fail(L('Nem találom a sessiont: add meg a projektet (offtrack list <projekt>).', 'Cannot find the session: name the project (offtrack list <project>).'));
      if (!s.ok) return fail(errorOf(s));
      slug = s.data.project.slug;
    }
    return call(get(`/api/v1/projects/${enc(slug)}/items`), (d) => console.log(formatItems(d)));
  }
  if (cmd === 'merge' && args.length === 2) {
    const [from, into] = args;
    const r = await req('/api/v1/projects/merge', { body: { from, into } });
    if (!r.ok) return fail(errorOf(r));
    const list = await get('/api/v1/projects');
    const paths = list.ok && Array.isArray(list.data) ? (list.data.find((p) => p.slug === r.data.slug)?.paths ?? []).join(', ') : '';
    console.log(L(`Beolvasztva: ${from} → ${r.data.name}.${paths ? ` A(z) ${paths} alatti sessionök mostantól ide jelentenek.` : ''}`,
      `Merged: ${from} → ${r.data.name}.${paths ? ` Sessions under ${paths} now report here.` : ''}`));
    return 0;
  }
  if (cmd === 'attach' && (args.length === 1 || (args.length === 2 && args[1] === '--new'))) {
    const session = currentSession();
    if (!session) return fail(L('Nem találom a sessiont: ezt a parancsot egy Claude Code sessionből futtasd.', 'Cannot find the session: run this command from a Claude Code session.'));
    return call(req(`/api/v1/sessions/${enc(session)}/attach`, { body: { project: args[0], create: args[1] === '--new' } }),
      (p) => console.log(`${L('Csatolva', 'Attached')}: ${process.cwd()} → ${p.name}.`));
  }
  if (cmd === 'root' && args.length === 2) {
    const path = args[1].startsWith('/') ? args[1] : join(process.cwd(), args[1]);
    return call(req('/api/v1/projects/roots', { body: { project: args[0], path } }), (p) => console.log(`${L('Gyökér', 'Root')}: ${path} → ${p.display_name || p.name}`));
  }
  if (cmd === 'rename' && args.length >= 1) {
    const name = args.slice(1).join(' ');
    return call(req(`/api/v1/projects/${enc(args[0])}`, { method: 'PATCH', body: { display_name: name } }),
      (p) => console.log(p.display_name ? `${L('Megjelenített név', 'Display name')}: ${p.display_name}` : `${L('A megjelenített név törölve', 'Display name removed')}: ${p.name}`));
  }
  if (cmd === 'share' && args.length === 2) {
    return call(req(`/api/v1/projects/${enc(args[0])}/members`, { body: { email: args[1] } }),
      (m) => console.log(`${L('Megosztva. Tagok', 'Shared. Members')}: ${m.map((x) => x.email).join(', ')}`));
  }
  if (cmd === 'unshare' && args.length === 2) {
    return call(req(`/api/v1/projects/${enc(args[0])}/members/${enc(args[1])}`, { method: 'DELETE' }),
      (m) => console.log(`${L('Eltávolítva. Tagok', 'Removed. Members')}: ${m.map((x) => x.email).join(', ')}`));
  }
  if (cmd === 'transfer' && args.length === 2) {
    return call(req(`/api/v1/projects/${enc(args[0])}/owner`, { body: { email: args[1] } }), () => console.log(`${L('Átadva', 'Transferred')}: ${args[0]} → ${args[1]}`));
  }
  if (cmd === 'publish' && args.length === 1 && /^\d+$/.test(args[0])) {
    return call(req(`/api/v1/items/${args[0]}/publish`), (it) => console.log(`${L('Publikálva', 'Published')}: #${it.id}`));
  }
  if (cmd === 'flush' && args.length === 0) {
    await flushQueue({ timeoutMs: 5000, budgetMs: 10 * 60 * 1000, max: 10000, force: true });
    console.log(`${L('A sorban maradt', 'Left in the queue')}: ${queueLength()}`);
    return 0;
  }
  if (cmd === 'mobile' && args.length === 1 && args[0] === 'url') {
    return call(req('/api/v1/me/mobile', { body: {} }), ({ url }) => console.log(L(`A mobil connector URL-je (jelszóként kezeld, ne oszd meg):

  ${url}

Felvétel: claude.ai → Beállítások → Connectorok → Egyedi connector hozzáadása; név: offtrack, URL: a fenti.
Utána a Claude appban (mobil, desktop, web): „track <projekt> <teendő>”.
Az új URL a korábbit érvényteleníti; visszavonás: offtrack mobile revoke`, `The mobile connector URL (treat it like a password, don't share it):

  ${url}

Add it: claude.ai → Settings → Connectors → Add custom connector; name: offtrack, URL: the one above.
Then in the Claude app (mobile, desktop, web): “track <project> <task>”.
A new URL invalidates the previous one; revoke with: offtrack mobile revoke`)));
  }
  if (cmd === 'mobile' && args.length === 1 && args[0] === 'revoke') {
    return call(req('/api/v1/me/mobile', { method: 'DELETE' }), ({ revoked }) => console.log(L(`Visszavonva: ${revoked} connector-URL.`, `Revoked: ${revoked} connector URL(s).`)));
  }
  if (cmd === 'backfill') return backfill(args);
  if (cmd === 'import' && args.length >= 1) return importFiles(args);
  if (cmd === 'admin') return admin(args);
  console.error(help());
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
