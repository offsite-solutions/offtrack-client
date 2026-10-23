import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utimesSync } from 'node:fs';
import { listSessions, condense, groupByProject } from '../lib/backfill/sessions.mjs';

const root = new URL('./fixtures/backfill/', import.meta.url).pathname;
const now = new Date();
for (const f of ['proj-a/s1.jsonl', 'proj-a/s2.jsonl']) utimesSync(root + f, now, now);

test('listSessions', () => {
  const s = listSessions({ root, days: 60, now });
  const s1 = s.find((x) => x.sessionId === 's1');
  assert.equal(s1.cwd, '/w/greengo/backend');
  assert.equal(s1.prompts, 2);
  assert.equal(s.find((x) => x.sessionId === 's2').prompts, 1);
});

test('régi fájl kimarad', () => {
  assert.equal(listSessions({ root, days: 60, now: new Date(now.getTime() + 90 * 86400000) }).length, 0);
});

test('condense: csak promptok és szöveges válaszok', () => {
  const c = condense(root + 'proj-a/s1.jsonl');
  assert.ok(c.includes('Felhasználó: Készítsd el a release-t'));
  assert.ok(c.includes('Claude: Elkészült a 2.4 release.'));
  assert.ok(!c.includes('TOOL-KIMENET'));
  assert.ok(!c.includes('titkos gondolat'));
});

test('condense: a limit fölött a közepe kimarad', () => {
  const c = condense(root + 'proj-a/s1.jsonl', { limit: 60 });
  assert.ok(c.length < 140);
  assert.ok(c.includes('[… kihagyva …]'));
});

test('groupByProject: a hosszabb gyökér nyer, különben a cwd vége', () => {
  const s = listSessions({ root, days: 60, now });
  const g = groupByProject(s, [{ name: 'greengo', paths: ['/w/greengo'] }, { name: 'backend', paths: ['/w/greengo/backend'] }]);
  assert.deepEqual([...g.keys()].sort(), ['backend', 'greengo']);
  const g2 = groupByProject(s, []);
  assert.deepEqual([...g2.keys()].sort(), ['backend', 'greengo']);
});
