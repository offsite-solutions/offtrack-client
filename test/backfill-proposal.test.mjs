import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeProposal, parseProposal } from '../lib/backfill/proposal.mjs';

const threads = [
  { title: 'backend release', items: [
    { kind: 'branch', text: 'Partnerportál-jogosultságok rendezése', date: '2026-09-14' },
    { kind: 'stop', text: 'Backend 2.4 kiadva', date: '2026-09-12' },
  ] },
  { title: null, items: [{ kind: 'idea', text: 'Offline mód a sofőr-appban', date: '2026-09-21' }] },
];
const base = { project: 'greengo', cwd: '/Users/dev/Work/greengo', sessions: 14, from: '2026-08-24', threads };

test('oda-vissza ugyanazt adja, időrendben', () => {
  const text = writeProposal(base);
  assert.ok(text.includes('# offTrack-javaslat: greengo'));
  assert.ok(text.includes('offtrack import ~/offtrack-backfill/greengo.md'));
  const p = parseProposal(text);
  assert.equal(p.project, 'greengo');
  assert.equal(p.cwd, '/Users/dev/Work/greengo');
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.threads, [
    { title: 'backend release', items: [
      { kind: 'stop', text: 'Backend 2.4 kiadva', date: '2026-09-12' },
      { kind: 'branch', text: 'Partnerportál-jogosultságok rendezése', date: '2026-09-14' },
    ] },
    { title: null, items: [{ kind: 'idea', text: 'Offline mód a sofőr-appban', date: '2026-09-21' }] },
  ]);
});

test('a törölt sor kimarad', () => {
  const text = writeProposal(base).replace('- megálló 2026-09-12: Backend 2.4 kiadva\n', '');
  assert.equal(parseProposal(text).threads[0].items.length, 1);
});

test('elírt típus: figyelmeztetés sorszámmal', () => {
  const text = writeProposal(base) + '- ágg 2026-09-01: x\n';
  const n = text.split('\n').indexOf('- ágg 2026-09-01: x') + 1;
  const p = parseProposal(text);
  assert.deepEqual(p.warnings, [`${n}. sor: nem értelmezhető`]);
});

test('rossz dátum: figyelmeztetés', () => {
  const text = writeProposal(base) + '- ág 2026-13-40: x\n';
  const p = parseProposal(text);
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0], /^\d+\. sor: nem értelmezhető$/);
  assert.equal(p.threads[1].items.length, 1);
});

test('a kihagyott régebbi sessionök a fejlécben', () => {
  assert.ok(writeProposal({ ...base, omitted: 3 }).includes('3 régebbi session kimaradt'));
});

test('fejléc nélkül hiba', () => {
  assert.throws(() => parseProposal('## Szál: (alap)\n- ág 2026-09-01: x\n'), /fejléc/);
});
