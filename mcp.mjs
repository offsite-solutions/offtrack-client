#!/usr/bin/env node
// offtrack MCP proxy: a sessionök jelentéseit a szerverre továbbítja. Offline a jelentés helyi sorba kerül.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { send, enqueue, flushQueue } from './lib/api.mjs';
import { currentSession } from './lib/session.mjs';
import { L, VERSION } from './lib/config.mjs';
import { formatItems } from './lib/items.mjs';
import { formatCoworkers, formatCoworks, NO_REPO, pickCowork, pickRequest } from './lib/cowork.mjs';
import { reposFor, takeEdited } from './lib/git.mjs';

const OFFLINE = L('A szerver nem érhető el; a jelentés helyben sorba került, és később továbbítódik.', 'The server is unreachable; the report was queued locally and will be sent later.');
const UNREACHABLE = L('A szerver nem érhető el.', 'The server is unreachable.');
const KIND = L({ stop: 'megálló', branch: 'nyitott ág', manual: 'kézi teendő', idea: 'ötlet' }, { stop: 'milestone', branch: 'open branch', manual: 'manual task', idea: 'idea' });

const ok = (msg, data) => ({ content: [{ type: 'text', text: data === undefined ? msg : `${msg}\n${JSON.stringify(data)}` }] });
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] });

function noSession() {
  return fail(L('Nem találom a sessiont (nincs SessionStart-jelzés és CLAUDE_CODE_SESSION_ID). Az offtrack hook telepítve van?', 'Cannot find the session (no SessionStart signal and no CLAUDE_CODE_SESSION_ID). Is the offtrack hook installed?'));
}

// Írás: siker → szöveg; 4xx → hiba a szerver üzenetével; hálózati hiba → sorba.
const QUEUED = L('A jelentés sorba került: a korábbi, még el nem küldött jelentések után továbbítódik.', 'The report was queued: it will be sent after the earlier reports that are still waiting.');

async function write(path, body, method, describe) {
  // A sorban állók előbb mennek, különben például egy még el nem küldött SessionStart miatt a szerver nem ismerné a sessiont.
  if (!(await flushQueue({ timeoutMs: 2000, budgetMs: 3000 }))) {
    enqueue(path, body, method);
    return ok(QUEUED);
  }
  const r = await send(path, { method, body, timeoutMs: 5000 });
  if (r.ok) return ok(describe(r.data), r.data);
  if (r.status >= 400 && r.status < 500) return fail(`${L('Az offtrack elutasította', 'offtrack rejected it')}: ${r.data?.error ?? r.status}`);
  enqueue(path, body, method);
  return ok(OFFLINE);
}

async function read(path) {
  const r = await send(path, { method: 'GET', timeoutMs: 5000 });
  if (r.ok) return { data: r.data };
  if (r.status >= 400 && r.status < 500) return { error: fail(`${L('Az offtrack elutasította', 'offtrack rejected it')}: ${r.data?.error ?? r.status}`) };
  return { error: fail(UNREACHABLE) };
}

const server = new McpServer({ name: 'offtrack', version: VERSION });

server.registerTool('offtrack_threads', {
  description: L('A session projektjének aktív szálai (id, cím). Akkor hívd, ha az indulási [offtrack] blokk óta új szál jöhetett létre, vagy szálat kell választanod.', 'The active threads of the session\'s project (id, title). Call it when a new thread may have appeared since the [offtrack] block at startup, or when you need to pick a thread.'),
}, async () => {
  const s = await read(`/api/v1/sessions/by-pid/${process.ppid}`);
  if (s.error) return s.error;
  const t = await read(`/api/v1/projects/${encodeURIComponent(s.data.project.slug)}/threads`);
  if (t.error) return t.error;
  return ok(`${s.data.project.name}: ${t.data.map((x) => `#${x.id} ${x.title}`).join(', ')}`, t.data);
});

server.registerTool('offtrack_items', {
  description: L('Egy projekt nyitott tételei (nyitott ágak, kézi teendők, ötletek) szálanként. project nélkül a session projektje. Akkor hívd, ha a felhasználó a nyitott tételeket kéri, vagy az indulási [offtrack] blokk óta változhattak.', 'The open items of a project (open branches, manual tasks, ideas) by thread. Without project, the session\'s project. Call it when the user asks for the open items, or when they may have changed since the [offtrack] block at startup.'),
  inputSchema: { project: z.string().min(1).max(200).optional() },
}, async ({ project }) => {
  let slug = project;
  if (!slug) {
    const s = await read(`/api/v1/sessions/by-pid/${process.ppid}`);
    if (s.error) return s.error;
    slug = s.data.project.slug;
  }
  const r = await read(`/api/v1/projects/${encodeURIComponent(slug)}/items?cowork=1`);
  if (r.error) return r.error;
  return ok(formatItems(r.data), r.data);
});

server.registerTool('offtrack_report', {
  description: L('Jelentés az offtracknek. kind: stop = lezárt, önálló lépés (megálló); branch = a válaszod végén felsorolt teendő (független teendők külön, egy összefüggő javaslatlista egy ágként), elakadás vagy döntésre váró kérdés; manual = a felhasználónak kézzel elvégzendő; idea = jövőre utaló ötlet, rákérdezés nélkül (privát, amíg a felhasználó nem publikálja). text: 1–3 mondat, magyarul. thread_id nélkül a projekt fő szálára kerül. assignee: csak manual-nál, a projekt egy másik tagjának e-mail címe, ha a felhasználó kéri. project: átadás másik (látható) projektnek, csak branch és manual: a teendő a célprojekt fő szálára kerül, és a thread_id ilyenkor a forrásszál. to: átadás munkatársnak a becenevével, csak branch és manual: a teendő a munkatárs projektjének fő szálára kerül, közös feladatként; project-tel együtt nem adható meg. from_item_id (csak project-tel vagy to-val): a saját tétel, amiből a teendő lett; az átadáskor azonnal lezárul. parent_item_id: a közös feladat, amelyhez a tétel kapcsolódik (a munkatárs a feladat alatt látja); ha a session in_progress-re állított egy közös feladatot, magától is hozzá kapcsolódik; project-tel és to-val nem adható meg. repos: azoknak a repóknak a könyvtárai vagy fájljai, amelyeket a tétel érint (nem kötelező; az offtrack kliens csak lenyomatot és könyvtárnevet küld, címet soha).', 'Report to offtrack. kind: stop = a closed, self-contained step (milestone); branch = a to-do listed at the end of your answer (independent to-dos separately, one coherent list of suggestions as one branch), being stuck, or a question awaiting a decision; manual = something the user must do by hand; idea = an idea about the future, without asking (private until the user publishes it). text: 1–3 sentences, in English. Without thread_id it goes to the project\'s main thread. assignee: only for manual, the email of another project member, if the user asks. project: hand off to another (visible) project, branch and manual only: the to-do goes to the target project\'s main thread, and thread_id is then the source thread. to: hand off to a coworker by nickname, branch and manual only: the to-do goes to the main thread of the coworker\'s project as a shared task; cannot be combined with project. from_item_id (only with project or to): your own item the to-do came from; it closes at once on hand-off. parent_item_id: the shared task the item belongs to (the coworker sees it under the task); once the session sets a shared task to in_progress, reports link to it automatically; cannot be combined with project or to. repos: directories or files of the repos the item concerns (optional; the offtrack client sends only a digest and the directory name, never the address).'),
  inputSchema: {
    kind: z.enum(['stop', 'branch', 'manual', 'idea']),
    text: z.string().min(1).max(2000),
    thread_id: z.number().int().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignee: z.string().email().optional(),
    project: z.string().min(1).max(200).optional(),
    to: z.string().min(1).max(24).optional(),
    from_item_id: z.number().int().optional(),
    parent_item_id: z.number().int().optional(),
    repos: z.array(z.string().min(1).max(4096)).max(10).optional(),
  },
}, async ({ assignee, project, to, from_item_id, repos: paths, ...args }) => {
  if (project && to) return fail(L('A project és a to közül csak az egyiket add meg.', 'Give either project or to, not both.'));
  if (args.parent_item_id && (project || to)) return fail(L('A parent_item_id nem adható meg project-tel vagy to-val.', 'parent_item_id cannot be combined with project or to.'));
  if (from_item_id && !project && !to) return fail(L('A from_item_id csak project-tel vagy to-val együtt adható meg.', 'from_item_id requires project or to.'));
  const session_id = currentSession();
  if (!session_id) return noSession();
  // repók: amit Claude megadott; különben a szerkesztett fájlok; végül a munkakönyvtár
  const edited = takeEdited(session_id);
  let found = await reposFor(paths?.length ? paths : edited);
  if (!found.length) found = await reposFor([process.cwd()]);
  if (found.length) args.repos = found;
  if (project) {
    // átadás: a thread_id a forrásszál, a tétel a cél projekt fő szálára kerül
    return write('/api/v1/items/handoff', { session_id, project, ...args, ...(from_item_id ? { from_item_id } : {}), ...(assignee ? { assignee_email: assignee } : {}) }, 'POST',
      (d) => L(`Átadva: #${d.item.id} (${project}).`, `Handed off: #${d.item.id} (${project}).`));
  }
  if (to) {
    // átadás munkatársnak: a célprojektet a szerver választja, és nem nevezi meg
    return write('/api/v1/items/handoff', { session_id, to, ...args, ...(from_item_id ? { from_item_id } : {}) }, 'POST',
      (d) => L(`Átadva: #${d.item.id} → ${d.cowork.nickname}.`, `Handed off: #${d.item.id} → ${d.cowork.nickname}.`));
  }
  return write('/api/v1/items', { session_id, ...args, ...(assignee ? { assignee_email: assignee } : {}) }, 'POST', (d) => L(`Rögzítve: #${d.id} (${KIND[d.kind] ?? d.kind}) a #${d.thread_id} szálon.`, `Recorded: #${d.id} (${KIND[d.kind] ?? d.kind}) on thread #${d.thread_id}.`));
});

server.registerTool('offtrack_coworkers', {
  description: L('Kiket listáz, aki ugyanazon a repón dolgozik: csak a becenevek, soronként egy. path nélkül a session könyvtára; a repó címe nem hagyja el a gépet, csak a lenyomata.', 'Lists the people working on the same repo: nicknames only, one per line. Without path, the session directory; the repo address never leaves the machine, only its digest.'),
  inputSchema: { path: z.string().min(1).max(4096).optional() },
}, async ({ path }) => {
  const [repo] = await reposFor([path ?? process.cwd()]);
  if (!repo) return fail(NO_REPO);
  const r = await read(`/api/v1/coworkers?hash=${repo.hash}`);
  if (r.error) return r.error;
  return ok(formatCoworkers(r.data));
});

// Azonnali írás sor nélkül (az együttműködés műveletei a pillanatnyi listán alapulnak, később nem ismételhetők).
async function act(path, body, method, describe) {
  const r = await send(path, { method, body, timeoutMs: 5000 });
  if (r.ok) return ok(describe(r.data));
  if (r.status >= 400 && r.status < 500) return fail(`${L('Az offtrack elutasította', 'offtrack rejected it')}: ${r.data?.error ?? r.status}`);
  return fail(UNREACHABLE);
}

server.registerTool('offtrack_cowork', {
  description: L('Együttműködések munkatársakkal. Csak a felhasználó kérésére hívd. action: list = együttműködések (becenév, szint, saját projekt) és függő felkérések; request = projektszintű felkérés a nickname-nek a saját project-tel (közös repó nélkül is; el kell fogadnia); accept = a nickname felkérésének elfogadása (project: a saját projekted, kötelező, ha nincs javaslat); decline = elutasítás; task = vissza feladatszintre; end = megszüntetés (az átadott feladatok a címzettnél maradnak). Ha egy becenévhez több pár tartozik, a project választja ki.', 'Coworks with coworkers. Call it only when the user asks. action: list = coworks (nickname, level, own project) and pending requests; request = ask nickname for project level, with your own project (no common repo needed; they must accept); accept = accept the request from nickname (project: your own project, required when none is suggested); decline = decline it; task = back to task level; end = end the cowork (handed-off tasks stay with the recipient). When a nickname has several pairs, project picks one.'),
  inputSchema: {
    action: z.enum(['list', 'request', 'accept', 'decline', 'task', 'end']),
    nickname: z.string().min(1).max(24).optional(),
    project: z.string().min(1).max(200).optional(),
  },
}, async ({ action, nickname, project }) => {
  if (action !== 'list' && !nickname) return fail(L('Add meg a becenevet (nickname).', 'Give the nickname.'));
  if (action === 'request') {
    if (!project) return fail(L('Add meg a saját projektedet (project).', 'Give your own project (project).'));
    return act('/api/v1/coworks/requests', { nickname, project }, 'POST',
      (r) => L(`Felkérés elküldve: ${r.nickname} (saját projekt: ${r.project}).`, `Request sent: ${r.nickname} (own project: ${r.project}).`));
  }
  const r = await read('/api/v1/coworks');
  if (r.error) return r.error;
  if (action === 'list') return ok(formatCoworks(r.data));
  if (action === 'accept') {
    const { found, error } = pickRequest(r.data.incoming, nickname, project);
    if (error) return fail(error);
    return act(`/api/v1/coworks/requests/${found.id}/accept`, project ? { project } : {}, 'POST',
      (c) => L(`Elfogadva: ${c.nickname}, projektszint (saját projekt: ${c.project}).`, `Accepted: ${c.nickname}, project level (own project: ${c.project}).`));
  }
  if (action === 'decline') {
    const { found, error } = pickRequest(r.data.incoming, nickname, project);
    if (error) return fail(error);
    return act(`/api/v1/coworks/requests/${found.id}/decline`, {}, 'POST', () => `${L('Elutasítva', 'Declined')}: ${found.nickname}.`);
  }
  const { found, error } = pickCowork(r.data.coworks, nickname, project);
  if (error) return fail(error);
  if (action === 'task') {
    return act(`/api/v1/coworks/${found.id}`, { level: 'task' }, 'PATCH',
      (c) => L(`Feladatszint: ${c.nickname} (saját projekt: ${c.project}).`, `Task level: ${c.nickname} (own project: ${c.project}).`));
  }
  return act(`/api/v1/coworks/${found.id}`, undefined, 'DELETE', () => L(`Megszüntetve: ${found.nickname} (saját projekt: ${found.project}).`, `Ended: ${found.nickname} (own project: ${found.project}).`));
});

server.registerTool('offtrack_update', {
  description: L('Egy tétel állapotának módosítása: done = elvégezve, dropped = elvetve, in_progress = most dolgozol rajta, open = újranyitva. Akkor hívd, ha egy korábbi nyitott ágat elvégeztél vagy elvetettél. publish: true = a saját ötlet publikálása a projekt tagjainak (csak a felhasználó kérésére). project = a tétel áthelyezése másik (látható) projekt fő szálára; status-szal és publish-sel nem adható meg együtt.', 'Change an item\'s status: done = completed, dropped = dropped, in_progress = you are working on it now, open = reopened. Call it when you have completed or dropped an earlier open branch. publish: true = publish your own idea to the project members (only when the user asks). project = move the item to the main thread of another (visible) project; cannot be combined with status or publish.'),
  inputSchema: {
    item_id: z.number().int(),
    status: z.enum(['done', 'dropped', 'in_progress', 'open']).optional(),
    publish: z.boolean().optional(),
    project: z.string().min(1).max(200).optional(),
  },
}, async ({ item_id, status, publish, project }) => {
  if (project && (status || publish)) return fail(L('A project nem adható meg status-szal vagy publish-sel együtt.', 'project cannot be combined with status or publish.'));
  if (!status && !publish && !project) return fail(L('Adj meg status-t, publish: true-t vagy project-et.', 'Give status, publish: true or project.'));
  const session_id = currentSession();
  if (project) return write(`/api/v1/items/${item_id}/move`, { project, ...(session_id ? { session_id } : {}) }, 'POST', (d) => L(`Áthelyezve: #${d.id} → ${project}.`, `Moved: #${d.id} → ${project}.`));
  let res;
  if (publish) res = await write(`/api/v1/items/${item_id}/publish`, undefined, 'POST', (d) => `#${d.id}: ${L('publikálva', 'published')}.`);
  if (status && !res?.isError) res = await write(`/api/v1/items/${item_id}`, { status, ...(session_id ? { session_id } : {}) }, 'PATCH', (d) => `#${d.id}: ${d.status}.`);
  return res;
});

server.registerTool('offtrack_new_thread', {
  description: L('Új szál a projektben: új, több lépéses munkafolyam, amely nem illik a meglévő szálakba. Kétség esetén ne nyiss újat, maradj a fő szálon.', 'A new thread in the project: a new, multi-step workflow that does not fit the existing threads. When in doubt, don\'t open a new one; stay on the main thread.'),
  inputSchema: { title: z.string().min(1).max(200) },
}, async ({ title }) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write('/api/v1/threads', { session_id, title }, 'POST', (d) => `${L('Új szál', 'New thread')}: #${d.id} ${d.title}.`);
});

server.registerTool('offtrack_rename_thread', {
  description: L('Egy szál átnevezése (a fő szálé is). Csak a felhasználó kérésére hívd; a projekt tulajdonosa teheti meg.', 'Rename a thread (the main thread too). Call it only when the user asks; only the project owner can do it.'),
  inputSchema: { thread_id: z.number().int(), title: z.string().min(1).max(200) },
}, async ({ thread_id, title }) => write(`/api/v1/threads/${thread_id}`, { title }, 'PATCH', (d) => `${L('Szál átnevezve', 'Thread renamed')}: #${d.id} ${d.title}.`));

server.registerTool('offtrack_link', {
  description: L('Kapcsolat egy másik projekttel: akkor hívd, ha más projekt kódját, szerverét vagy konfigurációját érinted.', 'A link to another project: call it when you touch another project\'s code, server or configuration.'),
  inputSchema: { other_project: z.string().min(1).max(200), note: z.string().min(1).max(2000), thread_id: z.number().int().optional() },
}, async (args) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write('/api/v1/links', { session_id, ...args }, 'POST', (d) => `${L('Kapcsolat rögzítve', 'Link recorded')}: #${d.id}.`);
});

server.registerTool('offtrack_projects', {
  description: L('A felhasználó offtrack-projektjei (szerep: tulajdonos vagy tag, a saját gyökérkönyvtárai, a tagok). Akkor hívd, ha a felhasználó a projekteket kéri, vagy csatolás előtt.', 'The user\'s offtrack projects (role: owner or member, their own root directories, the members). Call it when the user asks for the projects, or before attaching.'),
}, async () => {
  const r = await read('/api/v1/projects');
  if (r.error) return r.error;
  return ok(r.data.map((p) => `${p.display_name ? `${p.display_name} (${p.name})` : p.name}  ${p.role === 'owner' ? L('[tulajdonos]', '[owner]') : L('[tag]', '[member]')}  ${(p.paths ?? []).join(', ')}`).join('\n'),
    r.data.map(({ slug, ...p }) => p));
});

server.registerTool('offtrack_attach', {
  description: L('Ezt a sessiont (és a könyvtárát, az alkönyvtáraival) egy projekthez csatolja. Csak a felhasználó kérésére hívd. Ha a projekt nem létezik, előbb kérdezd meg a felhasználót, és csak igen esetén hívd create: true-val.', 'Attaches this session (and its directory, with its subdirectories) to a project. Call it only when the user asks. If the project does not exist, ask the user first, and call it with create: true only if they agree.'),
  inputSchema: { project: z.string().min(1).max(200), create: z.boolean().optional() },
}, async ({ project, create = false }) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write(`/api/v1/sessions/${encodeURIComponent(session_id)}/attach`, { project, create }, 'POST', (d) => `${L('Csatolva', 'Attached')}: ${d.name}.`);
});

await server.connect(new StdioServerTransport());
