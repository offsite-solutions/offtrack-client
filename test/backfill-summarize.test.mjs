import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, summarize } from '../lib/backfill/summarize.mjs';

const ok = { threads: [{ title: null, items: [{ kind: 'stop', text: 'kész', date: '2026-10-01' }] }] };
const wrapCli = (s) => JSON.stringify({ type: 'result', result: s });

test('a prompt tartalmazza a projektet és a csak-JSON kérést', () => {
  const p = buildPrompt('greengo', ['[2026-10-01 09:00] Felhasználó: x']);
  assert.ok(p.includes('greengo'));
  assert.ok(p.includes('csak JSON'));
  assert.ok(p.includes('[2026-10-01 09:00] Felhasználó: x'));
});

test('JSON-válasz feldolgozása', async () => {
  const r = await summarize('p', ['x'], { run: async () => wrapCli(JSON.stringify(ok)) });
  assert.deepEqual(r, ok);
});

test('```json``` blokk kivágása', async () => {
  const r = await summarize('p', ['x'], { run: async () => wrapCli('Íme:\n```json\n' + JSON.stringify(ok) + '\n```') });
  assert.deepEqual(r, ok);
});

test('érthetetlen válasz', async () => {
  await assert.rejects(summarize('greengo', ['x'], { run: async () => wrapCli('nem tudom') }), /greengo összefoglalója nem értelmezhető/);
});
