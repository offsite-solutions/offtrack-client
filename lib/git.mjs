import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { home, editedFile } from './config.mjs';
import { send } from './api.mjs';

// A remote gépfüggetlen alakja: az SSH- és a HTTPS-klón ugyanaz, hitelesítő adat, protokoll és .git nélkül.
// Helyi útvonalra null, mert az más gépen mást jelent. Csak a lenyomathoz kell, a szerverre nem kerül.
export function normalizeRemote(url) {
  const s = String(url ?? '').trim();
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(s)
    ?? /^(?:[^@/\s]+@)?([^/:\s]+):(?!\/)(.+)$/.exec(s);
  if (!m || /^file:/i.test(s) || !m[1].includes('.')) return null;
  const path = m[2].replace(/\/+$/, '').replace(/\.git$/i, '');
  return path ? `${m[1]}/${path}`.toLowerCase() : null;
}

// A szerver sójával számolt lenyomat: ugyanaz a repó minden gépen és felhasználónál ugyanazt adja, a címet viszont nem árulja el.
export const repoHash = (salt, remote) => createHash('sha256').update(`${salt}:${remote}`).digest('hex');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

// A könyvtár repója és a repón belüli helye; nem repónál vagy remote nélkül null. Sosem dob: a hook nem blokkolhat.
export function gitRepo(cwd) {
  try {
    const remote = normalizeRemote(git(cwd, 'config', '--get', 'remote.origin.url'));
    return remote ? { remote, rel: git(cwd, 'rev-parse', '--show-prefix').replace(/\/$/, '') } : null;
  } catch {
    return null;
  }
}

// A szerver sója: tőle jön, és helyben megmarad; ha nem érhető el, ezúttal nincs lenyomat.
async function salt() {
  const file = join(home(), 'repo-salt');
  try { return readFileSync(file, 'utf8').trim(); } catch { /* még nincs */ }
  const res = await send('/api/v1/repo-salt', { method: 'GET', timeoutMs: 800 });
  if (!res.ok || !res.data?.salt) return null;
  writeFileSync(file, res.data.salt, { mode: 0o600 });
  return res.data.salt;
}

// A hook ezt küldi a szervernek: a lenyomat és a repón belüli hely, a cím soha.
export async function gitReport(cwd) {
  const repo = gitRepo(cwd);
  const s = repo && await salt();
  return s ? { hash: repoHash(s, repo.remote), rel: repo.rel } : null;
}

// Egy fájl vagy könyvtár repója és a címkéje (a gyökérkönyvtár neve); nem létező útnál a szülővel próbálkozik. Sosem dob.
export function repoOf(path) {
  try {
    let dir = path;
    for (let i = 0; i < 64; i++) {
      let isDir = false;
      try { isDir = statSync(dir).isDirectory(); } catch { dir = dirname(dir); if (dir === dirname(dir)) break; continue; }
      if (!isDir) dir = dirname(dir);
      const repo = gitRepo(dir);
      return repo ? { remote: repo.remote, label: basename(git(dir, 'rev-parse', '--show-toplevel')) } : null;
    }
  } catch { /* nem repó */ }
  return null;
}

// Az utak repóinak lenyomata és címkéje ismétlődés nélkül; só nélkül üres.
export async function reposFor(paths) {
  const found = new Map();
  for (const p of paths) {
    const r = repoOf(p);
    if (r && !found.has(r.remote)) found.set(r.remote, r.label);
  }
  if (!found.size) return [];
  const s = await salt();
  return s ? [...found].map(([remote, label]) => ({ hash: repoHash(s, remote), label })) : [];
}

// A session szerkesztett fájljai: beolvassa és törli a listát.
export function takeEdited(sessionId) {
  const file = editedFile(sessionId);
  try {
    const paths = [...new Set(readFileSync(file, 'utf8').split('\n').filter(Boolean))];
    unlinkSync(file);
    return paths;
  } catch {
    return [];
  }
}
