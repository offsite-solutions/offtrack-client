import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_URL = 'https://offtrack.offsite-solutions.com';

export function home() {
  const dir = process.env.OFFTRACK_HOME || join(homedir(), '.config', 'offtrack');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function read(file) {
  try { return readFileSync(file, 'utf8').trim(); } catch { return null; }
}

export function config() {
  let saved = {};
  try { saved = JSON.parse(read(join(home(), 'config.json')) ?? '{}'); } catch { /* alapérték */ }
  const url = saved.url ?? DEFAULT_URL;
  return { url: url.replace(/\/+$/, ''), token: read(join(home(), 'client-token')), lang: saved.lang === 'hu' ? 'hu' : 'en' };
}

// A kliens nyelve (a telepítéskor választott, alapból angol) és egy kétnyelvű szöveg kiválasztása.
export const lang = () => config().lang;
export const L = (hu, en) => (lang() === 'en' ? en : hu);

export function pidFile(pid) {
  const dir = join(home(), 'pids');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, String(pid));
}

export function contextFile(cwd) {
  const dir = join(home(), 'context');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, createHash('sha1').update(cwd).digest('hex') + '.txt');
}
