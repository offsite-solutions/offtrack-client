#!/usr/bin/env node
// offtrack parancssor.
import { writeFileSync, chmodSync, readFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { send, flushQueue, queueLength } from '../lib/api.mjs';
import { home } from '../lib/config.mjs';
import { currentSession } from '../lib/session.mjs';
import { listSessions, condense, groupByProject } from '../lib/backfill/sessions.mjs';
import { summarize } from '../lib/backfill/summarize.mjs';
import { writeProposal, parseProposal, slug } from '../lib/backfill/proposal.mjs';

const HELP = `Használat:
  offtrack whoami                              ki vagyok (a token alapján)
  offtrack login                               a kliens-token beállítása ezen a gépen (a tokent a bemenetről olvassa)
  offtrack projects                            a projektjeim, a gyökérkönyvtáraim és a tagok
  offtrack attach <projekt> [--new]            a hívó Claude Code session csatolása egy projekthez (--new: új projekt)
  offtrack merge <honnan> <hova>               egy projekt beolvasztása egy másikba (mindkettő gazdájaként)
  offtrack root <projekt> <könyvtár>          gyökérkönyvtár (az alkönyvtárakkal); a projekt létrejön, ha nincs
  offtrack rename <projekt> <megjelenített név> barátságos név (például GreenGo); üres névvel törlés
  offtrack share <projekt> <email>             projekt megosztása (gazdaként)
  offtrack unshare <projekt> <email>           tag eltávolítása (gazdaként)
  offtrack transfer <projekt> <email>          a gazdaság átadása egy tagnak
  offtrack publish <tétel-id>                  saját ötlet publikálása a projekt tagjainak
  offtrack flush                               az offline sor elküldése
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
  offtrack admin allow list | add <domain vagy cím> | remove <domain vagy cím>`;

const enc = encodeURIComponent;
const req = (path, opts = {}) => send(path, { timeoutMs: 5000, force: true, ...opts });
const get = (path) => req(path, { method: 'GET' });
const errorOf = (r) => (r.status ? `${r.data?.error ?? `HTTP ${r.status}`}` : 'a szerver nem érhető el');

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; if (data.includes('\n')) { process.stdin.pause(); resolve(data); } });
    process.stdin.on('end', () => resolve(data));
  });
}

function fail(msg) {
  console.error(`Hiba: ${msg}`);
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
    return call(req('/api/v1/admin/users', { body: { email: args[1], name: args.slice(2).join(' ') } }), (u) => console.log(`Felvéve: ${u.email} (${u.name})`));
  }
  if (sub === 'user' && args[0] === 'disable' && (args.length === 2 || (args.length === 4 && args[2] === '--transfer-to'))) {
    const body = args[3] ? { transfer_to: args[3] } : {};
    return call(req(`/api/v1/admin/users/${enc(args[1])}/disable`, { body }), () => console.log(`Letiltva: ${args[1]}`));
  }
  if (sub === 'token' && args[0] === 'revoke' && args.length === 2) {
    return call(req(`/api/v1/admin/users/${enc(args[1])}/tokens`, { method: 'DELETE' }), (d) => console.log(`Visszavonva: ${d.revoked} token`));
  }
  if (sub === 'token' && args.length >= 1 && args.length <= 2) {
    return call(req(`/api/v1/admin/users/${enc(args[0])}/tokens`, { body: args[1] ? { label: args[1] } : {} }), (d) => {
      console.log(d.token);
      console.log('Figyelem: a token csak most látható. Add át biztonságosan; a címzett így állítja be: offtrack login <token>');
    });
  }
  if (sub === 'allow' && args[0] === 'list' && args.length === 1) {
    return call(get('/api/v1/admin/allow'), (d) => d.forEach((a) => console.log(`${a.kind}  ${a.value}`)));
  }
  if (sub === 'allow' && args[0] === 'add' && args.length === 2) {
    return call(req('/api/v1/admin/allow', { body: { value: args[1] } }), (a) => console.log(`Engedélyezve (${a.kind}): ${a.value}`));
  }
  if (sub === 'allow' && args[0] === 'remove' && args.length === 2) {
    return call(req(`/api/v1/admin/allow/${enc(args[1])}`, { method: 'DELETE' }), (d) => console.log(d.ok ? `Törölve: ${args[1]}` : `Nem volt a listán: ${args[1]}`));
  }
  console.error(HELP);
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
    else { console.error(HELP); return 2; }
  }
  const pr = await get('/api/v1/projects');
  const projects = pr.ok && Array.isArray(pr.data) ? pr.data : [];
  if (!pr.ok) console.error(`Figyelem: a projektlista nem érhető el (${errorOf(pr)}); a könyvtárnév lesz a projekt neve.`);
  const sessions = listSessions({ days: opt.days }).filter((s) => s.prompts >= 2);
  let groups = [...groupByProject(sessions, projects)];
  if (opt.project) {
    const want = opt.project.toLowerCase();
    const canon = projects.find((p) => p.name.toLowerCase() === want || p.display_name?.toLowerCase() === want)?.name.toLowerCase() ?? want;
    groups = groups.filter(([name]) => name.toLowerCase() === canon);
  }
  if (!groups.length) { console.log('Nincs feldolgozható session.'); return 0; }
  if (opt.dry) {
    let n = 0;
    for (const [name, list] of groups) {
      const { picked, total, omitted } = prepare(list);
      console.log(`${name}: ${picked.length} session, ${total} karakter${omitted ? ` (${omitted} régebbi kimarad)` : ''}`);
      n++;
    }
    console.log(`Összesen ${n} claude -p hívás kellene.`);
    return 0;
  }
  const dir = join(homedir(), 'offtrack-backfill');
  mkdirSync(dir, { recursive: true });
  const written = [];
  let code = 0;
  for (const [name, list] of groups) {
    const { picked, omitted } = prepare(list);
    process.stderr.write(`${name}: ${picked.length} session összefoglalása…\n`);
    try {
      const { threads } = await summarize(name, picked.map((s) => s.text));
      const file = freeName(dir, slug(name));
      const root = projects.find((p) => p.name === name)?.paths?.[0];
      writeFileSync(file, writeProposal({ project: name, cwd: root ?? picked[picked.length - 1].cwd, sessions: picked.length,
        from: (picked[0].start ?? '').slice(0, 10), threads, omitted, file: file.replace(homedir(), '~') }));
      written.push(file);
    } catch (e) {
      console.error(`Hiba (${name}): ${e.message}`);
      code = 1;
    }
  }
  if (written.length) {
    console.log(`Elkészült:\n${written.map((f) => `  ${f}`).join('\n')}`);
    console.log('Következő lépés: nézd át és szerkeszd a fájlokat, majd: offtrack import <fájl…>');
  }
  return code;
}

async function importFiles(files) {
  let code = 0;
  for (const file of files) {
    let p;
    try { p = parseProposal(readFileSync(file, 'utf8')); } catch (e) { console.error(`Hiba (${file}): ${e.message}`); code = 1; continue; }
    for (const w of p.warnings) console.error(`${file}: ${w}`);
    const r = await send('/api/v1/import', { timeoutMs: 60000, force: true, body: { project: p.project, ...(p.cwd ? { cwd: p.cwd } : {}), threads: p.threads } });
    if (!r.ok) { console.error(`Hiba (${file}): ${errorOf(r)}`); code = 1; continue; }
    renameSync(file, `${file}.imported`);
    console.log(`${r.data.project}: ${r.data.created} új, ${r.data.skipped} kihagyva`);
  }
  return code;
}

async function main([cmd, ...args]) {
  if (cmd === 'whoami' && args.length === 0) {
    return call(get('/api/v1/me'), (u) => console.log(`${u.name} <${u.email}>${u.is_admin ? ' (admin)' : ''}`));
  }
  if (cmd === 'login' && args.length === 0) {
    // A token a bemenetről jön (nem parancssori paraméter), így nem kerül a shell-előzményekbe és a folyamatlistába.
    if (process.stdin.isTTY) process.stderr.write('Token: ');
    const token = (await readStdin()).trim();
    if (!token) return fail('Nincs token a bemeneten.');
    const r = await req('/api/v1/me', { method: 'GET', token });
    if (!r.ok) return fail(`a token nem érvényes (${errorOf(r)}); a régi beállítás maradt.`);
    const file = join(home(), 'client-token');
    writeFileSync(file, token + '\n', { mode: 0o600 });
    chmodSync(file, 0o600);
    console.log(`Bejelentkezve: ${r.data.name} <${r.data.email}>`);
    return 0;
  }
  if (cmd === 'projects' && args.length === 0) {
    return call(get('/api/v1/projects'), (list) => {
      for (const p of list) {
        const role = p.role === 'owner' ? '[gazda]' : p.role === 'member' ? '[tag]' : '';
        const members = (p.members ?? []).length > 1 ? `  (tagok: ${p.members.join(', ')})` : '';
        const label = p.display_name ? `${p.display_name} (${p.name})` : p.name;
        console.log(`${label}  ${role}  ${(p.paths ?? []).join(', ')}${members}`.replace(/ {3,}/g, '  '));
      }
    });
  }
  if (cmd === 'merge' && args.length === 2) {
    const [from, into] = args;
    const r = await req('/api/v1/projects/merge', { body: { from, into } });
    if (!r.ok) return fail(errorOf(r));
    const list = await get('/api/v1/projects');
    const paths = list.ok && Array.isArray(list.data) ? (list.data.find((p) => p.slug === r.data.slug)?.paths ?? []).join(', ') : '';
    console.log(`Beolvasztva: ${from} → ${r.data.name}.${paths ? ` A(z) ${paths} alatti sessionök mostantól ide jelentenek.` : ''}`);
    return 0;
  }
  if (cmd === 'attach' && (args.length === 1 || (args.length === 2 && args[1] === '--new'))) {
    const session = currentSession();
    if (!session) return fail('Nem találom a sessiont: ezt a parancsot egy Claude Code sessionből futtasd.');
    return call(req(`/api/v1/sessions/${enc(session)}/attach`, { body: { project: args[0], create: args[1] === '--new' } }),
      (p) => console.log(`Csatolva: ${process.cwd()} → ${p.name}.`));
  }
  if (cmd === 'root' && args.length === 2) {
    const path = args[1].startsWith('/') ? args[1] : join(process.cwd(), args[1]);
    return call(req('/api/v1/projects/roots', { body: { project: args[0], path } }), (p) => console.log(`Gyökér: ${path} → ${p.display_name || p.name}`));
  }
  if (cmd === 'rename' && args.length >= 1) {
    const name = args.slice(1).join(' ');
    return call(req(`/api/v1/projects/${enc(args[0])}`, { method: 'PATCH', body: { display_name: name } }),
      (p) => console.log(p.display_name ? `Megjelenített név: ${p.display_name}` : `A megjelenített név törölve: ${p.name}`));
  }
  if (cmd === 'share' && args.length === 2) {
    return call(req(`/api/v1/projects/${enc(args[0])}/members`, { body: { email: args[1] } }),
      (m) => console.log(`Megosztva. Tagok: ${m.map((x) => x.email).join(', ')}`));
  }
  if (cmd === 'unshare' && args.length === 2) {
    return call(req(`/api/v1/projects/${enc(args[0])}/members/${enc(args[1])}`, { method: 'DELETE' }),
      (m) => console.log(`Eltávolítva. Tagok: ${m.map((x) => x.email).join(', ')}`));
  }
  if (cmd === 'transfer' && args.length === 2) {
    return call(req(`/api/v1/projects/${enc(args[0])}/owner`, { body: { email: args[1] } }), () => console.log(`Átadva: ${args[0]} → ${args[1]}`));
  }
  if (cmd === 'publish' && args.length === 1 && /^\d+$/.test(args[0])) {
    return call(req(`/api/v1/items/${args[0]}/publish`), (it) => console.log(`Publikálva: #${it.id}`));
  }
  if (cmd === 'flush' && args.length === 0) {
    await flushQueue({ timeoutMs: 5000, budgetMs: 10 * 60 * 1000, max: 10000, force: true });
    console.log(`A sorban maradt: ${queueLength()}`);
    return 0;
  }
  if (cmd === 'mobile' && args.length === 1 && args[0] === 'url') {
    return call(req('/api/v1/me/mobile', { body: {} }), ({ url }) => console.log(`A mobil connector URL-je (jelszóként kezeld, ne oszd meg):

  ${url}

Felvétel: claude.ai → Beállítások → Connectorok → Egyedi connector hozzáadása; név: offTrack, URL: a fenti.
Utána a Claude appban (mobil, desktop, web): „track futureal szórólap”.
Az új URL a korábbit érvényteleníti; visszavonás: offtrack mobile revoke`));
  }
  if (cmd === 'mobile' && args.length === 1 && args[0] === 'revoke') {
    return call(req('/api/v1/me/mobile', { method: 'DELETE' }), ({ revoked }) => console.log(`Visszavonva: ${revoked} connector-URL.`));
  }
  if (cmd === 'backfill') return backfill(args);
  if (cmd === 'import' && args.length >= 1) return importFiles(args);
  if (cmd === 'admin') return admin(args);
  console.error(HELP);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
