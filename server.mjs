// Tiny static file server (no dependencies). Serves this folder on http://localhost:8811
import http from 'node:http';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8811;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
};

// POST /__shot with { name, dataURL } saves shots/<name>.png (used by TS.shot and tools/play.mjs).
async function handleShot(req, res) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 40 * 1024 * 1024) {
      res.writeHead(413).end('Too large');
      return;
    }
    chunks.push(c);
  }
  try {
    const { name, dataURL } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const safe = String(name || 'shot').replace(/[^\w.-]+/g, '_').slice(0, 80);
    const m = /^data:image\/png;base64,(.+)$/.exec(dataURL || '');
    if (!m) throw new Error('bad dataURL');
    const dir = path.join(ROOT, 'shots');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, safe + '.png');
    await writeFile(file, Buffer.from(m[1], 'base64'));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ path: file }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end(String(err.message || err));
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/__shot') {
    await handleShot(req, res);
    return;
  }
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => console.log(`wumpus game: http://localhost:${PORT}/`));
