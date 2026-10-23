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
