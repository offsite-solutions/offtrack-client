import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { recorder, home } from './helpers.mjs';

const api = await import('../lib/api.mjs');
const lines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
function setup(url, ids) {
  const dir = home(url);
  process.env.OFFTRACK_HOME = dir;
  writeFileSync(join(dir, 'queue.jsonl'), ids.map((id) =>
    JSON.stringify({ id, path: '/api/v1/events', method: 'POST', body: { event: 'PostToolUse', session_id: id, cwd: '/w' } }) + '\n').join(''));
  return dir;
}
const sent = (srv) => srv.requests.map((r) => r.body.session_id);

test('a sikeres elemek azonnal kikerülnek, a keret leállítja a kiürítést', async () => {
  const srv = await recorder((req, body) => (body.session_id === 'b' ? [200, {}, 1500] : [200, {}]));
  const dir = setup(srv.url, ['a', 'b', 'c']);
  await api.flushQueue({ timeoutMs: 1000, budgetMs: 800 });
  await srv.close();
  assert.deepEqual(lines(join(dir, 'queue.jsonl')).map((q) => q.id), ['b', 'c']);
});

test('párhuzamos kiürítés nem veszít elemet', async () => {
  let dir;
  const srv = await recorder((req, body) => {
    if (body.session_id === 'a') {
      // egy másik kiürítő közben elküldte és kivette a b-t
      const q = lines(join(dir, 'queue.jsonl')).filter((x) => x.id !== 'b');
      writeFileSync(join(dir, 'queue.jsonl'), q.map((x) => JSON.stringify(x) + '\n').join(''));
    }
    return [200, {}];
  });
  dir = setup(srv.url, ['a', 'b', 'c']);
  await api.flushQueue({ timeoutMs: 1000, budgetMs: 5000 });
  await srv.close();
  assert.ok(sent(srv).includes('c'));
  assert.deepEqual(lines(join(dir, 'queue.jsonl')), []);
});

test('tartós 5xx után az elem félrekerül, a sor halad', async () => {
  const srv = await recorder((req, body) => (body.session_id === 'a' ? [500, {}] : [200, {}]));
  const dir = setup(srv.url, ['a', 'b']);
  for (let i = 0; i < 5; i++) await api.flushQueue({ timeoutMs: 1000, budgetMs: 2000, force: true });
  await api.flushQueue({ timeoutMs: 1000, budgetMs: 2000, force: true });
  await srv.close();
  assert.deepEqual(lines(join(dir, 'queue.jsonl')), []);
  assert.deepEqual(lines(join(dir, 'dead.jsonl')).map((q) => q.id), ['a']);
  assert.ok(sent(srv).includes('b'));
});

test('401 nem dobja el az elemet', async () => {
  const srv = await recorder(() => [401, { error: 'jogosulatlan' }]);
  const dir = setup(srv.url, ['a']);
  await api.flushQueue({ timeoutMs: 1000, budgetMs: 2000, force: true });
  await srv.close();
  assert.deepEqual(lines(join(dir, 'queue.jsonl')).map((q) => q.id), ['a']);
});

test('400 félrekerül', async () => {
  const srv = await recorder(() => [400, { error: 'hibás' }]);
  const dir = setup(srv.url, ['a']);
  await api.flushQueue({ timeoutMs: 1000, budgetMs: 2000, force: true });
  await srv.close();
  assert.deepEqual(lines(join(dir, 'queue.jsonl')), []);
  assert.deepEqual(lines(join(dir, 'dead.jsonl')).map((q) => q.id), ['a']);
});

test('hálózati hiba után szünet: nincs újabb hálózati kísérlet', async () => {
  setup('http://127.0.0.1:9', []);
  assert.equal((await api.send('/api/v1/projects', { method: 'GET', timeoutMs: 500 })).ok, false);
  const srv = await recorder(() => [200, []]);
  writeFileSync(join(process.env.OFFTRACK_HOME, 'config.json'), JSON.stringify({ url: srv.url }));
  assert.equal((await api.send('/api/v1/projects', { method: 'GET', timeoutMs: 500 })).ok, false);
  assert.equal(srv.requests.length, 0);
  assert.equal((await api.send('/api/v1/projects', { method: 'GET', timeoutMs: 500, force: true })).ok, true);
  await srv.close();
});
