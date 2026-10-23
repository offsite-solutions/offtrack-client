#!/usr/bin/env node
// offtrack MCP proxy: a sessionök jelentéseit a szerverre továbbítja. Offline a jelentés helyi sorba kerül.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { send, enqueue, flushQueue } from './lib/api.mjs';
import { currentSession } from './lib/session.mjs';

const OFFLINE = 'A szerver nem érhető el; a jelentés helyben sorba került, és később továbbítódik.';
const KIND = { stop: 'megálló', branch: 'nyitott ág', manual: 'kézi teendő', idea: 'ötlet' };

const ok = (msg, data) => ({ content: [{ type: 'text', text: data === undefined ? msg : `${msg}\n${JSON.stringify(data)}` }] });
const fail = (msg) => ({ isError: true, content: [{ type: 'text', text: msg }] });

function noSession() {
  return fail('Nem találom a sessiont (nincs SessionStart-jelzés és CLAUDE_CODE_SESSION_ID). Az offtrack hook telepítve van?');
}

// Írás: siker → szöveg; 4xx → hiba a szerver üzenetével; hálózati hiba → sorba.
const QUEUED = 'A jelentés sorba került: a korábbi, még el nem küldött jelentések után továbbítódik.';

async function write(path, body, method, describe) {
  // A sorban állók előbb mennek, különben például egy még el nem küldött SessionStart miatt a szerver nem ismerné a sessiont.
  if (!(await flushQueue({ timeoutMs: 2000, budgetMs: 3000 }))) {
    enqueue(path, body, method);
    return ok(QUEUED);
  }
  const r = await send(path, { method, body, timeoutMs: 5000 });
  if (r.ok) return ok(describe(r.data), r.data);
  if (r.status >= 400 && r.status < 500) return fail(`Az offtrack elutasította: ${r.data?.error ?? r.status}`);
  enqueue(path, body, method);
  return ok(OFFLINE);
}

async function read(path) {
  const r = await send(path, { method: 'GET', timeoutMs: 5000 });
  if (r.ok) return { data: r.data };
  if (r.status >= 400 && r.status < 500) return { error: fail(`Az offtrack elutasította: ${r.data?.error ?? r.status}`) };
  return { error: fail(OFFLINE.replace('; a jelentés helyben sorba került, és később továbbítódik.', '.')) };
}

const server = new McpServer({ name: 'offtrack', version: '1.0.0' });

server.registerTool('offtrack_threads', {
  description: 'A session projektjének aktív szálai (id, cím). Akkor hívd, ha az indulási [offtrack] blokk óta új szál jöhetett létre, vagy szálat kell választanod.',
}, async () => {
  const s = await read(`/api/v1/sessions/by-pid/${process.ppid}`);
  if (s.error) return s.error;
  const t = await read(`/api/v1/projects/${encodeURIComponent(s.data.project.slug)}/threads`);
  if (t.error) return t.error;
  return ok(`${s.data.project.name}: ${t.data.map((x) => `#${x.id} ${x.title}`).join(', ')}`, t.data);
});

server.registerTool('offtrack_report', {
  description: 'Jelentés az offTracknek. kind: stop = lezárt, önálló lépés (megálló); branch = a válaszod végén felsorolt teendő (független teendők külön, egy összefüggő javaslatlista egy ágként), elakadás vagy döntésre váró kérdés; manual = a felhasználónak kézzel elvégzendő; idea = jövőre utaló ötlet, rákérdezés nélkül (privát, amíg a felhasználó nem publikálja). text: 1–3 mondat, magyarul. thread_id nélkül a projekt alapszálára kerül. assignee: csak manual-nál, a projekt egy másik tagjának e-mail címe, ha a felhasználó kéri.',
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
  return write('/api/v1/items', { session_id, ...args, ...(assignee ? { assignee_email: assignee } : {}) }, 'POST', (d) => `Rögzítve: #${d.id} (${KIND[d.kind] ?? d.kind}) a #${d.thread_id} szálon.`);
});

server.registerTool('offtrack_update', {
  description: 'Egy tétel állapotának módosítása: done = elvégezve, dropped = elvetve, in_progress = most dolgozol rajta, open = újranyitva. Akkor hívd, ha egy korábbi nyitott ágat elvégeztél vagy elvetettél. publish: true = a saját ötlet publikálása a projekt tagjainak (csak a felhasználó kérésére).',
  inputSchema: {
    item_id: z.number().int(),
    status: z.enum(['done', 'dropped', 'in_progress', 'open']).optional(),
    publish: z.boolean().optional(),
  },
}, async ({ item_id, status, publish }) => {
  if (!status && !publish) return fail('Adj meg status-t vagy publish: true-t.');
  const session_id = currentSession();
  let res;
  if (publish) res = await write(`/api/v1/items/${item_id}/publish`, undefined, 'POST', (d) => `#${d.id}: publikálva.`);
  if (status && !res?.isError) res = await write(`/api/v1/items/${item_id}`, { status, ...(session_id ? { session_id } : {}) }, 'PATCH', (d) => `#${d.id}: ${d.status}.`);
  return res;
});

server.registerTool('offtrack_new_thread', {
  description: 'Új szál a projektben: új, több lépéses munkafolyam, amely nem illik a meglévő szálakba. Kétség esetén ne nyiss újat, maradj az alapszálon.',
  inputSchema: { title: z.string().min(1).max(200) },
}, async ({ title }) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write('/api/v1/threads', { session_id, title }, 'POST', (d) => `Új szál: #${d.id} ${d.title}.`);
});

server.registerTool('offtrack_link', {
  description: 'Kapcsolat egy másik projekttel: akkor hívd, ha más projekt kódját, szerverét vagy konfigurációját érinted.',
  inputSchema: { other_project: z.string().min(1).max(200), note: z.string().min(1).max(2000), thread_id: z.number().int().optional() },
}, async (args) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write('/api/v1/links', { session_id, ...args }, 'POST', (d) => `Kapcsolat rögzítve: #${d.id}.`);
});

server.registerTool('offtrack_projects', {
  description: 'A felhasználó offTrack-projektjei (szerep: gazda vagy tag, a saját gyökérkönyvtárai, a tagok). Akkor hívd, ha a felhasználó a projekteket kéri, vagy csatolás előtt.',
}, async () => {
  const r = await read('/api/v1/projects');
  if (r.error) return r.error;
  return ok(r.data.map((p) => `${p.display_name ? `${p.display_name} (${p.name})` : p.name}  ${p.role === 'owner' ? '[gazda]' : '[tag]'}  ${(p.paths ?? []).join(', ')}`).join('\n'),
    r.data.map(({ slug, ...p }) => p));
});

server.registerTool('offtrack_attach', {
  description: 'Ezt a sessiont (és a könyvtárát, az alkönyvtáraival) egy projekthez csatolja. Csak a felhasználó kérésére hívd. Ha a projekt nem létezik, előbb kérdezd meg a felhasználót, és csak igen esetén hívd create: true-val.',
  inputSchema: { project: z.string().min(1).max(200), create: z.boolean().optional() },
}, async ({ project, create = false }) => {
  const session_id = currentSession();
  if (!session_id) return noSession();
  return write(`/api/v1/sessions/${encodeURIComponent(session_id)}/attach`, { project, create }, 'POST', (d) => `Csatolva: ${d.name}.`);
});

await server.connect(new StdioServerTransport());
