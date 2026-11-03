import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
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

test('rename-thread', async () => {
  const srv = await recorder(() => [200, { id: 49, title: 'LDU NÖP v2' }]);
  const r = await cli(home(srv.url), ['rename-thread', '49', 'LDU', 'NÖP', 'v2']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.equal(srv.requests[0].method, 'PATCH');
  assert.equal(srv.requests[0].url, '/api/v1/threads/49');
  assert.deepEqual(srv.requests[0].body, { title: 'LDU NÖP v2' });
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

test('nick', async () => {
  const srv = await recorder(() => [200, { nickname: 'Peti' }]);
  const r = await cli(home(srv.url), ['nick', 'Peti']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].method, 'PUT');
  assert.equal(srv.requests[0].url, '/api/v1/me/nickname');
  assert.deepEqual(srv.requests[0].body, { nickname: 'Peti' });
  assert.ok(r.stdout.includes('Peti'));
});

test('share-item', async () => {
  const srv = await recorder(() => [200, { item_id: 12, cowork_id: 3 }]);
  const r = await cli(home(srv.url), ['share-item', '12', 'Peti']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].method, 'POST');
  assert.equal(srv.requests[0].url, '/api/v1/items/12/share');
  assert.deepEqual(srv.requests[0].body, { nickname: 'Peti' });
  assert.ok(r.stdout.includes('#12') && r.stdout.includes('Peti'));
});

test('nick argumentum nélkül kiírja a becenevet', async () => {
  const srv = await recorder(() => [200, { email: 'a@b.c', nickname: 'Peti' }]);
  const r = await cli(home(srv.url), ['nick']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].method, 'GET');
  assert.ok(r.stdout.includes('Peti'));
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
  assert.equal(srv.requests[0].url, '/api/v1/projects/offtrack/items?cowork=1');
  assert.equal(r.stdout, '#1 offtrack\n  #7 teszt\n');
});

test('list: munkatárs blokk', async () => {
  const srv = await recorder(() => [200, {
    threads: [{ id: 1, title: 'offtrack', items: [{ id: 7, kind: 'branch', text: 'teszt', status: 'open' }] }],
    cowork: [{ nickname: 'Peti', threads: [
      { id: 212, title: 'API-bővítés', items: [{ id: 9, kind: 'branch', text: 'végpont', status: 'in_progress' }] },
      { id: 210, title: null, items: [{ id: 8, kind: 'manual', text: 'kulcs', status: 'open' }] },
    ] }],
  }]);
  const r = await cli(home(srv.url), ['list', 'offtrack']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].url, '/api/v1/projects/offtrack/items?cowork=1');
  assert.equal(r.stdout, '#1 offtrack\n  #7 teszt\n\n#212 API-bővítés · Peti\n  #9 végpont [folyamatban]\n#210 fő szál · Peti\n  #8 kulcs [kézi]\n');
});

test('list a session projektjével, ismeretlen sessionnél hiba', async () => {
  const srv = await recorder((req) => (req.url.startsWith('/api/v1/sessions/by-pid/')
    ? [200, { session_id: 's1', project: { slug: 'greengo', name: 'greengo' } }] : [200, []]));
  const r = await cli(home(srv.url), ['list']);
  await srv.close();
  assert.equal(srv.requests[1].url, '/api/v1/projects/greengo/items?cowork=1');
  assert.equal(r.stdout, 'Nincs nyitott tétel.\n');

  const srv2 = await recorder(() => [404, { error: 'nincs ilyen session' }]);
  const r2 = await cli(home(srv2.url), ['list']);
  await srv2.close();
  assert.equal(r2.status, 1);
  assert.ok(r2.stderr.includes('add meg a projektet'));
});

test('version: a telepített és a legfrissebb verzió', async () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const srv = await recorder(() => [200, { latest: '9.9.9' }]);
  const r = await cli(home(srv.url), ['version']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.match(r.stdout, new RegExp(version.replace(/\./g, '\\.')));
  assert.match(r.stdout, /9\.9\.9/);
  assert.match(r.stdout, /npm install -g github:offsite-solutions\/offtrack-client/);
  assert.equal(srv.requests[0].url, '/api/v1/client/latest');
});

test('version: a szerver régebbi verziót ismer, nincs frissítési ajánlat', async () => {
  const srv = await recorder(() => [200, { latest: '0.0.1' }]);
  const r = await cli(home(srv.url), ['version']);
  await srv.close();
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('Ez a legfrissebb verzió.'));
  assert.ok(!r.stdout.includes('0.0.1'));
});

test('offtrack move', async () => {
  const srv = await recorder(() => [200, { id: 5 }]);
  const dir = home(srv.url);
  const r = await cli(dir, ['move', '5', 'futureal']);
  const bad = await cli(dir, ['move', 'x', 'futureal']);
  await srv.close();
  assert.equal(srv.requests[0].method, 'POST');
  assert.equal(srv.requests[0].url, '/api/v1/items/5/move');
  assert.deepEqual(srv.requests[0].body, { project: 'futureal' });
  assert.equal(r.status, 0);
  assert.equal(bad.status, 2);
  assert.equal(srv.requests.length, 1);
});

function repoDir(dir) {
  const repo = mkdtempSync(join(tmpdir(), 'ot-repo-'));
  for (const a of [['init', '-q'], ['remote', 'add', 'origin', 'git@github.com:acme/secret-repo.git']]) execFileSync('git', ['-C', repo, ...a]);
  writeFileSync(join(dir, 'repo-salt'), 'SO');
  return repo;
}

test('coworkers: a lenyomattal kérdez', async () => {
  const srv = await recorder(() => [200, [{ nickname: 'Anna', level: 'project' }, { nickname: 'Peti', level: null }]]);
  const dir = home(srv.url);
  const repo = repoDir(dir);
  const r = await cli(dir, ['coworkers', repo]);
  await srv.close();
  assert.equal(r.status, 0);
  assert.match(srv.requests[0].url, /^\/api\/v1\/coworkers\?hash=[0-9a-f]{64}$/);
  assert.equal(srv.requests[0].url.includes('github.com'), false);
  assert.equal(r.stdout, 'Anna (project)\nPeti\n');
});

test('coworkers: üres lista, és nem repó könyvtár', async () => {
  const srv = await recorder(() => [200, []]);
  const dir = home(srv.url);
  const repo = repoDir(dir);
  const r = await cli(dir, ['coworkers', repo]);
  const bad = await cli(dir, ['coworkers', tmpdir()]);
  await srv.close();
  assert.ok(r.stdout.includes('Ezen a repón más, becenévvel rendelkező felhasználó nem dolgozik.'));
  assert.equal(bad.status, 1);
  assert.equal(srv.requests.length, 1);
});

// A GET /coworks válasza; a többi kérésre a megadott válasz.
const COWORKS = {
  coworks: [{ id: 7, nickname: 'Trinity', level: 'project', project: 'matrix' }, { id: 8, nickname: 'Trinity', level: 'task', project: 'zion' },
    { id: 9, nickname: 'Morpheus', level: 'task', project: 'zion' }],
  incoming: [{ id: 21, nickname: 'Neo', level: 'project', project: null }],
  outgoing: [{ id: 22, nickname: 'Morpheus', level: 'project', project: 'matrix' }],
};
const coworkServer = (reply = [200, {}]) => recorder((req) => (req.method === 'GET' ? [200, COWORKS] : reply));

test('cowork list', async () => {
  const srv = await coworkServer();
  const r = await cli(home(srv.url), ['cowork', 'list']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].url, '/api/v1/coworks');
  for (const s of ['Trinity', 'matrix', 'zion', 'Morpheus', 'Neo', 'offtrack cowork accept Neo']) assert.ok(r.stdout.includes(s), s);
});

test('cowork <becenév> project: felkérés a saját projekttel', async () => {
  const srv = await recorder(() => [200, { id: 30, nickname: 'Neo', level: 'project', project: 'matrix' }]);
  const r = await cli(home(srv.url), ['cowork', 'Neo', 'project', '--project', 'matrix']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[0].method, 'POST');
  assert.equal(srv.requests[0].url, '/api/v1/coworks/requests');
  assert.deepEqual(srv.requests[0].body, { nickname: 'Neo', project: 'matrix' });
  // --project nélkül: hiba, kérés nélkül
  const srv2 = await recorder();
  const r2 = await cli(home(srv2.url), ['cowork', 'Neo', 'project']);
  await srv2.close();
  assert.equal(r2.status, 1);
  assert.equal(srv2.requests.length, 0);
});

test('cowork <becenév> task és end: a becenév és a saját projekt szerinti együttműködés', async () => {
  const srv = await coworkServer([200, { id: 9, nickname: 'Morpheus', level: 'task', project: 'zion' }]);
  const r = await cli(home(srv.url), ['cowork', 'morpheus', 'task']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(srv.requests[1].method, 'PATCH');
  assert.equal(srv.requests[1].url, '/api/v1/coworks/9');
  assert.deepEqual(srv.requests[1].body, { level: 'task' });
  const e = await cli(home(srv.url), ['cowork', 'Trinity', 'end', '--project', 'Zion']);
  await srv.close();
  assert.equal(e.status, 0, e.stderr);
  assert.equal(srv.requests[3].method, 'DELETE');
  assert.equal(srv.requests[3].url, '/api/v1/coworks/8');
});

test('több pár --project nélkül: hiba', async () => {
  const srv = await coworkServer();
  const r = await cli(home(srv.url), ['cowork', 'Trinity', 'end']);
  await srv.close();
  assert.equal(r.status, 1);
  assert.equal(srv.requests.length, 1);
  assert.ok(r.stderr.includes('matrix') && r.stderr.includes('zion') && r.stderr.includes('--project'), r.stderr);
  // ismeretlen becenév: hiba
  const srv2 = await coworkServer();
  const r2 = await cli(home(srv2.url), ['cowork', 'Senki', 'task']);
  await srv2.close();
  assert.equal(r2.status, 1);
  assert.equal(srv2.requests.length, 1);
});

test('cowork accept és decline', async () => {
  const srv = await coworkServer([200, { id: 40, nickname: 'Neo', level: 'project', project: 'matrix' }]);
  const a = await cli(home(srv.url), ['cowork', 'accept', 'Neo', '--project', 'matrix']);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(srv.requests[1].url, '/api/v1/coworks/requests/21/accept');
  assert.deepEqual(srv.requests[1].body, { project: 'matrix' });
  const a2 = await cli(home(srv.url), ['cowork', 'accept', 'Neo']);
  assert.equal(a2.status, 0, a2.stderr);
  assert.deepEqual(srv.requests[3].body, {});
  const d = await cli(home(srv.url), ['cowork', 'decline', 'neo']);
  await srv.close();
  assert.equal(d.status, 0, d.stderr);
  assert.equal(srv.requests[5].method, 'POST');
  assert.equal(srv.requests[5].url, '/api/v1/coworks/requests/21/decline');
});

test('list: a származás, munkatárstól kapottnál becenévvel', async () => {
  const srv = await recorder(() => [200, { threads: [{ id: 1, title: 'offtrack', items: [
    { id: 7, kind: 'branch', text: 'kapott', status: 'open', origin: { nickname: 'Neo', item_id: 4 } },
    { id: 8, kind: 'branch', text: 'átadott', status: 'open', origin: { project: 'zion', item_id: null } },
  ] }], cowork: [] }]);
  const r = await cli(home(srv.url), ['list', 'offtrack']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '#1 offtrack\n  #7 kapott [← Neo: #4]\n  #8 átadott [← zion]\n');
});

test('cowork decline: a becenév nélküli felkérés nem akasztja meg', async () => {
  const srv = await recorder((req) => (req.method === 'GET'
    ? [200, { coworks: [], incoming: [{ id: 30, nickname: null, level: 'project', project: null }, { id: 21, nickname: 'Neo', level: 'project', project: null }], outgoing: [] }]
    : [200, {}]));
  const d = await cli(home(srv.url), ['cowork', 'decline', 'Neo']);
  await srv.close();
  assert.equal(d.status, 0, d.stderr);
  assert.equal(srv.requests[1].url, '/api/v1/coworks/requests/21/decline');
});

test('cowork list: a becenév nélküli régi felkérés nem „null”', async () => {
  const srv = await recorder(() => [200, { coworks: [], incoming: [{ id: 30, nickname: null, level: 'project', project: null }], outgoing: [] }]);
  const r = await cli(home(srv.url), ['cowork', 'list']);
  await srv.close();
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('null'), r.stdout);
  assert.match(r.stdout, /\((no nickname|nincs becenév)\)/);
  assert.ok(!r.stdout.includes('cowork accept'), r.stdout);
});
