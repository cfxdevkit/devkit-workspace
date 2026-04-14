#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'node:http';

const projectRoot = resolve(process.cwd(), '..');
const dappRoot = resolve(projectRoot, 'dapp');
const port = Number(process.env.PORT ?? 3001);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function resolveFile(urlPath) {
  const cleaned = normalize((urlPath ?? '/').split('?')[0]).replace(/^\/+/, '');
  const relativePath = cleaned === '' ? 'dapp/index.html' : cleaned;
  return join(projectRoot, relativePath);
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
  console.log(`Project example dapp available at http://127.0.0.1:${port}`);
  console.log(`Serving project root from ${projectRoot}`);
  console.log(`Dapp root: ${dappRoot}`);
});
