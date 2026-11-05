// Az offtrack skill telepítése a ~/.claude/skills/offtrack alá.
// Az angol a skills/offtrack/SKILL.md, a skills.sh CLI-je ott keresi; a hely link a tároló könyvtárára, így a frissítés azonnal érvényes.
// A magyar a skill.hu.md: nem SKILL.md nevű, mert a skills.sh minden SKILL.md-t felvesz, és az azonos nevű magyar
// kiszorította az angolt. Ezért a magyar másolat egy saját könyvtárban, amelyet a SessionStart hook frissít (refreshSkill).
import { readFileSync, writeFileSync, existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, rmSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EN_DIR = join(ROOT, 'skills', 'offtrack');
const HU_FILE = join(ROOT, 'skill.hu.md');
const MARK = '.offtrack'; // a saját másolat jele: csak ezt a könyvtárat írjuk felül vagy töröljük

export const skillPath = (home = homedir()) => join(home, '.claude', 'skills', 'offtrack');

// a link a megadott helyek egyikére mutat (a régi, már nem létező helyeket is beleértve)
function linksTo(path, targets) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false;
    const to = resolve(dirname(path), readlinkSync(path));
    return targets.some((t) => resolve(t) === to);
  } catch { return false; }
}

// a régi telepítések linkjei: skill/ (magyar), skill-en/ és skills/offtrack (angol)
const OURS = [join(ROOT, 'skill'), join(ROOT, 'skill-en'), EN_DIR];
// felülírható: bármilyen link (a sajátunk vagy az `npx skills add` linkje) és a saját másolat; a valódi könyvtár nem
const isLink = (path) => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };
const isOurs = (path) => isLink(path) || existsSync(join(path, MARK));

function remove(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) unlinkSync(path);
    else rmSync(path, { recursive: true, force: true });
  } catch { /* nincs */ }
}

// telepítés a választott nyelven; a nem általunk létrehozott könyvtárhoz nem nyúl (visszatér: 'skipped')
export function installSkill(lang, home = homedir()) {
  const path = skillPath(home);
  mkdirSync(dirname(path), { recursive: true });
  let exists = true;
  try { lstatSync(path); } catch { exists = false; }
  if (exists && !isOurs(path)) return 'skipped';
  if (lang === 'en') {
    if (linksTo(path, [EN_DIR]) && existsSync(path)) return 'ok';
    remove(path);
    // a 'junction' Windowson admin jog nélkül is működik, máshol a Node figyelmen kívül hagyja
    symlinkSync(EN_DIR, path, 'junction');
    return 'ok';
  }
  if (exists && !existsSync(join(path, MARK))) remove(path);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'SKILL.md'), readFileSync(HU_FILE, 'utf8'));
  writeFileSync(join(path, MARK), 'Az offtrack kliens kezeli; az offtrack install felülírja.\n');
  return 'ok';
}

// SessionStart: a magyar másolat a kliens frissítése után is naprakész, a régi (skill/-re mutató) link helyére másolat kerül.
// Csak akkor ír, ha valami eltér; hibát nem dob (a hook nem akadhat el rajta).
export function refreshSkill(lang, home = homedir()) {
  try {
    const path = skillPath(home);
    if (lang === 'en') {
      if (linksTo(path, OURS) && !linksTo(path, [EN_DIR])) installSkill('en', home);
      return;
    }
    if (existsSync(join(path, MARK))) {
      const want = readFileSync(HU_FILE, 'utf8');
      if (readFileSync(join(path, 'SKILL.md'), 'utf8') !== want) writeFileSync(join(path, 'SKILL.md'), want);
      return;
    }
    if (linksTo(path, OURS)) installSkill('hu', home);
  } catch { /* a következő indításkor újra próbálja */ }
}

// eltávolításkor csak a saját link és másolat törlődik, az `npx skills add` linkje marad
export function uninstallSkill(home = homedir()) {
  const path = skillPath(home);
  if (linksTo(path, OURS) || existsSync(join(path, MARK))) remove(path);
}
