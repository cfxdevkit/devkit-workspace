/**
 * CFX DevKit — dApp (DEX UI + PayableVault)
 *
 * A Node.js server that:
 *   1. Serves the Vite-built SPA from dist/
 *   2. Proxies RPC + devkit API calls to avoid CORS
 *   3. Provides REST endpoints for the dashboard
 *
 * Environment variables (set in docker-compose.yml):
 *   DEVKIT_URL            conflux-devkit server  (default: http://localhost:7748)
 *   ESPACE_RPC_URL        Conflux eSpace RPC      (default: http://localhost:8545)
 *   PORT                  This server's port      (default: 8888)
 *   WORKSPACE_FILESERVER  URL of the devkit workspace file server (default: http://127.0.0.1:7749)
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { artifacts as contractArtifacts } from '@cfxdevkit/dex-contracts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, 'dist');
const PUBLIC_DIR = join(__dirname, 'public');
const TOKEN_ICON_OVERRIDES_PATH = join(PUBLIC_DIR, 'token-icon-overrides.json');
const DIST_TOKEN_ICON_OVERRIDES_PATH = join(DIST_DIR, 'token-icon-overrides.json');
const POOL_IMPORT_PRESETS_PATH = join(PUBLIC_DIR, 'pool-import-presets.json');
const DIST_POOL_IMPORT_PRESETS_PATH = join(DIST_DIR, 'pool-import-presets.json');
const TOKEN_ICON_FILES_DIR = join(PUBLIC_DIR, 'token-icons');
const DIST_TOKEN_ICON_FILES_DIR = join(DIST_DIR, 'token-icons');

function isStablecoinAddress(address) {
  return new Set([
    '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff',
    '0x70bfd7f7eadf9b9827541272589a6b2bb760ae2e',
    '0xfe97e85d13abd9c1c33384e796f10b73905637ce',
    '0x6963efed0ab40f6c3d7bda44a05dcf1437c44372',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0xdac17f958d2ee523a2206206994597c13d831ec7',
    '0x6b175474e89094c44da98b954eedeac495271d0f',
  ]).has(String(address ?? '').toLowerCase());
}

const DEVKIT_URL          = process.env.DEVKIT_URL            ?? 'http://localhost:7748';
const ESPACE_RPC          = process.env.ESPACE_RPC_URL         ?? 'http://localhost:8545';
const PORT                = Number(process.env.PORT ?? 8888);
const WORKSPACE_FILESERVER = process.env.WORKSPACE_FILESERVER  ?? 'http://127.0.0.1:7749';

// ── In-memory DEX state (POSTed by MCP tools) ────────────────────────────────
let dexManifest = null;           // V2Manifest object
let dexTranslationTable = null;   // TranslationTable object
const dexContracts = [];          // deployed contract registry

// ── SIWE session store (in-memory — fine for local dev) ──────────────────────
// Map<sessionId, { address, chainId, nonce, issuedAt }>
const sessions = new Map();
// Map<nonce, true> — pending nonces (unused yet)
const pendingNonces = new Map();

const SESSION_COOKIE = 'dex_session';
const SESSION_MAX_AGE = 86400; // 24h

function generateNonce() {
  return randomBytes(16).toString('hex');
}

function generateSessionId() {
  return randomBytes(32).toString('hex');
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (k) cookies[k] = rest.join('=');
  }
  return cookies;
}

function setSessionCookie(res, sessionId) {
  const cookie = `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[SESSION_COOKIE];
  if (!sid) return null;
  return sessions.get(sid) || null;
}

/** Minimal EIP-4361 message parser */
function parseSiweMessage(message) {
  const lines = message.split('\n');
  const result = {};
  for (const line of lines) {
    if (line.startsWith('URI: ')) result.uri = line.slice(5);
    else if (line.startsWith('Chain ID: ')) result.chainId = Number(line.slice(10));
    else if (line.startsWith('Nonce: ')) result.nonce = line.slice(7);
    else if (line.startsWith('Issued At: ')) result.issuedAt = line.slice(11);
    else if (/^0x[a-fA-F0-9]{40}$/.test(line.trim())) result.address = line.trim();
  }
  // Domain is the first line before " wants you to sign in"
  const domainMatch = lines[0]?.match(/^(.+?) wants you to sign in/);
  if (domainMatch) result.domain = domainMatch[1];
  return result;
}

/** Recover address from personal_sign (EIP-191) using viem (pure JS) */
async function recoverAddress(message, signature) {
  return recoverMessageAddress({ message, signature });
}

// ── MIME types ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function _devkitFetch(path) {
  const r = await fetch(`${DEVKIT_URL}/api${path}`, { signal: AbortSignal.timeout(5000) });
  const json = await r.json();
  return json.data ?? json;
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function sendFile(res, filePath) {
  const ext = extname(filePath);
  const mime = MIME[ext] ?? 'application/octet-stream';
  const content = readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': content.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(content);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

function readTokenIconOverrides() {
  try {
    if (!existsSync(TOKEN_ICON_OVERRIDES_PATH)) {
      return { version: 1, updatedAt: new Date().toISOString(), icons: [] };
    }
    return JSON.parse(readFileSync(TOKEN_ICON_OVERRIDES_PATH, 'utf-8'));
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), icons: [] };
  }
}

function getSuggestedPoolAddresses() {
  try {
    const catalogPath = existsSync(join(PUBLIC_DIR, 'known-tokens.json'))
      ? join(PUBLIC_DIR, 'known-tokens.json')
      : join(DIST_DIR, 'known-tokens.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
    return (catalog?.pools ?? [])
      .filter((pool) => pool?.isWcfxPair && !isStablecoinAddress(pool?.baseToken?.address) && !isStablecoinAddress(pool?.quoteToken?.address))
      .sort((left, right) => {
        if ((right.reserveUsd ?? 0) !== (left.reserveUsd ?? 0)) return (right.reserveUsd ?? 0) - (left.reserveUsd ?? 0);
        return (right.volume24h ?? 0) - (left.volume24h ?? 0);
      })
      .slice(0, 5)
      .map((pool) => String(pool.address).toLowerCase());
  } catch {
    return [];
  }
}

function writeTokenIconOverrides(data) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(TOKEN_ICON_OVERRIDES_PATH, text);
  if (existsSync(DIST_DIR)) {
    writeFileSync(DIST_TOKEN_ICON_OVERRIDES_PATH, text);
  }
}

function readPoolImportPresets() {
  try {
    const suggestedPoolAddresses = getSuggestedPoolAddresses();
    if (!existsSync(POOL_IMPORT_PRESETS_PATH)) {
      return { version: 1, chainId: 1030, updatedAt: new Date().toISOString(), selectedPoolAddresses: suggestedPoolAddresses };
    }
    const data = JSON.parse(readFileSync(POOL_IMPORT_PRESETS_PATH, 'utf-8'));
    if (!Array.isArray(data?.selectedPoolAddresses) || data.selectedPoolAddresses.length === 0) {
      return {
        version: data?.version ?? 1,
        chainId: data?.chainId ?? 1030,
        updatedAt: data?.updatedAt ?? new Date().toISOString(),
        selectedPoolAddresses: suggestedPoolAddresses,
      };
    }
    return data;
  } catch {
    return { version: 1, chainId: 1030, updatedAt: new Date().toISOString(), selectedPoolAddresses: getSuggestedPoolAddresses() };
  }
}

function writePoolImportPresets(data) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(POOL_IMPORT_PRESETS_PATH, text);
  if (existsSync(DIST_DIR)) {
    writeFileSync(DIST_POOL_IMPORT_PRESETS_PATH, text);
  }
}

function writeTokenIconFile(address, _fileName, dataUrl) {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/) : null;
  if (!match) throw new Error('Invalid image payload');

  const mime = match[1];
  const payload = match[2];
  const ext = mime === 'image/jpeg' ? '.jpg'
    : mime === 'image/webp' ? '.webp'
    : mime === 'image/gif' ? '.gif'
    : mime === 'image/svg+xml' ? '.svg'
    : '.png';
  const safeAddress = address.toLowerCase();
  const fileBase = `${safeAddress}${ext}`;
  const buffer = Buffer.from(payload, 'base64');

  mkdirSync(TOKEN_ICON_FILES_DIR, { recursive: true });
  writeFileSync(join(TOKEN_ICON_FILES_DIR, fileBase), buffer);

  if (existsSync(DIST_DIR)) {
    mkdirSync(DIST_TOKEN_ICON_FILES_DIR, { recursive: true });
    writeFileSync(join(DIST_TOKEN_ICON_FILES_DIR, fileBase), buffer);
  }

  return `/api/dex/token-icons/${fileBase}`;
}

// ── SPA index.html ───────────────────────────────────────────────────────────
const indexPath = join(DIST_DIR, 'index.html');
const hasIndex = existsSync(indexPath);

// ── Router ───────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  try {
    // ── JSON-RPC proxy → eSpace node ─────────────────────────────────────
    if (req.method === 'POST' && pathname === '/rpc') {
      const body = await readBody(req);
      const rpcRes = await fetch(ESPACE_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10000),
      });
      const rpcText = await rpcRes.text();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': Buffer.byteLength(rpcText),
      });
      res.end(rpcText);
      return;
    }

    // ── SIWE Auth routes ───────────────────────────────────────────────
    if (pathname === '/api/auth/nonce' && req.method === 'GET') {
      const nonce = generateNonce();
      pendingNonces.set(nonce, true);
      // Expire unused nonces after 5 min
      setTimeout(() => pendingNonces.delete(nonce), 5 * 60_000);
      return sendJson(res, 200, { nonce });
    }

    if (pathname === '/api/auth/verify' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const { message, signature } = body;
      if (!message || !signature) return sendJson(res, 400, { error: 'Missing message or signature' });

      const parsed = parseSiweMessage(message);
      if (!parsed.address || !parsed.nonce) return sendJson(res, 400, { error: 'Invalid SIWE message' });

      // Verify nonce was issued by us
      if (!pendingNonces.has(parsed.nonce)) return sendJson(res, 400, { error: 'Invalid or expired nonce' });
      pendingNonces.delete(parsed.nonce);

      // Check timestamp isn't too old (5 min window)
      if (parsed.issuedAt) {
        const age = Date.now() - new Date(parsed.issuedAt).getTime();
        if (age > 5 * 60_000) return sendJson(res, 400, { error: 'Message expired' });
      }

      // Recover signer and compare
      let recovered;
      try {
        recovered = await recoverAddress(message, signature);
      } catch (err) {
        return sendJson(res, 400, { error: 'Signature recovery failed', detail: err.message });
      }

      if (recovered.toLowerCase() !== parsed.address.toLowerCase()) {
        return sendJson(res, 401, { error: 'Signature mismatch' });
      }

      // Create session
      const sessionId = generateSessionId();
      sessions.set(sessionId, {
        address: parsed.address,
        chainId: parsed.chainId,
        issuedAt: parsed.issuedAt,
      });
      setSessionCookie(res, sessionId);
      return sendJson(res, 200, { ok: true, address: parsed.address });
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const session = getSession(req);
      if (!session) return sendJson(res, 401, { error: 'Not authenticated' });
      return sendJson(res, 200, { address: session.address, chainId: session.chainId });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie);
      const sid = cookies[SESSION_COOKIE];
      if (sid) sessions.delete(sid);
      clearSessionCookie(res);
      return sendJson(res, 200, { ok: true });
    }

    // ── Contract artifacts — served from @cfxdevkit/dex-contracts (in-memory) ──
    if (req.method === 'GET' && pathname.startsWith('/api/dex/artifact/')) {
      const name = pathname.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '');
      const art = name ? contractArtifacts[name] : undefined;
      if (art) {
        return sendJson(res, 200, { abi: art.abi, bytecode: art.bytecode });
      }
      return sendJson(res, 404, { error: 'Artifact not found' });
    }

    // ── Contract tracking: register a deployed contract ─────────────────
    if (req.method === 'POST' && pathname === '/api/dex/contracts') {
      try {
        const body = JSON.parse(await readBody(req));
        const { name, address, chain, deployer, txHash, abi, chainId, metadata } = body;
        if (!name || !address) {
          return sendJson(res, 400, { error: 'name and address are required' });
        }
        const id = `${chain ?? 'evm'}-${address.toLowerCase()}`;
        const entry = {
          id,
          name,
          address: address.toLowerCase(),
          chain: chain ?? 'evm',
          deployer: deployer ?? '',
          txHash: txHash ?? '',
          deployedAt: new Date().toISOString(),
          chainId: chainId ?? 2030,
          ...(abi ? { abi: typeof abi === 'string' ? abi : JSON.stringify(abi) } : {}),
          ...(metadata && typeof metadata === 'object' ? { metadata } : {}),
        };
        const idx = dexContracts.findIndex(c => c.id === id);
        if (idx >= 0) dexContracts[idx] = entry;
        else dexContracts.push(entry);
        return sendJson(res, 200, entry);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // ── Local contract registry (in-memory) ─────────────────────────────────
    if (req.method === 'GET' && pathname === '/devkit-contracts.json') {
      return sendJson(res, 200, dexContracts);
    }

    // ── DEX state reset ─────────────────────────────────────────────────────
    if (req.method === 'DELETE' && pathname === '/api/dex/state') {
      dexManifest = null;
      dexTranslationTable = null;
      dexContracts.length = 0;
      return sendJson(res, 200, { ok: true });
    }

    // ── DEX manifest — in-memory state (POSTed by MCP, GETted by UI) ────────
    if (pathname === '/api/dex/manifest') {
      if (req.method === 'POST') {
        try {
          dexManifest = JSON.parse(await readBody(req));
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
      return sendJson(res, 200, dexManifest);
    }

    // ── Translation table — in-memory state ─────────────────────────────────
    if (pathname === '/api/dex/translation-table') {
      if (req.method === 'POST') {
        try {
          dexTranslationTable = JSON.parse(await readBody(req));
          return sendJson(res, 200, { ok: true });
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }
      return sendJson(res, 200, dexTranslationTable);
    }

    if (pathname === '/api/dex/token-icon-overrides') {
      if (req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req));
          const address = typeof body.address === 'string' ? body.address.toLowerCase() : '';
          const iconUrl = typeof body.iconUrl === 'string' ? body.iconUrl.trim() : '';
          if (!/^0x[a-f0-9]{40}$/.test(address)) {
            return sendJson(res, 400, { error: 'Valid token address required' });
          }

          const current = readTokenIconOverrides();
          const icons = Array.isArray(current.icons) ? current.icons.filter((entry) => entry?.address?.toLowerCase() !== address) : [];
          if (iconUrl) {
            icons.push({ address, iconUrl });
          }

          const next = { version: 1, updatedAt: new Date().toISOString(), icons };
          writeTokenIconOverrides(next);
          return sendJson(res, 200, next);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      return sendJson(res, 200, readTokenIconOverrides());
    }

    if (pathname === '/api/dex/pool-import-presets') {
      if (req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req));
          const selectedPoolAddresses = Array.isArray(body.selectedPoolAddresses)
            ? [...new Set(body.selectedPoolAddresses.filter((entry) => typeof entry === 'string' && entry.length > 0).map((entry) => entry.toLowerCase()))]
            : [];
          const next = {
            version: 1,
            chainId: 1030,
            updatedAt: new Date().toISOString(),
            selectedPoolAddresses,
          };
          writePoolImportPresets(next);
          return sendJson(res, 200, next);
        } catch (err) {
          return sendJson(res, 400, { error: err.message });
        }
      }

      return sendJson(res, 200, readPoolImportPresets());
    }

    if (pathname === '/api/dex/token-icon-upload' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const address = typeof body.address === 'string' ? body.address.toLowerCase() : '';
        const fileName = typeof body.fileName === 'string' ? body.fileName : 'icon.png';
        const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
        if (!/^0x[a-f0-9]{40}$/.test(address)) {
          return sendJson(res, 400, { error: 'Valid token address required' });
        }

        const iconUrl = writeTokenIconFile(address, fileName, dataUrl);
        return sendJson(res, 200, { iconUrl });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'GET' && pathname.startsWith('/api/dex/token-icons/')) {
      const fileName = pathname.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '');
      if (!fileName) {
        return sendJson(res, 404, { error: 'Icon not found' });
      }
      const filePath = join(TOKEN_ICON_FILES_DIR, fileName);
      if (!existsSync(filePath)) {
        return sendJson(res, 404, { error: 'Icon not found' });
      }
      return sendFile(res, filePath);
    }

    // ── Legacy paths (UI reads these) — serve from in-memory state ──────────
    if (req.method === 'GET' && pathname === '/devkit-dex-v2.json') {
      return sendJson(res, 200, dexManifest);
    }
    if (req.method === 'GET' && pathname === '/translation-table.json') {
      return sendJson(res, 200, dexTranslationTable);
    }

    // ── API proxy → devkit (GET + POST) ────────────────────────────────
    if ((req.method === 'GET' || req.method === 'POST') && pathname.startsWith('/api/')) {
      const apiPath = pathname.slice(4);
      try {
        const fetchOpts = {
          method: req.method,
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
        };
        if (req.method === 'POST') {
          fetchOpts.body = await readBody(req);
        }
        const r = await fetch(`${DEVKIT_URL}/api${apiPath}`, fetchOpts);
        const json = await r.json();
        const data = json.data ?? json;
        return sendJson(res, r.status, data);
      } catch (err) {
        return sendJson(res, 503, { error: 'devkit unreachable', detail: err.message });
      }
    }

    // ── Health ───────────────────────────────────────────────────────────
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true, server: 'cfxdevkit-dapp' });
    }

    // ── Token icons — proxied from workspace file server ────────────────────
    if (req.method === 'GET' && pathname.startsWith('/assets/tokens/')) {
      const safePath = pathname.replace(/\.\./g, '');
      try {
        const r = await fetch(`${WORKSPACE_FILESERVER}${safePath}`, { signal: AbortSignal.timeout(5_000) });
        if (r.ok) {
          const buf = await r.arrayBuffer();
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Length': buf.byteLength });
          res.end(Buffer.from(buf));
          return;
        }
      } catch { /* fall through */ }
      return sendJson(res, 404, { error: 'Icon not found' });
    }

    // ── Static files from dist/ ──────────────────────────────────────────
    if (req.method === 'GET') {
      // Try to serve the exact file from dist/
      const safePath = pathname.replace(/\.\./g, '');
      const filePath = join(DIST_DIR, safePath);
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        return sendFile(res, filePath);
      }

      // SPA fallback: serve index.html for client-side routing
      if (hasIndex) {
        return sendFile(res, indexPath);
      }
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Unhandled error:', err);
    sendJson(res, 500, { error: 'Internal server error', detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n⬡  CFX DevKit — DEX UI`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   DevKit: ${DEVKIT_URL}  |  eSpace RPC: ${ESPACE_RPC}`);
  console.log(`   Workspace data: ${WORKSPACE_FILESERVER}\n`);
});
