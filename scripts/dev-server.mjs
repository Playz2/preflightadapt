import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicRoot = path.join(root, 'public');
const port = Number(process.env.PREFLIGHT_PORT || 8080);
const apiPaths = new Set(['/api/ocr', '/api/audit', '/api/log']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const examples = [
  ['VitaBoost fotorealist', '/demo/vitaboost-postare.png', '/demo/foto_persoana.jpg', 'Încarcă reclama, apoi originalul JPEG la Imagini sursă. Pentru comparație, testează și reclama fără sursă.'],
  ['Brutărie stilizată', '/demo/asset-b-brutarie.png', '/test-assets/brutarie_firefly.jpg', 'Fără sursă: fără penalizare AI Act. Cu sursa AI: etichetă recomandată, dacă auditul confirmă stilizarea.'],
  ['Control', '/demo/asset-c-control.png', null, 'Exemplul de control existent; scorul trebuie verificat în rularea actuală.'],
  ['Medic AI', '/demo/foto_medic.jpg', null, 'Încarcă JPEG-ul direct. Conține marcaje AI; eventualele constatări legale depind de contextul identificat de audit.'],
];
const examplesHtml = `<!doctype html><html lang="ro"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>PreFlight — exemple locale</title><style>body{font:17px system-ui;max-width:1100px;margin:40px auto;padding:0 20px;color:#0f172a;background:#f8fafc}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px}article{background:white;border:1px solid #ddd;border-radius:12px;padding:20px}img{width:100%;height:240px;object-fit:contain}a{color:#4338ca}p{line-height:1.5}</style><h1>Exemple pentru testare</h1><p><a href="/app.html" target="_blank">Deschide aplicația locală</a> · <a href="/">Pagina de prezentare</a></p><p>Descarcă imaginea și încarc-o în aplicație. Frontend local, OCR și audit pe backend-ul Firebase real. Scorurile sunt rezultatele rulării, nu valori garantate.</p><main>${examples.map(([name, url, source, note]) => `<article><img src="${url}" alt="${name}"><h2>${name}</h2><p>${note}</p><p><a href="${url}" download>Descarcă imaginea</a>${source ? ` · <a href="${source}" download>Descarcă sursa AI</a>` : ''}</p></article>`).join('')}</main></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const pathname = decodeURIComponent(url.pathname);
    res.setHeader('Cache-Control', 'no-store');
    if (apiPaths.has(pathname)) {
      if (req.method !== 'POST') { res.writeHead(405); return res.end('POST required'); }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 25 * 1024 * 1024) { res.writeHead(413); return res.end('Request too large'); }
        chunks.push(chunk);
      }
      const upstream = await fetch(`https://preflightadapt.web.app${pathname}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks), signal: AbortSignal.timeout(70000),
      });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
      return res.end(Buffer.from(await upstream.arrayBuffer()));
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    if (pathname === '/examples') {
      res.writeHead(200, { 'Content-Type': types['.html'] });
      return res.end(req.method === 'HEAD' ? undefined : examplesHtml);
    }
    const file = pathname === '/test-assets/brutarie_firefly.jpg'
      ? path.join(root, 'demo', 'brutarie_firefly.jpg')
      : path.resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (pathname !== '/test-assets/brutarie_firefly.jpg' && !file.startsWith(publicRoot + path.sep)) {
      res.writeHead(403); return res.end();
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.code === 'ENOENT' ? 'Fișier inexistent' : 'Serverul local nu a putut finaliza cererea.' }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`PreFlight: http://127.0.0.1:${port}/app.html\nExemple: http://127.0.0.1:${port}/examples`));
