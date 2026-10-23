#!/usr/bin/env node
// offtrack telepítő: hookok a ~/.claude/settings.json-ba, MCP szerver felhasználói szinten,
// szabályok a ~/.claude/CLAUDE.md-be, és egy `offtrack` parancs a ~/.local/bin-be.
// Használat: node install.mjs install|uninstall [--settings <fájl>] [--claude-md <fájl>]
// A --settings / --claude-md kapcsolóval csak a megadott fájlokat javítja (próba másolaton).
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'SessionEnd'];
// A saját hookjaink felismerése: a monorepóból (…/offtrack/client/hook.mjs) vagy a publikus klónból
// (…/offtrack-client/hook.mjs) telepített hook; más eszköz hook.mjs-ét nem érinti.
const OURS = /\/offtrack(\/client|-client)\/hook\.mjs\b/;
const START = '<!-- offtrack:start -->';
const END = '<!-- offtrack:end -->';

const isOurs = (h) => typeof h?.command === 'string' && OURS.test(h.command);

export function unpatchSettings(settings) {
  const out = structuredClone(settings);
  if (!out.hooks) return out;
  for (const [event, groups] of Object.entries(out.hooks)) {
    const kept = groups.map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) })).filter((g) => g.hooks.length > 0);
    if (kept.length > 0) out.hooks[event] = kept;
    else delete out.hooks[event];
  }
  if (Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

export function patchSettings(settings, cmd) {
  const out = unpatchSettings(settings);
  out.hooks ??= {};
  for (const e of EVENTS) out.hooks[e] = [...(out.hooks[e] ?? []), { hooks: [{ type: 'command', command: cmd, timeout: 5 }] }];
  return out;
}

export function patchClaudeMd(text, block) {
  const wrapped = `${START}\n${block}${END}`;
  const i = text.indexOf(START);
  const j = text.indexOf(END);
  if (i >= 0 && j > i) return text.slice(0, i) + wrapped + text.slice(j + END.length);
  return `${text}\n${wrapped}\n`;
}

export function unpatchClaudeMd(text) {
  const i = text.indexOf(START);
  const j = text.indexOf(END);
  if (i < 0 || j < i) return text;
  let before = text.slice(0, i);
  let after = text.slice(j + END.length);
  if (after.startsWith('\n')) after = after.slice(1);
  if (before.endsWith('\n\n')) before = before.slice(0, -1);
  return before + after;
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function rewrite(file, fn) {
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  const after = fn(before);
  if (after === before) return;
  if (before !== null) copyFileSync(file, `${file}.bak-offtrack-${stamp()}`);
  writeFileSync(file, after);
  console.log(`módosítva: ${file}`);
}

function mcpRegistered() {
  try { return execFileSync('claude', ['mcp', 'get', 'offtrack'], { stdio: ['ignore', 'pipe', 'ignore'] }).length > 0; } catch { return false; }
}

function run(cmd, opts) {
  const settingsFile = opts.settings ?? join(homedir(), '.claude', 'settings.json');
  const claudeMd = opts.claudeMd ?? join(homedir(), '.claude', 'CLAUDE.md');
  const filesOnly = Boolean(opts.settings || opts.claudeMd);
  const hookCmd = `node ${join(HERE, 'hook.mjs')}`;
  const block = readFileSync(join(HERE, 'claude-md.md'), 'utf8');

  if (cmd === 'install') {
    rewrite(settingsFile, (t) => JSON.stringify(patchSettings(JSON.parse(t ?? '{}'), hookCmd), null, 2) + '\n');
    rewrite(claudeMd, (t) => patchClaudeMd(t ?? '', block));
    if (filesOnly) return;
    if (!mcpRegistered()) execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'offtrack', '--', 'node', join(HERE, 'mcp.mjs')], { stdio: 'inherit' });
    const conf = join(homedir(), '.config', 'offtrack');
    mkdirSync(conf, { recursive: true, mode: 0o700 });
    if (!existsSync(join(conf, 'config.json'))) writeFileSync(join(conf, 'config.json'), JSON.stringify({ url: 'https://offtrack.offsite-solutions.com' }) + '\n', { mode: 0o600 });
    const bin = join(homedir(), '.local', 'bin');
    mkdirSync(bin, { recursive: true });
    const link = join(bin, 'offtrack');
    try { lstatSync(link); unlinkSync(link); } catch { /* nincs még */ }
    symlinkSync(join(HERE, 'bin', 'offtrack.mjs'), link);
    console.log(`parancs: ${link}`);
    // A skill a tároló könyvtárára mutató link, így a tároló frissítése azonnal érvényes.
    const skills = join(homedir(), '.claude', 'skills');
    mkdirSync(skills, { recursive: true });
    const skill = join(skills, 'offtrack');
    try {
      if (lstatSync(skill).isSymbolicLink()) unlinkSync(skill);
      else console.log(`kihagyva: ${skill} létezik, és nem link`);
    } catch { /* nincs még */ }
    if (!existsSync(skill)) { symlinkSync(join(HERE, 'skill'), skill); console.log(`skill: ${skill}`); }
  } else {
    rewrite(settingsFile, (t) => (t === null ? null : JSON.stringify(unpatchSettings(JSON.parse(t)), null, 2) + '\n'));
    rewrite(claudeMd, (t) => (t === null ? null : unpatchClaudeMd(t)));
    if (filesOnly) return;
    if (mcpRegistered()) execFileSync('claude', ['mcp', 'remove', '--scope', 'user', 'offtrack'], { stdio: 'inherit' });
    try { unlinkSync(join(homedir(), '.local', 'bin', 'offtrack')); } catch { /* nincs */ }
    const skill = join(homedir(), '.claude', 'skills', 'offtrack');
    try { if (lstatSync(skill).isSymbolicLink() && readlinkSync(skill) === join(HERE, 'skill')) unlinkSync(skill); } catch { /* nincs */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === '--settings') opts.settings = rest[i + 1];
    else if (rest[i] === '--claude-md') opts.claudeMd = rest[i + 1];
  }
  if (!['install', 'uninstall'].includes(cmd)) {
    console.error('Használat: node install.mjs install|uninstall [--settings <fájl>] [--claude-md <fájl>]');
    process.exit(2);
  }
  run(cmd, opts);
}
