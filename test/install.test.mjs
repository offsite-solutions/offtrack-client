import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchSettings, unpatchSettings, patchClaudeMd, unpatchClaudeMd } from '../install.mjs';

const base = { theme: 'dark', hooks: {
  PreToolUse: [{ matcher: 'Grep|Glob|Read|Search', hooks: [{ type: 'command', command: '~/.claude/hooks/cbm-code-discovery-gate' }] }],
  SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '~/.claude/hooks/cbm-session-reminder' }] }],
}};
const CMD = 'node /Users/dev/Work/offtrack/client/hook.mjs';
const BLOCK = '## Feladatkövetés (offtrack)\n\nszabályok\n';

test('patchSettings megtartja a meglévőt és idempotens', () => {
  const p = patchSettings(base, CMD);
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']) assert.ok(p.hooks[e], e);
  assert.deepEqual(p.hooks.SessionStart[0], base.hooks.SessionStart[0]);
  assert.equal(p.hooks.SessionStart.length, 2);
  assert.deepEqual(patchSettings(p, CMD), p);
});

test('unpatchSettings visszaállít', () => {
  assert.deepEqual(unpatchSettings(patchSettings(base, CMD)), base);
});

test('patchClaudeMd hozzáfűz', () => {
  const t = '# Írás\nszöveg\n';
  const p = patchClaudeMd(t, BLOCK);
  assert.ok(p.startsWith(t));
  assert.ok(p.includes(`<!-- offtrack:start -->\n${BLOCK}<!-- offtrack:end -->`));
});

test('patchClaudeMd csere', () => {
  const t = 'elöl\n';
  const once = patchClaudeMd(t, BLOCK) + 'utána\n';
  const twice = patchClaudeMd(once, '## új\n');
  assert.equal(twice.split('<!-- offtrack:start -->').length, 2);
  assert.equal(twice.split('<!-- offtrack:end -->').length, 2);
  assert.ok(twice.startsWith('elöl\n'));
  assert.ok(twice.endsWith('<!-- offtrack:end -->\nutána\n'));
  assert.ok(twice.includes('## új\n'));
  assert.ok(!twice.includes('szabályok'));
});

test('unpatchClaudeMd', () => {
  const t = '# Írás\nszöveg\n';
  assert.equal(unpatchClaudeMd(patchClaudeMd(t, BLOCK)), t);
});

test('a skill frontmattere', async () => {
  const { readFileSync } = await import('node:fs');
  const t = readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8');
  assert.equal(t.split('\n')[0], '---');
  assert.match(t, /^name: offtrack$/m);
  assert.match(t, /^description: \S/m);
});

test('a CLAUDE.md-blokk utal a skillre és nem említi Lászlót', async () => {
  const { readFileSync } = await import('node:fs');
  const t = readFileSync(new URL('../claude-md.md', import.meta.url), 'utf8');
  assert.ok(t.includes('`offtrack` skillt'));
  assert.ok(!t.includes('László'));
});

test('a publikus klónból telepítve a régi útvonalú hookok cserélődnek, az idegenek maradnak', () => {
  const NEW = 'node /Users/anna/src/offtrack-client/hook.mjs';
  const p = patchSettings(patchSettings(base, CMD), NEW);
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd']) {
    const cmds = p.hooks[e].flatMap((g) => g.hooks.map((h) => h.command));
    assert.equal(cmds.filter((c) => c.endsWith('hook.mjs')).length, 1, e);
    assert.ok(cmds.includes(NEW), e);
  }
  assert.deepEqual(unpatchSettings(p), base);
  const foreign = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /x/other-tool/hook.mjs' }] }] } };
  assert.deepEqual(unpatchSettings(foreign), foreign);
});

test('a globális npm-csomagból telepített hook a klónból telepítettet váltja', () => {
  const NPM = 'node /opt/homebrew/lib/node_modules/offtrack-client/hook.mjs';
  const p = patchSettings(patchSettings(base, CMD), NPM);
  assert.deepEqual(p.hooks.Stop.flatMap((g) => g.hooks.map((h) => h.command)), [NPM]);
  assert.deepEqual(unpatchSettings(p), base);
});

import { chooseLang } from '../install.mjs';
import { readFileSync as rf, mkdtempSync as mkt, writeFileSync as wf } from 'node:fs';
import { tmpdir as td } from 'node:os';
import { join as jn } from 'node:path';
import { execFileSync as ex } from 'node:child_process';

test('nyelv: a kapcsoló, majd a mentett, végül az angol', () => {
  assert.equal(chooseLang(undefined, undefined), 'en');
  assert.equal(chooseLang(undefined, 'hu'), 'hu');
  assert.equal(chooseLang(undefined, 'en'), 'en');
  assert.equal(chooseLang('hu', 'en'), 'hu');
  assert.throws(() => chooseLang('de', undefined), /hu, en/);
});

test('az angol blokk angol jelentést kér, és ugyanúgy utal a skillre', () => {
  const en = rf(new URL('../claude-md.en.md', import.meta.url), 'utf8');
  assert.ok(en.includes('in English'));
  assert.ok(!/magyar|Megálló/.test(en));
  for (const k of ['offtrack_report', 'offtrack_update', 'offtrack_link', 'offtrack_new_thread', 'kind: stop', 'kind: branch', 'kind: manual', 'kind: idea', '`offtrack` skill']) assert.ok(en.includes(k), k);
});

test('install --lang en az angol blokkot írja be', () => {
  const dir = mkt(jn(td(), 'offtrack-lang-'));
  const md = jn(dir, 'CLAUDE.md'); const st = jn(dir, 'settings.json');
  wf(md, '# saját\n'); wf(st, '{}');
  const inst = new URL('../install.mjs', import.meta.url).pathname;
  ex('node', [inst, 'install', '--settings', st, '--claude-md', md, '--lang', 'en']);
  assert.ok(rf(md, 'utf8').includes('in English'));
  ex('node', [inst, 'install', '--settings', st, '--claude-md', md, '--lang', 'hu']);
  assert.ok(rf(md, 'utf8').includes('magyarul'));
});

test('az angol skill ugyanazokat a műveleteket írja le', () => {
  const hu = rf(new URL('../skill/SKILL.md', import.meta.url), 'utf8');
  const en = rf(new URL('../skills/offtrack/SKILL.md', import.meta.url), 'utf8');
  assert.match(en, /^---\nname: offtrack\n/);
  // a kódként jelölt parancsok és toolok (`offtrack merge …`, `offtrack_update …`) első két szava
  const cmds = (t) => [...new Set([...t.matchAll(/`(offtrack(?:_[a-z_]+|(?: [a-z]+){1,2}))/g)].map((m) => m[1]))].sort();
  assert.deepEqual(cmds(en), cmds(hu));
});
