import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Rögzítő HTTP-szerver: a respond(req, body, n) adja a [status, json] választ.
export async function recorder(respond = () => [200, {}]) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body, raw });
      const [status, json, delayMs = 0] = respond(req, body, requests.length);
      setTimeout(() => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      }, delayMs);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

// Ideiglenes OFFTRACK_HOME a megadott szerver-URL-lel és tokennel.
export function home(url = 'http://127.0.0.1:9') {
  const dir = mkdtempSync(join(tmpdir(), 'offtrack-home-'));
  // a meglévő tesztek a magyar kimenetet ellenőrzik; az alapértelmezést (angol) a lang.test.mjs nézi
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ url, lang: 'hu' }));
  writeFileSync(join(dir, 'client-token'), 'tok-'.padEnd(40, 'x'));
  return dir;
}

// A magyar szövegeket ellenőrző tesztek saját, magyar beállítású OFFTRACK_HOME-ot kapnak,
// hogy ne a gép ~/.config/offtrack beállításán múljanak (alapból angol).
export function useHungarian() {
  const dir = mkdtempSync(join(tmpdir(), 'offtrack-hu-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ lang: 'hu' }));
  process.env.OFFTRACK_HOME = dir;
}
