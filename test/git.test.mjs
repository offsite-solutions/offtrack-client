import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitRepo, normalizeRemote, repoHash } from '../lib/git.mjs';

const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'ignore' });

test('az SSH- és a HTTPS-klón ugyanaz, hitelesítő adat nélkül', () => {
  for (const url of ['git@github.com:Acme/Repo.git', 'ssh://git@github.com/acme/repo.git', 'ssh://git@github.com:22/acme/repo',
    'https://github.com/acme/repo.git', 'https://user:ghp_TITOK@github.com/acme/repo.git/', 'https://ghp_TITOK@github.com/acme/repo']) {
    assert.equal(normalizeRemote(url), 'github.com/acme/repo', url);
  }
  for (const url of ['/srv/git/repo.git', '../repo', 'file:///srv/git/repo.git', '', null, 'C:/x/y', 'localhost:repo.git']) assert.equal(normalizeRemote(url), null, url);
});

test('a lenyomat a sótól függ', () => {
  const r = 'github.com/acme/repo';
  assert.match(repoHash('a', r), /^[0-9a-f]{64}$/);
  assert.equal(repoHash('a', r), repoHash('a', r));
  assert.notEqual(repoHash('a', r), repoHash('b', r));
});

test('valódi repóból a remote és a repón belüli hely', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ot-git-'));
  assert.equal(gitRepo(dir), null);
  git(dir, 'init', '-q');
  assert.equal(gitRepo(dir), null);
  git(dir, 'remote', 'add', 'origin', 'https://u:t@github.com/acme/repo.git');
  assert.deepEqual(gitRepo(dir), { remote: 'github.com/acme/repo', rel: '' });
  mkdirSync(join(dir, 'api', 'src'), { recursive: true });
  assert.deepEqual(gitRepo(join(dir, 'api', 'src')), { remote: 'github.com/acme/repo', rel: 'api/src' });
  assert.equal(gitRepo('/nincs/ilyen/konyvtar'), null);
});
