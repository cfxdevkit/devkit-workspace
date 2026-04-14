#!/usr/bin/env node

import { createServer } from 'node:http';

const args = process.argv.slice(2);

function getArg(flag, short) {
  for (const [index, value] of args.entries()) {
    if ((value === flag || (short && value === short)) && args[index + 1]) {
      return args[index + 1];
    }
    if (value.startsWith(`${flag}=`)) {
      return value.split('=').slice(1).join('=');
    }
  }
  return undefined;
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`new-devkit backend\n\nUsage:\n  devkit-backend [--host 127.0.0.1] [--port 7748] [--no-open]`);
  process.exit(0);
}

const host = getArg('--host') ?? process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(getArg('--port', '-p') ?? process.env.PORT ?? '7748', 10);

function createPayload(pathname) {
  return {
    schemaVersion: 1,
    service: 'new-devkit-backend',
    status: 'ok',
    target: process.env.NEW_DEVKIT_TARGET ?? 'devcontainer',
    baseUrl: process.env.NEW_DEVKIT_ENABLE_BASE_URL === '1',
    proxy: process.env.NEW_DEVKIT_ENABLE_PROXY === '1',
    path: pathname,
    timestamp: new Date().toISOString(),
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);

  if (request.method === 'GET' && (url.pathname === '/health' || url.pathname === '/api/health')) {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(`${JSON.stringify(createPayload(url.pathname), null, 2)}\n`);
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify({ status: 'error', message: 'Not found', path: url.pathname }, null, 2)}\n`);
});

server.listen(port, host, () => {
  console.log(`new-devkit-backend listening on http://${host}:${port}`);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`received ${signal}, shutting down backend`);
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
