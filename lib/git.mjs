import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { home } from './config.mjs';
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
