import { execFileSync, execSync, spawn } from 'node:child_process';

// A Windows-eltérések egy helyen. macOS-en és Linuxon minden függvény a korábbi viselkedést adja.
export const IS_WIN = process.platform === 'win32';

// Perjeles útvonal Windowson: a szerver `/` elválasztóval illeszt, és így a basename is a könyvtár nevét adja.
export const slash = (p, win = IS_WIN) => (win && typeof p === 'string' ? p.replace(/\\/g, '/') : p);

// Egy parancssor a cmd.exe-nek: az egyszerű argumentum marad, a többi (szóközös, üres) idézőjelbe kerül.
const quote = (a) => (/^[\w.:/\\=@-]+$/.test(a) ? a : `"${a}"`);
export const claudeLine = (args) => ['claude', ...args.map(quote)].join(' ');

// A claude indítása. Windowson shellen át, mert az npm-ből telepített claude egy .cmd fájl, amelyet a Node shell nélkül nem indít.
export function claudeSync(args, opts = {}) {
  return IS_WIN ? execSync(claudeLine(args), { ...opts, windowsHide: true }) : execFileSync('claude', args, opts);
}

export function claudeSpawn(args, opts = {}) {
  return IS_WIN ? spawn(claudeLine(args), { ...opts, shell: true, windowsHide: true }) : spawn('claude', args, opts);
}
