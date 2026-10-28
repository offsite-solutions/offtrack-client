import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { recorder, home } from './helpers.mjs';

const HOOK = new URL('../hook.mjs', import.meta.url).pathname;
const OFFLINE = '[offtrack] A szerver nem érhető el, ez az utolsó ismert állapot; a jelentések helyben sorba kerülnek.';

function run(dir, input, env = {}) {
  return new Promise((resolve) => {
    const c = spawn('node', [HOOK], { env: { ...process.env, OFFTRACK_HOME: dir, CLAUDE_CODE_ENTRYPOINT: 'cli', ...env } });
    let stdout = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.on('close', (status) => resolve({ status, stdout }));
    c.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}
const ev = (event, extra = {}) => ({ hook_event_name: event, session_id: 's1', cwd: '/w/p', ...extra });
const queue = (dir) => (existsSync(join(dir, 'queue.jsonl'))
  ? readFileSync(join(dir, 'queue.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('SessionStart kontextust ad és megjegyzi a pidet', async () => {
  const srv = await recorder(() => [200, { context: 'X' }]);
  const dir = home(srv.url);
  const r = await run(dir, ev('SessionStart', { source: 'startup' }));
  await srv.close();
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, 'X');
  const pids = readdirSync(join(dir, 'pids'));
  assert.equal(pids.length, 1);
  assert.equal(readFileSync(join(dir, 'pids', pids[0]), 'utf8'), 's1');
  assert.equal(srv.requests[0].body.claude_pid, Number(pids[0]));
  assert.equal(readFileSync(join(dir, 'context', readdirSync(join(dir, 'context'))[0]), 'utf8'), 'X');
});

test('SessionStart offline a mentett kontextussal', async () => {
  const srv = await recorder(() => [200, { context: 'X' }]);
  const dir = home(srv.url);
  await run(dir, ev('SessionStart'));
  await srv.close();
  const r = await run(dir, ev('SessionStart'));
  assert.equal(r.status, 0);
  const lines = JSON.parse(r.stdout).hookSpecificOutput.additionalContext.split('\n');
  assert.equal(lines[0], OFFLINE);
  assert.equal(lines[1], 'X');
  assert.equal(queue(dir).length, 1);
});

test('Stop blokkolást továbbít', async () => {
  const srv = await recorder(() => [200, { block: true, reason: 'R' }]);
  const r = await run(home(srv.url), ev('Stop'));
  await srv.close();
  assert.deepEqual(JSON.parse(r.stdout), { decision: 'block', reason: 'R' });
});

test('Stop offline nem blokkol és nem kerül sorba', async () => {
  const dir = home();
  const r = await run(dir, ev('Stop'));
  assert.equal(r.stdout, '');
  assert.equal(queue(dir).length, 0);
});

test('a sor az új esemény előtt megy el', async () => {
  const srv = await recorder();
  const dir = home(srv.url);
  writeFileSync(join(dir, 'queue.jsonl'), [1, 2].map((n) =>
    JSON.stringify({ path: '/api/v1/events', body: { event: 'PostToolUse', session_id: `q${n}`, cwd: '/w/p' } })).join('\n') + '\n');
  await run(dir, ev('PostToolUse'));
  await srv.close();
  assert.deepEqual(srv.requests.map((r) => r.body.session_id), ['q1', 'q2', 's1']);
  assert.equal(queue(dir).length, 0);
});

test('félúton elakadó kiürítés', async () => {
  const srv = await recorder((req, body, n) => (n === 2 ? [500, {}] : [200, {}]));
  const dir = home(srv.url);
  writeFileSync(join(dir, 'queue.jsonl'), [1, 2, 3].map((n) =>
    JSON.stringify({ path: '/api/v1/events', body: { event: 'PostToolUse', session_id: `q${n}`, cwd: '/w/p' } })).join('\n') + '\n');
  await run(dir, ev('PostToolUse'));
  await srv.close();
  assert.deepEqual(queue(dir).map((q) => q.body.session_id), ['q2', 'q3', 's1']);
});

test('titok nem megy ki', async () => {
  const srv = await recorder(() => [200, { context: 'X' }]);
  await run(home(srv.url), ev('SessionStart'), { CLAUDE_CODE_MESSAGING_TOKEN: 'titok' });
  await srv.close();
  for (const r of srv.requests) {
    assert.ok(!r.raw.includes('titok'));
    assert.ok(!JSON.stringify(r.headers).includes('titok'));
  }
});

test('hibás bemenet', async () => {
  const dir = home();
  for (const input of ['', 'nem json']) {
    const r = await run(dir, input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
});

test('OFFTRACK_DISABLE mellett a hook semmit nem csinál', async () => {
  const srv = await recorder(() => [200, { context: 'X' }]);
  const dir = home(srv.url);
  const r = await run(dir, ev('SessionStart'), { OFFTRACK_DISABLE: '1' });
  await srv.close();
  assert.equal(r.stdout, '');
  assert.equal(srv.requests.length, 0);
  assert.equal(existsSync(join(dir, 'pids')), false);
});

test('SessionStart: a kliens elküldi a verzióját, és a felhasználónak szól, ha van újabb', async () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const srv = await recorder(() => [200, { context: 'X', update: { current: version, latest: '9.9.9' } }]);
  const dir = home(srv.url);
  const r = await run(dir, ev('SessionStart', { source: 'startup' }));
  await srv.close();
  assert.equal(srv.requests[0].headers['x-offtrack-client'], version);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.additionalContext, 'X');
  assert.match(out.systemMessage, /9\.9\.9/);
  assert.match(out.systemMessage, /npm install -g github:offsite-solutions\/offtrack-client/);
});

test('SessionStart: friss kliensnél nincs frissítési üzenet', async () => {
  const srv = await recorder(() => [200, { context: 'X' }]);
  const dir = home(srv.url);
  const r = await run(dir, ev('SessionStart', { source: 'startup' }));
  await srv.close();
  assert.equal(JSON.parse(r.stdout).systemMessage, undefined);
});
