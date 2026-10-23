import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { recorder, home } from './helpers.mjs';

const CLI = new URL('../bin/offtrack.mjs', import.meta.url).pathname;
const run = (dir, args) => new Promise((resolve) => {
  const c = spawn('node', [CLI, ...args], { env: { ...process.env, OFFTRACK_HOME: dir, CLAUDE_CODE_SESSION_ID: '' } });
  c.stdin.end('');
  let stdout = ''; let stderr = '';
  c.stdout.on('data', (d) => { stdout += d; });
  c.stderr.on('data', (d) => { stderr += d; });
  c.on('close', (status) => resolve({ status, stdout, stderr }));
});
const english = (url) => { const d = home(url); writeFileSync(join(d, 'config.json'), JSON.stringify({ url, lang: 'en' })); return d; };

test('angol kliens: a nyelvet elküldi, és angolul válaszol', async () => {
  const srv = await recorder(() => [200, { id: 1, slug: 'p', name: 'greengo', display_name: null }]);
  const r = await run(english(srv.url), ['rename', 'greengo', '']);
  await srv.close();
  assert.equal(srv.requests[0].headers['x-offtrack-lang'], 'en');
  assert.match(r.stdout, /^Display name removed: greengo/);
});

test('angol súgó és hibaüzenet', async () => {
  const srv = await recorder(() => [404, { error: 'No such project: x' }]);
  const dir = english(srv.url);
  const help = await run(dir, ['nincs-ilyen-parancs']);
  assert.match(help.stderr, /^Usage:/);
  assert.doesNotMatch(help.stderr, /Használat|projekt/);
  const err = await run(dir, ['merge', 'x', 'y']);
  await srv.close();
  assert.match(err.stderr, /^Error: No such project: x/);
});

test('angol az alapértelmezés, a magyar választható', async () => {
  const srv = await recorder(() => [200, {}]);
  const plain = home(srv.url);
  writeFileSync(join(plain, 'config.json'), JSON.stringify({ url: srv.url }));
  const r = await run(plain, ['nincs-ilyen-parancs']);
  assert.match(r.stderr, /^Usage:/);
  const hu = await run(home(srv.url), ['nincs-ilyen-parancs']);
  await srv.close();
  assert.match(hu.stderr, /^Használat:/);
});
