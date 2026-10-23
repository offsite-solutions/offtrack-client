import { appendFileSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { config, home } from './config.mjs';

const DOWN_MS = 30000; // hálózati hiba után ennyi ideig nem próbálkozunk (a hook ne lassítson minden tool-hívást)
const MAX_ATTEMPTS = 5; // ennyi átmeneti hiba után az elem a dead.jsonl-be kerül
const PERMANENT = new Set([400, 404, 409, 422]); // ezek később sem sikerülnek

const file = (name) => join(home(), name);

function downUntil() {
  try { return Number(readFileSync(file('down-until'), 'utf8')) || 0; } catch { return 0; }
}

// A szerver hívása. Kivételt nem dob. Hálózati hiba után DOWN_MS-ig hálózat nélkül {ok:false}-t ad, kivéve force esetén.
export async function send(path, { method = 'POST', body, timeoutMs = 1500, force = false, token: override } = {}) {
  if (!force && Date.now() < downUntil()) return { ok: false, skipped: true };
  const { url, token: saved } = config();
  const token = override ?? saved;
  try {
    const res = await fetch(url + path, {
      method,
      headers: { authorization: `Bearer ${token ?? ''}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let data = null;
    try { data = await res.json(); } catch { /* üres válasz */ }
    try { unlinkSync(file('down-until')); } catch { /* nem volt */ }
    return { ok: res.ok, status: res.status, data };
  } catch {
    try { writeFileSync(file('down-until'), String(Date.now() + DOWN_MS)); } catch { /* mindegy */ }
    return { ok: false };
  }
}

// Fájlzár wx-szel. A zárat a tartója minden elküldött elem után frissíti; a 30 mp-nél régebbi zár elavult.
function lock(waitMs) {
  const until = Date.now() + waitMs;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try { closeSync(openSync(file('queue.lock'), 'wx')); return true; } catch { /* foglalt */ }
    try {
      if (Date.now() - statSync(file('queue.lock')).mtimeMs > 30000) { unlinkSync(file('queue.lock')); continue; }
    } catch { continue; }
    if (Date.now() >= until) return false;
    Atomics.wait(nap, 0, 0, 10);
  }
}
const unlock = () => { try { unlinkSync(file('queue.lock')); } catch { /* már nincs */ } };
const touchLock = () => { try { const t = new Date(); utimesSync(file('queue.lock'), t, t); } catch { /* nincs */ } };

function readQueue() {
  try {
    return readFileSync(file('queue.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try {
        const x = JSON.parse(l);
        // régi (azonosító nélküli) sorok: a sor tartalmából képzett, stabil azonosító
        return [x.id ? x : { ...x, id: 'h-' + createHash('sha1').update(l).digest('hex') }];
      } catch { return []; }
    });
  } catch {
    return [];
  }
}

// A sor újraírása azonosító szerint: a közben hozzáfűzött vagy máshol kivett elemek nem vesznek el.
function rewriteQueue(fn) {
  const next = fn(readQueue());
  const tmp = file('queue.jsonl.tmp');
  writeFileSync(tmp, next.map((x) => JSON.stringify(x) + '\n').join(''), { mode: 0o600 });
  renameSync(tmp, file('queue.jsonl'));
}

function deadLetter(item, reason) {
  appendFileSync(file('dead.jsonl'), JSON.stringify({ ...item, reason, dead_at: new Date().toISOString() }) + '\n', { mode: 0o600 });
}

export function enqueue(path, body, method = 'POST') {
  const locked = lock(200);
  try {
    appendFileSync(file('queue.jsonl'), JSON.stringify({ id: randomUUID(), path, method, body, ts: new Date().toISOString(), attempts: 0 }) + '\n', { mode: 0o600 });
  } finally {
    if (locked) unlock();
  }
}

export function queueLength() {
  return readQueue().length;
}

// Sorrendben elküldi a sorban állókat, legfeljebb budgetMs ideig. Minden sikeres elem azonnal kikerül a sorból.
// Az első átmeneti hibánál megáll; a tartósan hibás elem MAX_ATTEMPTS után a dead.jsonl-be kerül.
// Igaz, ha a sor kiürült.
export async function flushQueue({ timeoutMs = 1500, budgetMs = 1000, max = 50, force = false } = {}) {
  if (readQueue().length === 0) return true;
  if (!force && Date.now() < downUntil()) return false;
  if (!lock(0)) return false;
  const deadline = Date.now() + budgetMs;
  try {
    for (const item of readQueue().slice(0, max)) {
      const left = deadline - Date.now();
      if (left <= 50) break;
      if (!readQueue().some((x) => x.id === item.id)) continue; // közben más elküldte
      const r = await send(item.path, { method: item.method ?? 'POST', body: item.body, timeoutMs: Math.min(timeoutMs, left), force });
      touchLock();
      if (r.ok) {
        rewriteQueue((q) => q.filter((x) => x.id !== item.id));
      } else if (PERMANENT.has(r.status)) {
        deadLetter(item, `HTTP ${r.status}`);
        rewriteQueue((q) => q.filter((x) => x.id !== item.id));
      } else {
        const attempts = (item.attempts ?? 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          deadLetter(item, r.status ? `HTTP ${r.status}` : 'hálózati hiba');
          rewriteQueue((q) => q.filter((x) => x.id !== item.id));
          continue;
        }
        rewriteQueue((q) => q.map((x) => (x.id === item.id ? { ...x, attempts } : x)));
        break;
      }
    }
    return readQueue().length === 0;
  } finally {
    unlock();
  }
}
