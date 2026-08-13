#!/usr/bin/env node
/*
 * Minimal local test server for the public XForm Revival runtime demo.
 * It serves this repository root so the landing page, Worker, Wasm module, and
 * browser harnesses share one HTTP origin.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm', '.xml': 'application/xml; charset=utf-8'
};

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const resolved = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!resolved.startsWith(root)) { response.writeHead(403).end('Forbidden'); return; }
  fs.readFile(resolved, (error, data) => {
    if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end(error.message); return; }
    response.writeHead(200, { 'Content-Type': types[path.extname(resolved)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(data);
  });
}).listen(port, '0.0.0.0', () => console.log(`XForm public demo server: http://127.0.0.1:${port}`));
