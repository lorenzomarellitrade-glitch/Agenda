// Server statico per provare l'app in locale. Uso: node strumenti/server.js  →  http://127.0.0.1:4190
const http = require('http');
const fs = require('fs');
const path = require('path');

const RADICE = path.join(__dirname, '..', 'docs');
const PORTA = Number(process.env.PORTA) || 4190;
const TIPI = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(RADICE, path.normalize(p));
  if (!file.startsWith(RADICE)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, dati) => {
    if (err) { res.writeHead(404); return res.end('non trovato'); }
    res.writeHead(200, { 'Content-Type': TIPI[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(dati);
  });
}).listen(PORTA, '127.0.0.1', () => console.log(`Agenda in locale: http://127.0.0.1:${PORTA}`));
