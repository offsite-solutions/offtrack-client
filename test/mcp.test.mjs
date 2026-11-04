import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { recorder, home } from './helpers.mjs';

const MCP = new URL('../mcp.mjs', import.meta.url).pathname;
const OFFLINE = 'A szerver nem érhető el; a jelentés helyben sorba került, és később továbbítódik.';

// Elindítja az MCP szervert, elküldi a kéréseket, és visszaadja a válaszokat azonosító szerint.
function mcp(dir, requests, env = {}) {
  return new Promise((resolve) => {
    const c = spawn('node', [MCP], { cwd: tmpdir(), env: { ...process.env, OFFTRACK_HOME: dir, CLAUDE_CODE_SESSION_ID: 's-old', ...env } });
    const want = new Set(requests.map((r) => r.id));
    const got = {};
    let buf = '';
    c.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined) got[msg.id] = msg;
        if ([...want].every((id) => got[id])) c.stdin.end();
      }
    });
    c.on('close', () => resolve(got));
    c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) + '\n');
    c.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    for (const r of requests) c.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...r }) + '\n');
  });
}
const call = (id, name, args) => ({ id, method: 'tools/call', params: { name, arguments: args } });
const text = (res) => res.result.content.map((c) => c.text).join('\n');
function withPid(dir, sid) {
  mkdirSync(join(dir, 'pids'), { recursive: true });
  writeFileSync(join(dir, 'pids', String(process.pid)), sid);
}

test('report a pid-fájl sessionjével', async () => {
  const srv = await recorder(() => [201, { id: 12, kind: 'branch', thread_id: 3 }]);
  const dir = home(srv.url);
  withPid(dir, 's-new');
  await mcp(dir, [call(1, 'offtrack_report', { kind: 'branch', text: 'CM v0.10' })]);
  await srv.close();
  assert.equal(srv.requests[0].url, '/api/v1/items');
  assert.equal(srv.requests[0].body.session_id, 's-new');
});

test('env-tartalék', async () => {
  const srv = await recorder(() => [201, { id: 1 }]);
  await mcp(home(srv.url), [call(1, 'offtrack_report', { kind: 'stop', text: 'kész' })]);
  await srv.close();
  assert.equal(srv.requests[0].body.session_id, 's-old');
});

test('offline report sorba kerül', async () => {
  const dir = home();
  const res = await mcp(dir, [call(1, 'offtrack_report', { kind: 'stop', text: 'kész' })]);
  assert.ok(text(res[1]).startsWith(OFFLINE));
  const q = readFileSync(join(dir, 'queue.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(q.length, 1);
  assert.equal(q[0].path, '/api/v1/items');
});

test('4xx hiba', async () => {
  const srv = await recorder(() => [400, { error: 'a szál nem a session projektjéhez tartozik' }]);
  const res = await mcp(home(srv.url), [call(1, 'offtrack_report', { kind: 'branch', text: 'x', thread_id: 99 })]);
  await srv.close();
  assert.equal(res[1].result.isError, true);
  assert.ok(text(res[1]).includes('a szál nem a session projektjéhez tartozik'));
});

test('tools/list', async () => {
  const res = await mcp(home(), [{ id: 1, method: 'tools/list' }]);
  assert.deepEqual(res[1].result.tools.map((t) => t.name).sort(), [
    'offtrack_attach', 'offtrack_cowork', 'offtrack_coworkers', 'offtrack_items', 'offtrack_link', 'offtrack_new_thread', 'offtrack_projects', 'offtrack_rename_thread', 'offtrack_report', 'offtrack_threads', 'offtrack_update',
  ]);
});

test('attach a pid-fájl sessionjével', async () => {
  const srv = await recorder(() => [200, { id: 1, slug: 'greengo', name: 'greengo' }]);
  const dir = home(srv.url);
  withPid(dir, 's-new');
  await mcp(dir, [call(1, 'offtrack_attach', { project: 'greengo' })]);
  await srv.close();
  assert.equal(srv.requests[0].url, '/api/v1/sessions/s-new/attach');
  assert.deepEqual(srv.requests[0].body, { project: 'greengo', create: false });
});

test('nem üres sor mellett az írás a sor végére kerül', async () => {
  const srv = await recorder((req, body) => (body?.session_id === 'q1' ? [500, {}] : [201, { id: 5, kind: 'stop', thread_id: 1 }]));
  const dir = home(srv.url);
  withPid(dir, 's-new');
  writeFileSync(join(dir, 'queue.jsonl'), JSON.stringify({ id: 'q1', path: '/api/v1/events', method: 'POST', body: { event: 'SessionStart', session_id: 'q1', cwd: '/w' } }) + '\n');
  const res = await mcp(dir, [call(1, 'offtrack_report', { kind: 'stop', text: 'kész' })]);
  await srv.close();
  assert.ok(!srv.requests.some((r) => r.url === '/api/v1/items'));
  const q = readFileSync(join(dir, 'queue.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(q.map((x) => x.path), ['/api/v1/events', '/api/v1/items']);
  assert.ok(text(res[1]).includes('sorba'));
});

test('MCP assignee', async () => {
  const srv = await recorder(() => [201, { id: 7, kind: 'manual', thread_id: 1 }]);
  const dir = home(srv.url);
  withPid(dir, 's-new');
  await mcp(dir, [call(1, 'offtrack_report', { kind: 'manual', text: 'nyomtatás', assignee: 'peter@x.hu' })]);
  await srv.close();
  assert.equal(srv.requests[0].body.assignee_email, 'peter@x.hu');
});

test('MCP publish', async () => {
  const srv = await recorder(() => [200, { id: 5, status: 'open' }]);
  await mcp(home(srv.url), [call(1, 'offtrack_update', { item_id: 5, publish: true })]);
  await srv.close();
  assert.ok(srv.requests.some((r) => r.method === 'POST' && r.url === '/api/v1/items/5/publish'));
});

const ITEMS = [{ id: 1, title: 'offtrack', is_default: 1, items: [
  { id: 7, kind: 'idea', text: 'iOS app', status: 'open', due_date: null, assignee: null },
  { id: 9, kind: 'manual', text: 'nyomtatás', status: 'in_progress', due_date: '2026-11-01', assignee: 'Péter' },
] }];

test('items a session projektjével', async () => {
  const srv = await recorder((req) => (req.url.startsWith('/api/v1/sessions/by-pid/')
    ? [200, { session_id: 's1', project: { slug: 'offtrack', name: 'offtrack' } }] : [200, ITEMS]));
  const res = await mcp(home(srv.url), [call(1, 'offtrack_items', {})]);
  await srv.close();
  assert.equal(srv.requests[1].url, '/api/v1/projects/offtrack/items?cowork=1');
  const out = text(res[1]);
  assert.ok(out.startsWith('#1 offtrack\n  #7 iOS app [ötlet]\n  #9 nyomtatás [kézi: Péter] [folyamatban] [határidő: 2026-11-01]'));
});

test('items megadott projekttel, üres lista', async () => {
  const srv = await recorder(() => [200, []]);
  const res = await mcp(home(srv.url), [call(1, 'offtrack_items', { project: 'green go' })]);
  await srv.close();
  assert.equal(srv.requests.length, 1);
  assert.equal(srv.requests[0].url, '/api/v1/projects/green%20go/items?cowork=1');
  assert.ok(text(res[1]).startsWith('Nincs nyitott tétel.'));
});

test('report project-tel: átadás', async () => {
  const srv = await recorder(() => [201, { item: { id: 31, kind: 'branch', thread_id: 8 }, source: { id: 4, status: 'done' }, link: { id: 2 } }]);
  const dir = home(srv.url);
  withPid(dir, 's-new');
  const res = await mcp(dir, [call(1, 'offtrack_report', { kind: 'branch', text: 'API-hívás', project: 'futureal', from_item_id: 4 })]);
  await srv.close();
  assert.equal(srv.requests[0].method, 'POST');
  assert.equal(srv.requests[0].url, '/api/v1/items/handoff');
  assert.equal(srv.requests[0].body.project, 'futureal');
  assert.equal(srv.requests[0].body.from_item_id, 4);
  assert.equal(srv.requests[0].body.session_id, 's-new');
  assert.ok(text(res[1]).startsWith('Átadva: #31 (futureal).'));
});

test('report to-val: a handoff végpontra megy', async () => {
  const srv = await recorder(() => [201, { item: { id: 32, kind: 'branch', text: 'API', status: 'open' }, cowork: { id: 1, level: 'task', nickname: 'Peti' } }]);
  const dir = home(srv.url);
  withPid(dir, 's-new');
  const res = await mcp(dir, [call(1, 'offtrack_report', { kind: 'branch', text: 'API', to: 'Peti', from_item_id: 4 })]);
  await srv.close();
  assert.equal(srv.requests[0].url, '/api/v1/items/handoff');
  assert.equal(srv.requests[0].body.to, 'Peti');
  assert.equal(srv.requests[0].body.project, undefined);
  assert.equal(srv.requests[0].body.from_item_id, 4);
  assert.ok(text(res[1]).startsWith('Átadva: #32 → Peti.'));
});

test('report to-val from_item_id nélkül: figyelmeztet a hivatkozott nyitott tételre', async () => {
  const srv = await recorder(() => [201, { item: { id: 33, kind: 'branch', text: 'A #12 megvalósítása', status: 'open' }, cowork: { id: 1, level: 'task', nickname: 'Peti' }, unlinked: [12] }]);
  const dir = home(srv.url);
  withPid(dir, 's-new');
  const res = await mcp(dir, [call(1, 'offtrack_report', { kind: 'branch', text: 'A #12 megvalósítása', to: 'Peti' })]);
  await srv.close();
  assert.ok(text(res[1]).startsWith('Átadva: #33 → Peti. Figyelem: a szöveg a saját nyitott #12 tételre hivatkozik'));
});

test('report parent_item_id-vel', async () => {
  const srv = await recorder(() => [201, { id: 40, kind: 'stop', thread_id: 8, parent_item_id: 32 }]);
  const dir = home(srv.url);
  withPid(dir, 's-new');
  const res = await mcp(dir, [call(1, 'offtrack_report', { kind: 'stop', text: 'kész', parent_item_id: 32 })]);
  await srv.close();
  assert.equal(srv.requests[0].url, '/api/v1/items');
  assert.equal(srv.requests[0].body.parent_item_id, 32);
  assert.ok(text(res[1]).startsWith('Rögzítve: #40'));
});

test('to és project együtt: hiba, nincs hívás', async () => {
  const srv = await recorder(() => [201, {}]);
  const res = await mcp(home(srv.url), [call(1, 'offtrack_report', { kind: 'branch', text: 'x', to: 'Peti', project: 'futureal' })]);
  await srv.close();
  assert.equal(res[1].result.isError, true);
  assert.equal(srv.requests.length, 0);
});

test('from_item_id project nélkül: hiba, nincs hívás', async () => {
  const srv = await recorder(() => [201, {}]);
  const res = await mcp(home(srv.url), [call(1, 'offtrack_report', { kind: 'branch', text: 'x', from_item_id: 4 })]);
  await srv.close();
  assert.equal(res[1].result.isError, true);
  assert.equal(srv.requests.length, 0);
});

test('update project-tel: áthelyezés', async () => {
  const srv = await recorder(() => [200, { id: 5, project: 'futureal' }]);
  await mcp(home(srv.url), [call(1, 'offtrack_update', { item_id: 5, project: 'futureal' })]);
  await srv.close();
  assert.equal(srv.requests[0].method, 'POST');
  assert.equal(srv.requests[0].url, '/api/v1/items/5/move');
  assert.equal(srv.requests[0].body.project, 'futureal');
});

test('update project és status együtt: hiba, nincs hívás', async () => {
  const srv = await recorder(() => [200, {}]);
  const res = await mcp(home(srv.url), [call(1, 'offtrack_update', { item_id: 5, project: 'futureal', status: 'done' })]);
  await srv.close();
  assert.equal(res[1].result.isError, true);
  assert.equal(srv.requests.length, 0);
});

test('offline átadás sorba kerül', async () => {
  const dir = home();
  const res = await mcp(dir, [call(1, 'offtrack_report', { kind: 'manual', text: 'x', project: 'futureal' })]);
  assert.ok(text(res[1]).startsWith(OFFLINE));
  const q = readFileSync(join(dir, 'queue.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(q[0].path, '/api/v1/items/handoff');
});

test('szál átnevezése', async () => {
  const srv = await recorder(() => [200, { id: 49, title: 'LDU NÖP v2' }]);
  const res = await mcp(home(srv.url), [call(1, 'offtrack_rename_thread', { thread_id: 49, title: 'LDU NÖP v2' })]);
  await srv.close();
  assert.equal(srv.requests[0].method, 'PATCH');
  assert.equal(srv.requests[0].url, '/api/v1/threads/49');
  assert.deepEqual(srv.requests[0].body, { title: 'LDU NÖP v2' });
  assert.ok(text(res[1]).startsWith('Szál átnevezve: #49 LDU NÖP v2.'));
});

// Ideiglenes repó origin-nel, a sóval előre beállítva.
function repoDir(dir) {
  const repo = mkdtempSync(join(tmpdir(), 'ot-repo-'));
  for (const a of [['init', '-q'], ['remote', 'add', 'origin', 'git@github.com:acme/secret-repo.git']]) execFileSync('git', ['-C', repo, ...a]);
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src/a.js'), '');
  writeFileSync(join(dir, 'repo-salt'), 'SO');
  return repo;
}

test('report repos-szal: a lenyomatok mennek, a cím nem', async () => {
  const srv = await recorder(() => [201, { id: 1, kind: 'stop', thread_id: 1 }]);
  const dir = home(srv.url);
  const repo = repoDir(dir);
  await mcp(dir, [call(1, 'offtrack_report', { kind: 'stop', text: 'kész', repos: [join(repo, 'src/a.js')] })]);
  await srv.close();
  const body = srv.requests[0].body;
  assert.match(body.repos[0].hash, /^[0-9a-f]{64}$/);
  assert.equal(body.repos[0].label, basename(repo));
  assert.equal(JSON.stringify(body).includes('github.com'), false);
});

test('report repos nélkül: a szerkesztett fájlok repói', async () => {
  const srv = await recorder(() => [201, { id: 1, kind: 'stop', thread_id: 1 }]);
  const dir = home(srv.url);
  const repo = repoDir(dir);
  withPid(dir, 's-new');
  mkdirSync(join(dir, 'edited'));
  writeFileSync(join(dir, 'edited', 's-new'), `${join(repo, 'src/a.js')}\n`);
  await mcp(dir, [call(1, 'offtrack_report', { kind: 'stop', text: 'kész' })]);
  await srv.close();
  assert.equal(srv.requests[0].body.repos[0].label, basename(repo));
  assert.equal(existsSync(join(dir, 'edited', 's-new')), false);
});

test('coworkers: a lenyomattal kérdez, soronként egy becenév', async () => {
  const srv = await recorder(() => [200, [{ nickname: 'Anna', level: 'project' }, { nickname: 'Peti', level: null }]]);
  const dir = home(srv.url);
  const repo = repoDir(dir);
  const res = await mcp(dir, [call(1, 'offtrack_coworkers', { path: repo })]);
  await srv.close();
  assert.match(srv.requests[0].url, /^\/api\/v1\/coworkers\?hash=[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(srv.requests).includes('github.com'), false);
  assert.equal(text(res[1]), 'Anna (project)\nPeti');
});

test('coworkers: repó nélküli könyvtárnál hiba, kérés nélkül', async () => {
  const srv = await recorder(() => [200, []]);
  const res = await mcp(home(srv.url), [call(1, 'offtrack_coworkers', { path: tmpdir() })]);
  await srv.close();
  assert.equal(res[1].result.isError, true);
  assert.equal(srv.requests.length, 0);
});

const COWORKS = {
  coworks: [{ id: 7, nickname: 'Trinity', level: 'project', project: 'matrix' }, { id: 8, nickname: 'Trinity', level: 'task', project: 'zion' }],
  incoming: [{ id: 21, nickname: 'Neo', level: 'project', project: 'matrix' }],
  outgoing: [],
};

test('cowork: a leírás szerint csak a felhasználó kérésére', async () => {
  const res = await mcp(home(), [{ id: 1, method: 'tools/list' }]);
  const tool = res[1].result.tools.find((t) => t.name === 'offtrack_cowork');
  assert.match(tool.description, /Csak a felhasználó kérésére/);
});

test('cowork műveletek: URL-ek és törzsek', async () => {
  const srv = await recorder((req) => (req.method === 'GET' ? [200, COWORKS] : [200, { id: 7, nickname: 'Trinity', level: 'task', project: 'matrix' }]));
  const dir = home(srv.url);
  const res = await mcp(dir, [
    call(1, 'offtrack_cowork', { action: 'list' }),
    call(2, 'offtrack_cowork', { action: 'request', nickname: 'Neo', project: 'matrix' }),
    call(3, 'offtrack_cowork', { action: 'task', nickname: 'Trinity', project: 'matrix' }),
  ]);
  const res2 = await mcp(dir, [call(4, 'offtrack_cowork', { action: 'end', nickname: 'Trinity' })]);
  const res3 = await mcp(dir, [call(5, 'offtrack_cowork', { action: 'accept', nickname: 'Neo' }), call(6, 'offtrack_cowork', { action: 'decline', nickname: 'Neo' })]);
  await srv.close();
  assert.ok(text(res[1]).includes('Trinity'));
  const writes = srv.requests.filter((r) => r.method !== 'GET').map((r) => [r.method, r.url, r.body]);
  assert.deepEqual(writes.slice(0, 2), [
    ['POST', '/api/v1/coworks/requests', { nickname: 'Neo', project: 'matrix' }],
    ['PATCH', '/api/v1/coworks/7', { level: 'task' }],
  ]);
  // több pár project nélkül: hiba, írás nélkül
  assert.equal(res2[4].result.isError, true);
  assert.ok(text(res2[4]).includes('zion'));
  assert.deepEqual(writes.slice(2).map(([m, u]) => [m, u]).sort(), [
    ['POST', '/api/v1/coworks/requests/21/accept'], ['POST', '/api/v1/coworks/requests/21/decline'],
  ]);
  // request project nélkül: hiba
  const r4 = await mcp(home(), [call(7, 'offtrack_cowork', { action: 'request', nickname: 'Neo' })]);
  assert.equal(r4[7].result.isError, true);
});
