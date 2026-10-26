import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { recorder, home } from './helpers.mjs';

const CLI = new URL('../bin/offtrack.mjs', import.meta.url).pathname;

function cli(dir, args, input = '') {
  return new Promise((resolve) => {
    const c = spawn('node', [CLI, ...args], { env: { ...process.env, OFFTRACK_HOME: dir, CLAUDE_CODE_SESSION_ID: '' } });
    c.stdin.end(input);
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('merge siker', async () => {
  const srv = await recorder(() => [200, { id: 1, slug: 'greengo', name: 'greengo' }]);
  const r = await cli(home(srv.url), ['merge', 'backend', 'greengo']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.ok(r.stdout.startsWith('Beolvasztva:'));
  assert.deepEqual(srv.requests[0].body, { from: 'backend', into: 'greengo' });
});

test('merge hiba', async () => {
  const srv = await recorder(() => [400, { error: 'Nincs ilyen projekt: nincs' }]);
  const r = await cli(home(srv.url), ['merge', 'nincs', 'greengo']);
  await srv.close();
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('Nincs ilyen projekt: nincs'));
});

test('projects', async () => {
  const srv = await recorder(() => [200, [{ slug: 'offtrack', name: 'offtrack', paths: ['/a', '/b'] }, { slug: 'futureal', name: 'futureal', paths: [] }]]);
  const r = await cli(home(srv.url), ['projects']);
  await srv.close();
  const lines = r.stdout.trim().split('\n');
  assert.ok(lines[0].startsWith('offtrack'));
  assert.ok(lines[0].includes('/a, /b'));
  assert.ok(lines[1].startsWith('futureal'));
});

test('attach a pid-fájl sessionjével', async () => {
  const srv = await recorder(() => [200, { id: 1, slug: 'greengo', name: 'greengo' }]);
  const dir = home(srv.url);
  mkdirSync(join(dir, 'pids'), { recursive: true });
  writeFileSync(join(dir, 'pids', String(process.pid)), 's9');
  const r = await cli(dir, ['attach', 'greengo', '--new']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.equal(srv.requests[0].url, '/api/v1/sessions/s9/attach');
  assert.deepEqual(srv.requests[0].body, { project: 'greengo', create: true });
});

test('ismeretlen parancs', async () => {
  const r = await cli(home(), ['valami']);
  assert.equal(r.status, 2);
});

test('share', async () => {
  const srv = await recorder(() => [200, [{ email: 'peter@x.hu', role: 'member' }]]);
  const r = await cli(home(srv.url), ['share', 'greengo', 'peter@x.hu']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.equal(srv.requests[0].url, '/api/v1/projects/greengo/members');
  assert.deepEqual(srv.requests[0].body, { email: 'peter@x.hu' });
});

test('admin token', async () => {
  const srv = await recorder(() => [200, { token: 'ot_' + 'a'.repeat(64) }]);
  const r = await cli(home(srv.url), ['admin', 'token', 'peter@x.hu', 'mac']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('ot_' + 'a'.repeat(64)));
  assert.ok(r.stdout.includes('csak most látható'));
  assert.equal(srv.requests[0].url, '/api/v1/admin/users/peter%40x.hu/tokens');
});

test('login', async () => {
  const { statSync, readFileSync } = await import('node:fs');
  const srv = await recorder(() => [200, { email: 'peter@x.hu', name: 'Péter', is_admin: false }]);
  const dir = home(srv.url);
  const r = await cli(dir, ['login'], 'ot_' + 'b'.repeat(64) + '\n');
  await srv.close();
  assert.equal(r.status, 0);
  assert.equal(srv.requests[0].headers.authorization, 'Bearer ot_' + 'b'.repeat(64));
  assert.equal(readFileSync(join(dir, 'client-token'), 'utf8').trim(), 'ot_' + 'b'.repeat(64));
  assert.equal(statSync(join(dir, 'client-token')).mode & 0o777, 0o600);
});

test('login rossz tokennel nem írja felül a régit', async () => {
  const { readFileSync } = await import('node:fs');
  const srv = await recorder(() => [401, { error: 'jogosulatlan' }]);
  const dir = home(srv.url);
  const before = readFileSync(join(dir, 'client-token'), 'utf8');
  const r = await cli(dir, ['login'], 'ot_rossz\n');
  await srv.close();
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(dir, 'client-token'), 'utf8'), before);
});

test('projects név szerint, slug nélkül', async () => {
  const srv = await recorder(() => [200, [{ slug: 'p-0a1b2c3d4e', name: 'greengo', role: 'owner', paths: ['/a'], members: ['l@x.hu'] }]]);
  const r = await cli(home(srv.url), ['projects']);
  await srv.close();
  assert.ok(r.stdout.startsWith('greengo'));
  assert.ok(!r.stdout.includes('p-0a1b2c3d4e'));
});

test('rename', async () => {
  const srv = await recorder(() => [200, { slug: 'greengo', name: 'greengo', display_name: 'GreenGo' }]);
  const r = await cli(home(srv.url), ['rename', 'greengo', 'GreenGo']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.equal(srv.requests[0].method, 'PATCH');
  assert.equal(srv.requests[0].url, '/api/v1/projects/greengo');
  assert.deepEqual(srv.requests[0].body, { display_name: 'GreenGo' });
});

test('projects a megjelenített névvel', async () => {
  const srv = await recorder(() => [200, [{ slug: 'p-1', name: 'greengo', display_name: 'GreenGo', role: 'owner', paths: [], members: [] }]]);
  const r = await cli(home(srv.url), ['projects']);
  await srv.close();
  assert.ok(r.stdout.startsWith('GreenGo'));
});

// --- visszatöltés: ideiglenes HOME, benne ~/.claude/projects a tesztsessionökkel, és hamis claude a PATH elején
import { mkdtempSync, readFileSync, existsSync, readdirSync, cpSync, chmodSync as chmod } from 'node:fs';
import { tmpdir } from 'node:os';

function backfillEnv(srvUrl) {
  const dir = home(srvUrl);
  const fakeHome = mkdtempSync(join(tmpdir(), 'offtrack-fakehome-'));
  cpSync(new URL('./fixtures/backfill', import.meta.url).pathname, join(fakeHome, '.claude', 'projects'), { recursive: true });
  const bin = mkdtempSync(join(tmpdir(), 'offtrack-bin-'));
  const marker = join(bin, 'called');
  const answer = JSON.stringify({ type: 'result', result: JSON.stringify({ threads: [{ title: null, items: [{ kind: 'stop', text: 'Kész a release.', date: '2026-10-01' }] }] }) });
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ncat > /dev/null\necho "$OFFTRACK_DISABLE" > ${marker}\nprintf '%s' '${answer}'\n`);
  chmod(join(bin, 'claude'), 0o755);
  return { dir, fakeHome, marker, env: { HOME: fakeHome, PATH: `${bin}:${process.env.PATH}` } };
}

function cliEnv(dir, args, env) {
  return new Promise((resolve) => {
    const c = spawn('node', [CLI, ...args], { env: { ...process.env, OFFTRACK_HOME: dir, CLAUDE_CODE_SESSION_ID: '', ...env } });
    c.stdin.end('');
    let stdout = ''; let stderr = '';
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('backfill --dry nem hív claude-ot, projektenként sort ír', async () => {
  const srv = await recorder(() => [200, []]);
  const e = backfillEnv(srv.url);
  const r = await cliEnv(e.dir, ['backfill', '--dry', '--days', '100000'], e.env);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(e.marker), false);
  assert.match(r.stdout, /backend: \d+ session, \d+ karakter/);
  assert.match(r.stdout, /1 claude -p hívás/);
});

test('backfill megírja a javaslatfájlt a HOME alá', async () => {
  const srv = await recorder(() => [200, []]);
  const e = backfillEnv(srv.url);
  const r = await cliEnv(e.dir, ['backfill', '--days', '100000'], e.env);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(e.marker, 'utf8').trim(), '1');
  const file = join(e.fakeHome, 'offtrack-backfill', 'backend.md');
  const text = readFileSync(file, 'utf8');
  assert.ok(text.includes('- megálló 2026-10-01: Kész a release.'));
  assert.ok(r.stdout.includes(file));
  const again = await cliEnv(e.dir, ['backfill', '--days', '100000'], e.env);
  assert.equal(again.status, 0);
  assert.ok(existsSync(join(e.fakeHome, 'offtrack-backfill', 'backend-2.md')));
});

test('import felküldi a fájlt és .imported-re nevezi', async () => {
  const srv = await recorder(() => [200, { project: 'greengo', created: 2, skipped: 1 }]);
  const dir = home(srv.url);
  const tmp = mkdtempSync(join(tmpdir(), 'offtrack-prop-'));
  const file = join(tmp, 'greengo.md');
  writeFileSync(file, '# offtrack-javaslat: greengo\n<!-- offtrack-backfill project="greengo" cwd="/w/greengo" sessions="2" from="2026-09-01" -->\n\n## Szál: (alap)\n- ág 2026-09-02: Nyitott\n- ágg 2026-09-03: elírt\n');
  const r = await cliEnv(dir, ['import', file], {});
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].url, '/api/v1/import');
  assert.deepEqual(srv.requests[0].body, { project: 'greengo', cwd: '/w/greengo', threads: [{ title: null, items: [{ kind: 'branch', text: 'Nyitott', date: '2026-09-02' }] }] });
  assert.ok(r.stderr.includes('6. sor: nem értelmezhető'));
  assert.ok(r.stdout.includes('greengo: 2 új, 1 kihagyva'));
  assert.deepEqual(readdirSync(tmp), ['greengo.md.imported']);
});

test('root felveszi a gyökeret', async () => {
  const srv = await recorder(() => [200, { id: 1, slug: 'p-1', name: 'greengo' }]);
  const r = await cli(home(srv.url), ['root', 'greengo', '/w/greengo']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].url, '/api/v1/projects/roots');
  assert.deepEqual(srv.requests[0].body, { project: 'greengo', path: '/w/greengo' });
  assert.ok(r.stdout.includes('greengo'));
});

test('mobile url kiírja a connector-URL-t', async () => {
  const srv = await recorder(() => [200, { url: 'https://ot.example/mcp/ot_abc' }]);
  const r = await cli(home(srv.url), ['mobile', 'url']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].method, 'POST');
  assert.equal(srv.requests[0].url, '/api/v1/me/mobile');
  assert.ok(r.stdout.includes('https://ot.example/mcp/ot_abc'));
});

test('mobile revoke kiírja a számot', async () => {
  const srv = await recorder(() => [200, { revoked: 1 }]);
  const r = await cli(home(srv.url), ['mobile', 'revoke']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].method, 'DELETE');
  assert.ok(r.stdout.includes('Visszavonva: 1 connector-URL.'));
});

test('list projekttel', async () => {
  const srv = await recorder(() => [200, [{ id: 1, title: 'offtrack', items: [{ id: 7, kind: 'branch', text: 'teszt', status: 'open' }] }]]);
  const r = await cli(home(srv.url), ['list', 'offtrack']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.equal(srv.requests[0].url, '/api/v1/projects/offtrack/items');
  assert.equal(r.stdout, '#1 offtrack\n  #7 teszt\n');
});

test('list a session projektjével, ismeretlen sessionnél hiba', async () => {
  const srv = await recorder((req) => (req.url.startsWith('/api/v1/sessions/by-pid/')
    ? [200, { session_id: 's1', project: { slug: 'greengo', name: 'greengo' } }] : [200, []]));
  const r = await cli(home(srv.url), ['list']);
  await srv.close();
  assert.equal(srv.requests[1].url, '/api/v1/projects/greengo/items');
  assert.equal(r.stdout, 'Nincs nyitott tétel.\n');

  const srv2 = await recorder(() => [404, { error: 'nincs ilyen session' }]);
  const r2 = await cli(home(srv2.url), ['list']);
  await srv2.close();
  assert.equal(r2.status, 1);
  assert.ok(r2.stderr.includes('add meg a projektet'));
});
