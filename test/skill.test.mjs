import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installSkill, refreshSkill, skillPath, uninstallSkill } from '../lib/skill.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const HU = readFileSync(join(ROOT, 'skill.hu.md'), 'utf8');
const home = () => mkdtempSync(join(tmpdir(), 'ot-skill-'));

test('angolul link a tároló skills/offtrack könyvtárára', () => {
  const h = home();
  assert.equal(installSkill('en', h), 'ok');
  assert.ok(lstatSync(skillPath(h)).isSymbolicLink());
  assert.equal(realpathSync(skillPath(h)), realpathSync(join(ROOT, 'skills', 'offtrack')));
});

test('magyarul saját másolat; nyelvváltáskor a másik váltja', () => {
  const h = home();
  installSkill('hu', h);
  assert.equal(lstatSync(skillPath(h)).isSymbolicLink(), false);
  assert.equal(readFileSync(join(skillPath(h), 'SKILL.md'), 'utf8'), HU);
  installSkill('en', h);
  assert.ok(lstatSync(skillPath(h)).isSymbolicLink());
  installSkill('hu', h);
  assert.equal(readFileSync(join(skillPath(h), 'SKILL.md'), 'utf8'), HU);
});

test('a régi, skill/-re mutató (frissítés után törött) link helyére másolat kerül a SessionStartkor', () => {
  const h = home();
  mkdirSync(join(h, '.claude', 'skills'), { recursive: true });
  symlinkSync(join(ROOT, 'skill'), skillPath(h), 'junction');
  refreshSkill('hu', h);
  assert.equal(readFileSync(join(skillPath(h), 'SKILL.md'), 'utf8'), HU);
});

test('a SessionStart frissíti az elavult magyar másolatot', () => {
  const h = home();
  installSkill('hu', h);
  writeFileSync(join(skillPath(h), 'SKILL.md'), 'régi');
  refreshSkill('hu', h);
  assert.equal(readFileSync(join(skillPath(h), 'SKILL.md'), 'utf8'), HU);
});

test('a felhasználó saját könyvtárához nem nyúl', () => {
  const h = home();
  mkdirSync(skillPath(h), { recursive: true });
  writeFileSync(join(skillPath(h), 'SKILL.md'), 'saját');
  assert.equal(installSkill('hu', h), 'skipped');
  refreshSkill('hu', h);
  uninstallSkill(h);
  assert.equal(readFileSync(join(skillPath(h), 'SKILL.md'), 'utf8'), 'saját');
});

test('eltávolítás: a link és a másolat is törlődik', () => {
  for (const lang of ['en', 'hu']) {
    const h = home();
    installSkill(lang, h);
    uninstallSkill(h);
    assert.equal(existsSync(skillPath(h)), false);
  }
});

test('az `npx skills add` linkjét a telepítés lecseréli, az eltávolítás meghagyja', () => {
  const h = home();
  const other = mkdtempSync(join(tmpdir(), 'ot-agents-'));
  mkdirSync(join(h, '.claude', 'skills'), { recursive: true });
  symlinkSync(other, skillPath(h), 'junction');
  uninstallSkill(h);
  assert.ok(lstatSync(skillPath(h)).isSymbolicLink());
  installSkill('hu', h);
  assert.equal(readFileSync(join(skillPath(h), 'SKILL.md'), 'utf8'), HU);
});
