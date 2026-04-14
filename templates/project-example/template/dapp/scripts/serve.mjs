#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const distRoot = resolve(process.cwd(), 'dist');
const port = Number(process.env.PORT ?? 3030);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function resolveFile(urlPath) {
  const cleaned = normalize((urlPath ?? '/').split('?')[0]).replace(/^\/+/, '');
  const relativePath = cleaned === '' ? 'index.html' : cleaned;
  return join(distRoot, relativePath);
}

const server = createServer((req, res) => {
  const filePath = resolveFile(req.url);
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  res.setHeader('Content-Type', mimeTypes[extname(filePath)] ?? 'text/plain; charset=utf-8');
  createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`Built project example available at http://127.0.0.1:${port}`);
});
