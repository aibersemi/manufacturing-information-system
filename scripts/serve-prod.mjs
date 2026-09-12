import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist/manufacturing-information-system/browser');

const PORT = parseInt(process.env.APP_PORT || '8015', 10);
const HOST = process.env.APP_BIND_HOST || '0.0.0.0';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

if (!fs.existsSync(DIST_DIR)) {
  console.error(`[MIS Production Server] Error: Directory "${DIST_DIR}" does not exist. Run "npm run build" first.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method Not Allowed');
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);

  // Security: prevent path traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(DIST_DIR, safePath);

  // Verify within DIST_DIR
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Check if file exists; if directory, look for index.html; if not found, SPA fallback to index.html
  let isSpaFallback = false;
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      if (fs.existsSync(indexPath)) {
        filePath = indexPath;
      } else {
        filePath = path.join(DIST_DIR, 'index.html');
        isSpaFallback = true;
      }
    }
  } else {
    filePath = path.join(DIST_DIR, 'index.html');
    isSpaFallback = true;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const headers = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };

  if (isSpaFallback || ext === '.html') {
    headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
  } else {
    // Immutable cache for fingerprinted static assets
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';
  const canGzip = /\bgzip\b/.test(acceptEncoding) && /text|javascript|json|svg|xml/.test(contentType);

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  const rawStream = fs.createReadStream(filePath);

  if (canGzip) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    rawStream.pipe(zlib.createGzip()).pipe(res);
  } else {
    res.writeHead(200, headers);
    rawStream.pipe(res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[MIS Production Server] Running on http://${HOST}:${PORT}`);
  console.log(`[MIS Production Server] Serving static files from: ${DIST_DIR}`);
});

const gracefulShutdown = () => {
  console.log('[MIS Production Server] Received termination signal, shutting down...');
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  server.close(() => {
    console.log('[MIS Production Server] Server closed gracefully.');
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(0);
  }, 2000).unref();
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
