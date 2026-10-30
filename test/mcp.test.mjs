import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { recorder, home } from './helpers.mjs';

const MCP = new URL('../mcp.mjs', import.meta.url).pathname;
const OFFLINE = 'A szerver nem érhető el; a jelentés helyben sorba került, és később továbbítódik.';

// Elindítja az MCP szervert, elküldi a kéréseket, és visszaadja a válaszokat azonosító szerint.
function mcp(dir, requests, env = {}) {
  return new Promise((resolve) => {
    const c = spawn('node', [MCP], { env: { ...process.env, OFFTRACK_HOME: dir, CLAUDE_CODE_SESSION_ID: 's-old', ...env } });
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
    'offtrack_attach', 'offtrack_items', 'offtrack_link', 'offtrack_new_thread', 'offtrack_projects', 'offtrack_report', 'offtrack_threads', 'offtrack_update',
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
  assert.equal(srv.requests[1].url, '/api/v1/projects/offtrack/items');
  const out = text(res[1]);
  assert.ok(out.startsWith('#1 offtrack\n  #7 iOS app [ötlet]\n  #9 nyomtatás [kézi: Péter] [folyamatban] [határidő: 2026-11-01]'));
});

test('items megadott projekttel, üres lista', async () => {
  const srv = await recorder(() => [200, []]);
  const res = await mcp(home(srv.url), [call(1, 'offtrack_items', { project: 'green go' })]);
  await srv.close();
  assert.equal(srv.requests.length, 1);
  assert.equal(srv.requests[0].url, '/api/v1/projects/green%20go/items');
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
