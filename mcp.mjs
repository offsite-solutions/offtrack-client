#!/usr/bin/env node
// offtrack MCP proxy: a sessionök jelentéseit a szerverre továbbítja. Offline a jelentés helyi sorba kerül.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { send, enqueue, flushQueue } from './lib/api.mjs';
import { currentSession } from './lib/session.mjs';
import { L } from './lib/config.mjs';
import { formatItems } from './lib/items.mjs';

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

const server = new McpServer({ name: 'offtrack', version: '1.0.0' });

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
  const r = await read(`/api/v1/projects/${encodeURIComponent(slug)}/items`);
  if (r.error) return r.error;
  return ok(formatItems(r.data), r.data);
});

server.registerTool('offtrack_report', {
  description: L('Jelentés az offtracknek. kind: stop = lezárt, önálló lépés (megálló); branch = a válaszod végén felsorolt teendő (független teendők külön, egy összefüggő javaslatlista egy ágként), elakadás vagy döntésre váró kérdés; manual = a felhasználónak kézzel elvégzendő; idea = jövőre utaló ötlet, rákérdezés nélkül (privát, amíg a felhasználó nem publikálja). text: 1–3 mondat, magyarul. thread_id nélkül a projekt alapszálára kerül. assignee: csak manual-nál, a projekt egy másik tagjának e-mail címe, ha a felhasználó kéri.', 'Report to offtrack. kind: stop = a closed, self-contained step (milestone); branch = a to-do listed at the end of your answer (independent to-dos separately, one coherent list of suggestions as one branch), being stuck, or a question awaiting a decision; manual = something the user must do by hand; idea = an idea about the future, without asking (private until the user publishes it). text: 1–3 sentences, in English. Without thread_id it goes to the project\'s default thread. assignee: only for manual, the email of another project member, if the user asks.'),
  inputSchema: {
    kind: z.enum(['stop', 'branch', 'manual', 'idea']),
    text: z.string().min(1).max(2000),
    thread_id: z.number().int().optional(),
    due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    assignee: z.string().email().optional(),
  },
}, async ({ assignee, ...args }) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write('/api/v1/items', { session_id, ...args, ...(assignee ? { assignee_email: assignee } : {}) }, 'POST', (d) => L(`Rögzítve: #${d.id} (${KIND[d.kind] ?? d.kind}) a #${d.thread_id} szálon.`, `Recorded: #${d.id} (${KIND[d.kind] ?? d.kind}) on thread #${d.thread_id}.`));
});

server.registerTool('offtrack_update', {
  description: L('Egy tétel állapotának módosítása: done = elvégezve, dropped = elvetve, in_progress = most dolgozol rajta, open = újranyitva. Akkor hívd, ha egy korábbi nyitott ágat elvégeztél vagy elvetettél. publish: true = a saját ötlet publikálása a projekt tagjainak (csak a felhasználó kérésére).', 'Change an item\'s status: done = completed, dropped = dropped, in_progress = you are working on it now, open = reopened. Call it when you have completed or dropped an earlier open branch. publish: true = publish your own idea to the project members (only when the user asks).'),
  inputSchema: {
    item_id: z.number().int(),
    status: z.enum(['done', 'dropped', 'in_progress', 'open']).optional(),
    publish: z.boolean().optional(),
  },
}, async ({ item_id, status, publish }) => {
  if (!status && !publish) return fail('Adj meg status-t vagy publish: true-t.');
  const session_id = currentSession();
  let res;
  if (publish) res = await write(`/api/v1/items/${item_id}/publish`, undefined, 'POST', (d) => `#${d.id}: ${L('publikálva', 'published')}.`);
  if (status && !res?.isError) res = await write(`/api/v1/items/${item_id}`, { status, ...(session_id ? { session_id } : {}) }, 'PATCH', (d) => `#${d.id}: ${d.status}.`);
  return res;
});

server.registerTool('offtrack_new_thread', {
  description: L('Új szál a projektben: új, több lépéses munkafolyam, amely nem illik a meglévő szálakba. Kétség esetén ne nyiss újat, maradj az alapszálon.', 'A new thread in the project: a new, multi-step workflow that does not fit the existing threads. When in doubt, don\'t open a new one; stay on the default thread.'),
  inputSchema: { title: z.string().min(1).max(200) },
}, async ({ title }) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write('/api/v1/threads', { session_id, title }, 'POST', (d) => `${L('Új szál', 'New thread')}: #${d.id} ${d.title}.`);
});

server.registerTool('offtrack_link', {
  description: L('Kapcsolat egy másik projekttel: akkor hívd, ha más projekt kódját, szerverét vagy konfigurációját érinted.', 'A link to another project: call it when you touch another project\'s code, server or configuration.'),
  inputSchema: { other_project: z.string().min(1).max(200), note: z.string().min(1).max(2000), thread_id: z.number().int().optional() },
}, async (args) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write('/api/v1/links', { session_id, ...args }, 'POST', (d) => `${L('Kapcsolat rögzítve', 'Link recorded')}: #${d.id}.`);
});

server.registerTool('offtrack_projects', {
  description: L('A felhasználó offtrack-projektjei (szerep: gazda vagy tag, a saját gyökérkönyvtárai, a tagok). Akkor hívd, ha a felhasználó a projekteket kéri, vagy csatolás előtt.', 'The user\'s offtrack projects (role: owner or member, their own root directories, the members). Call it when the user asks for the projects, or before attaching.'),
}, async () => {
  const r = await read('/api/v1/projects');
  if (r.error) return r.error;
  return ok(r.data.map((p) => `${p.display_name ? `${p.display_name} (${p.name})` : p.name}  ${p.role === 'owner' ? L('[gazda]', '[owner]') : L('[tag]', '[member]')}  ${(p.paths ?? []).join(', ')}`).join('\n'),
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
