import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slash, claudeLine } from '../lib/platform.mjs';
import { findClaude, parseWinProcs } from '../lib/proc.mjs';
import { hookCommand, patchSettings, unpatchSettings } from '../install.mjs';

test('slash: Windowson perjeles útvonal, máshol változatlan', () => {
  assert.equal(slash('C:\\Users\\Dev Name\\proj', true), 'C:/Users/Dev Name/proj');
  assert.equal(slash('/Users/dev/a\\b', false), '/Users/dev/a\\b');
  assert.equal(slash(undefined, true), undefined);
});

test('claudeLine: a szóközös és az üres argumentum idézőjelbe kerül', () => {
  assert.equal(claudeLine(['mcp', 'add', '--', 'node', 'C:\\Users\\Dev Name\\mcp.mjs']), 'claude mcp add -- node "C:\\Users\\Dev Name\\mcp.mjs"');
  assert.equal(claudeLine(['-p', '--tools', '']), 'claude -p --tools ""');
});

test('hookCommand: macOS-en a korábbi alak, Windowson idézőjeles, perjeles útvonal', () => {
  assert.equal(hookCommand('/Users/dev/Work/offtrack/client', false), 'node /Users/dev/Work/offtrack/client/hook.mjs');
  const win = hookCommand('C:\\Users\\Dev Name\\AppData\\Roaming\\npm\\node_modules\\offtrack-client', true);
  assert.equal(win, 'node "C:/Users/Dev Name/AppData/Roaming/npm/node_modules/offtrack-client/hook.mjs"');
});

test('a Windows-hookot az eltávolítás is felismeri', () => {
  const cmd = hookCommand('C:\\Users\\dev\\AppData\\Roaming\\npm\\node_modules\\offtrack-client', true);
  const base = { theme: 'dark' };
  assert.deepEqual(unpatchSettings(patchSettings(base, cmd)), base);
});

test('findClaude: a lánc első claude folyamata, különben a kiinduló', () => {
  const procs = parseWinProcs('100 1 explorer.exe\r\n200 100 Claude.exe\r\n300 200 bash.exe\r\n400 300 node.exe\r\n');
  const lookup = (pid) => procs.get(pid) ?? null;
  assert.equal(findClaude(400, lookup), 200);
  assert.equal(findClaude(100, lookup), 100);
  assert.equal(findClaude(999, lookup), 999);
});
