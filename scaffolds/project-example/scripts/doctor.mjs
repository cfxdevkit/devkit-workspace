#!/usr/bin/env node

const DEVKIT_URL = process.env.DEVKIT_URL ?? 'http://127.0.0.1:7748';
const ESPACE_RPC_URL = process.env.ESPACE_RPC_URL ?? 'http://127.0.0.1:8545';

async function fetchJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(5000),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, json, text };
}

function renderRow(label, value) {
  return `${label.padEnd(18)} ${value}`;
}

async function main() {
  const health = await fetchJson(`${DEVKIT_URL}/health`).catch(() => null);
  const keystore = health?.ok ? await fetchJson(`${DEVKIT_URL}/api/keystore/status`).catch(() => null) : null;
  const node = health?.ok ? await fetchJson(`${DEVKIT_URL}/api/node/status`).catch(() => null) : null;
  const rpc = health?.ok
    ? await fetchJson(ESPACE_RPC_URL, {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      }).catch(() => null)
    : null;

  const lines = [
    renderRow('devkit-url', DEVKIT_URL),
    renderRow('server', health?.ok ? 'online' : 'offline'),
    renderRow('keystore', keystore?.ok ? `${keystore.json?.initialized ? 'initialized' : 'not-initialized'} / ${keystore.json?.locked ? 'locked' : 'unlocked'}` : 'unknown'),
    renderRow('node', node?.ok ? node.json?.server ?? 'unknown' : 'unknown'),
    renderRow('rpc-url', ESPACE_RPC_URL),
    renderRow('rpc', rpc?.ok && rpc.json?.result ? `online (chain ${Number.parseInt(rpc.json.result, 16)})` : 'offline'),
  ];

  console.log(lines.join('\n'));

  if (!health?.ok) {
    console.error('\nDevKit server is not reachable. Start it with "Conflux: Start DevKit Server" first.');
  } else if (!keystore?.ok || !keystore.json?.initialized) {
    console.error('\nKeystore is not initialized. Complete the first-time setup before deploying contracts.');
  } else if (keystore.json?.locked) {
    console.error('\nKeystore is locked. Unlock it before starting the node or deploying contracts.');
  } else if (!node?.ok || node.json?.server !== 'running') {
    console.error('\nNode is not running. Start it with "Conflux: Start Node" before using the dApp or deploying contracts.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});