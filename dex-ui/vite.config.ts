import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { recoverMessageAddress } from 'viem';
import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';

type JsonRecord = Record<string, unknown>;
type DevResponse = ServerResponse<IncomingMessage>;
type Session = { address: string; chainId: number };

type ParsedSiweMessage = {
  address?: string;
  chainId?: number;
  nonce?: string;
  issuedAt?: string;
};

type TokenIconOverride = {
  address: string;
  iconUrl: string;
};

type TokenIconOverridesFile = {
  version: number;
  updatedAt: string;
  icons: TokenIconOverride[];
};

type PoolImportPresetsFile = {
  version: number;
  chainId: number;
  updatedAt: string;
  selectedPoolAddresses: string[];
};

type KnownTokensCatalog = {
  pools?: KnownTokenPool[];
};

type KnownTokenPool = {
  address?: string;
  isWcfxPair?: boolean;
  reserveUsd?: number;
  volume24h?: number;
  baseToken?: { address?: string };
  quoteToken?: { address?: string };
};

type ContractEntry = {
  id: string;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error';
}

function parseJsonRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

async function readJsonBody(req: IncomingMessage): Promise<JsonRecord> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
      continue;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return parseJsonRecord(JSON.parse(Buffer.concat(chunks).toString()));
}

// ── SIWE auth middleware for Vite dev ────────────────────────────────────────
// Mirrors the same logic in server.mjs but as connect middleware.
function siweAuthPlugin(): Plugin {
  const sessions = new Map<string, Session>();
  const pendingNonces = new Map<string, true>();

  function parseCookies(h?: string) {
    const c: Record<string, string> = {};
    if (!h) return c;
    for (const p of h.split(';')) {
      const [k, ...r] = p.trim().split('=');
      if (k) c[k] = r.join('=');
    }
    return c;
  }

  function parseSiweMessage(msg: string): ParsedSiweMessage {
    const lines = msg.split('\n');
    const r: ParsedSiweMessage = {};
    for (const l of lines) {
      if (l.startsWith('Chain ID: ')) r.chainId = Number(l.slice(10));
      else if (l.startsWith('Nonce: ')) r.nonce = l.slice(7);
      else if (l.startsWith('Issued At: ')) r.issuedAt = l.slice(11);
      else if (/^0x[a-fA-F0-9]{40}$/.test(l.trim())) r.address = l.trim();
    }
    return r;
  }

  async function recoverAddress(message: string, signature: string): Promise<string> {
    return recoverMessageAddress({ message, signature: signature as `0x${string}` });
  }

  return {
    name: 'siwe-auth',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: DevResponse, next) => {
        if (!req.url?.startsWith('/api/auth/')) return next();

        res.setHeader('Content-Type', 'application/json');
        const send = (status: number, body: unknown) => {
          res.writeHead(status);
          res.end(JSON.stringify(body));
        };

        try {
          if (req.url === '/api/auth/nonce' && req.method === 'GET') {
            const nonce = randomBytes(16).toString('hex');
            pendingNonces.set(nonce, true);
            setTimeout(() => pendingNonces.delete(nonce), 5 * 60_000);
            return send(200, { nonce });
          }

          if (req.url === '/api/auth/verify' && req.method === 'POST') {
            const body = await readJsonBody(req);
            const message = typeof body.message === 'string' ? body.message : '';
            const signature = typeof body.signature === 'string' ? body.signature : '';
            if (!message || !signature) return send(400, { error: 'Missing message or signature' });

            const parsed = parseSiweMessage(message);
            if (!parsed.address || !parsed.nonce) return send(400, { error: 'Invalid SIWE message' });
            if (!pendingNonces.has(parsed.nonce)) return send(400, { error: 'Invalid or expired nonce' });
            pendingNonces.delete(parsed.nonce);

            if (parsed.issuedAt) {
              const age = Date.now() - new Date(parsed.issuedAt).getTime();
              if (age > 5 * 60_000) return send(400, { error: 'Message expired' });
            }

            const recovered = await recoverAddress(message, signature);
            if (recovered.toLowerCase() !== parsed.address.toLowerCase()) return send(401, { error: 'Signature mismatch' });

            const sid = randomBytes(32).toString('hex');
            sessions.set(sid, { address: parsed.address, chainId: parsed.chainId ?? 1030 });
            res.setHeader('Set-Cookie', `dex_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`);
            return send(200, { ok: true, address: parsed.address });
          }

          if (req.url === '/api/auth/me' && req.method === 'GET') {
            const sid = parseCookies(req.headers.cookie).dex_session;
            const session = sid ? sessions.get(sid) : null;
            if (!session) return send(401, { error: 'Not authenticated' });
            return send(200, session);
          }

          if (req.url === '/api/auth/logout' && req.method === 'POST') {
            const sid = parseCookies(req.headers.cookie).dex_session;
            if (sid) sessions.delete(sid);
            res.setHeader('Set-Cookie', 'dex_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
            return send(200, { ok: true });
          }
        } catch (err: unknown) {
          return send(500, { error: getErrorMessage(err) });
        }
        next();
      });
    },
  };
}

// In dev mode, serve .devkit-contracts.json from the workspace root filesystem
// (devkit doesn't expose it as an HTTP endpoint).
function devkitContractsPlugin(): Plugin {
  const filePath = resolve(__dirname, '../.devkit-contracts.json');
  return {
    name: 'devkit-contracts',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req: IncomingMessage, res: DevResponse, next) => {
        if (req.url === '/devkit-contracts.json') {
          try {
            const data = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : '[]';
            res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
            res.end(data);
          } catch {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
          }
          return;
        }
        next();
      });
    },
  };
}

// Serve contract artifacts + token icons from the workspace filesystem
function localAssetsPlugin(): Plugin {
  const artifactsDir = resolve(__dirname, '../contracts');
  const assetsDir = resolve(__dirname, '../assets');
  const tokenIconOverridesPath = resolve(__dirname, 'public/token-icon-overrides.json');
  const poolImportPresetsPath = resolve(__dirname, 'public/pool-import-presets.json');
  const tokenIconFilesDir = resolve(__dirname, 'public/token-icons');

  function isStablecoinAddress(address: string) {
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

  function getSuggestedPoolAddresses() {
    try {
      const knownTokensPath = resolve(__dirname, 'public/known-tokens.json');
      const parsed = JSON.parse(readFileSync(knownTokensPath, 'utf-8'));
      const catalog: KnownTokensCatalog = isRecord(parsed) ? parsed : {};
      return (catalog.pools ?? [])
        .filter((pool) => pool.isWcfxPair && !isStablecoinAddress(pool.baseToken?.address ?? '') && !isStablecoinAddress(pool.quoteToken?.address ?? ''))
        .sort((left, right) => {
          if ((right.reserveUsd ?? 0) !== (left.reserveUsd ?? 0)) return (right.reserveUsd ?? 0) - (left.reserveUsd ?? 0);
          return (right.volume24h ?? 0) - (left.volume24h ?? 0);
        })
        .slice(0, 5)
        .map((pool) => String(pool.address ?? '').toLowerCase())
        .filter((address) => /^0x[a-f0-9]{40}$/.test(address));
    } catch {
      return [];
    }
  }

  function readTokenIconOverrides(): TokenIconOverridesFile {
    const empty: TokenIconOverridesFile = { version: 1, updatedAt: new Date().toISOString(), icons: [] };
    try {
      if (!existsSync(tokenIconOverridesPath)) {
        return empty;
      }
      const parsed = JSON.parse(readFileSync(tokenIconOverridesPath, 'utf-8'));
      if (!isRecord(parsed)) return empty;
      const icons = Array.isArray(parsed.icons)
        ? parsed.icons
          .filter((entry): entry is TokenIconOverride => isRecord(entry) && typeof entry.address === 'string' && typeof entry.iconUrl === 'string')
          .map((entry) => ({ address: entry.address.toLowerCase(), iconUrl: entry.iconUrl }))
        : [];
      return {
        version: typeof parsed.version === 'number' ? parsed.version : 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
        icons,
      };
    } catch {
      return empty;
    }
  }

  function writeTokenIconOverrides(data: TokenIconOverridesFile) {
    writeFileSync(tokenIconOverridesPath, `${JSON.stringify(data, null, 2)}\n`);
  }

  function readPoolImportPresets(): PoolImportPresetsFile {
    try {
      const suggestedPoolAddresses = getSuggestedPoolAddresses();
      if (!existsSync(poolImportPresetsPath)) {
        return { version: 1, chainId: 1030, updatedAt: new Date().toISOString(), selectedPoolAddresses: suggestedPoolAddresses };
      }
      const parsed = JSON.parse(readFileSync(poolImportPresetsPath, 'utf-8'));
      const data = parseJsonRecord(parsed);
      const selectedPoolAddresses = Array.isArray(data.selectedPoolAddresses)
        ? [...new Set(data.selectedPoolAddresses.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0).map((entry) => entry.toLowerCase()))]
        : [];
      if (selectedPoolAddresses.length === 0) {
        return {
          version: typeof data.version === 'number' ? data.version : 1,
          chainId: typeof data.chainId === 'number' ? data.chainId : 1030,
          updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
          selectedPoolAddresses: suggestedPoolAddresses,
        };
      }
      return {
        version: typeof data.version === 'number' ? data.version : 1,
        chainId: typeof data.chainId === 'number' ? data.chainId : 1030,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : new Date().toISOString(),
        selectedPoolAddresses,
      };
    } catch {
      return { version: 1, chainId: 1030, updatedAt: new Date().toISOString(), selectedPoolAddresses: getSuggestedPoolAddresses() };
    }
  }

  function writePoolImportPresets(data: PoolImportPresetsFile) {
    writeFileSync(poolImportPresetsPath, `${JSON.stringify(data, null, 2)}\n`);
  }

  function writeTokenIconFile(address: string, dataUrl: string) {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) throw new Error('Invalid image payload');
    const mime = match[1];
    const payload = match[2];
    const ext = mime === 'image/jpeg' ? '.jpg'
      : mime === 'image/webp' ? '.webp'
      : mime === 'image/gif' ? '.gif'
      : mime === 'image/svg+xml' ? '.svg'
      : '.png';
    mkdirSync(tokenIconFilesDir, { recursive: true });
    const fileName = `${address.toLowerCase()}${ext}`;
    writeFileSync(resolve(tokenIconFilesDir, fileName), Buffer.from(payload, 'base64'));
    return `/api/dex/token-icons/${fileName}`;
  }

  function getMimeType(fileName: string) {
    if (fileName.endsWith('.svg')) return 'image/svg+xml';
    if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) return 'image/jpeg';
    if (fileName.endsWith('.webp')) return 'image/webp';
    if (fileName.endsWith('.gif')) return 'image/gif';
    return 'image/png';
  }

  return {
    name: 'local-assets',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req: IncomingMessage, res: DevResponse, next) => {
        // Contract artifacts: /api/dex/artifact/:name
        if (req.url?.startsWith('/api/dex/artifact/')) {
          const name = req.url.split('/').pop()?.replace(/[^a-zA-Z0-9_-]/g, '');
          if (name) {
            const artPath = resolve(artifactsDir, `${name}.json`);
            if (existsSync(artPath)) {
              try {
                const art = JSON.parse(readFileSync(artPath, 'utf-8'));
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ abi: art.abi, bytecode: art.bytecode }));
                return;
              } catch { /* fall through */ }
            }
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Artifact not found' }));
          return;
        }
        // Contract tracking: POST /api/dex/contracts
        if (req.url === '/api/dex/contracts' && req.method === 'POST') {
          const body = await readJsonBody(req);
          const { name, address: addr, chain, deployer, txHash, abi, chainId, metadata } = body;
          if (typeof name !== 'string' || typeof addr !== 'string' || !name || !addr) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'name and address required' }));
            return;
          }
          const contractsPath = resolve(__dirname, '../.devkit-contracts.json');
          const parsed = existsSync(contractsPath) ? JSON.parse(readFileSync(contractsPath, 'utf-8')) : [];
          const existing: ContractEntry[] = Array.isArray(parsed)
            ? parsed.filter((entry): entry is ContractEntry => isRecord(entry) && typeof entry.id === 'string').map((entry) => ({ ...entry }))
            : [];
          const chainValue = typeof chain === 'string' && chain.length > 0 ? chain : 'evm';
          const id = `${chainValue}-${addr.toLowerCase()}`;
          const entry = {
            id,
            name,
            address: addr.toLowerCase(),
            chain: chainValue,
            deployer: typeof deployer === 'string' ? deployer : '',
            txHash: typeof txHash === 'string' ? txHash : '',
            deployedAt: new Date().toISOString(),
            chainId: typeof chainId === 'number' ? chainId : 2030,
            ...(abi ? { abi: typeof abi === 'string' ? abi : JSON.stringify(abi) } : {}),
            ...(metadata && typeof metadata === 'object' ? { metadata } : {}),
          };
          const idx = existing.findIndex((c) => c.id === id);
          if (idx >= 0) existing[idx] = entry; else existing.push(entry);
          writeFileSync(contractsPath, JSON.stringify(existing, null, 2));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(entry));
          return;
        }
        if (req.url === '/api/dex/token-icon-overrides') {
          if (req.method === 'POST') {
            try {
              const body = await readJsonBody(req);
              const address = typeof body.address === 'string' ? body.address.toLowerCase() : '';
              const iconUrl = typeof body.iconUrl === 'string' ? body.iconUrl.trim() : '';
              if (!/^0x[a-f0-9]{40}$/.test(address)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Valid token address required' }));
                return;
              }

              const current = readTokenIconOverrides();
              const icons = current.icons.filter((entry) => entry.address.toLowerCase() !== address);
              if (iconUrl) {
                icons.push({ address, iconUrl });
              }

              const nextData = { version: 1, updatedAt: new Date().toISOString(), icons };
              writeTokenIconOverrides(nextData);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(nextData));
              return;
            } catch (err: unknown) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: getErrorMessage(err) }));
              return;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(readTokenIconOverrides()));
          return;
        }
        if (req.url === '/api/dex/pool-import-presets') {
          if (req.method === 'POST') {
            try {
              const body = await readJsonBody(req);
              const selectedPoolAddresses = Array.isArray(body.selectedPoolAddresses)
                ? [...new Set(body.selectedPoolAddresses.filter((entry: unknown) => typeof entry === 'string' && entry.length > 0).map((entry: string) => entry.toLowerCase()))]
                : [];
              const nextData = { version: 1, chainId: 1030, updatedAt: new Date().toISOString(), selectedPoolAddresses };
              writePoolImportPresets(nextData);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(nextData));
              return;
            } catch (err: unknown) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: getErrorMessage(err) }));
              return;
            }
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(readPoolImportPresets()));
          return;
        }
        if (req.url === '/api/dex/token-icon-upload' && req.method === 'POST') {
          try {
            const body = await readJsonBody(req);
            const address = typeof body.address === 'string' ? body.address.toLowerCase() : '';
            const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
            if (!/^0x[a-f0-9]{40}$/.test(address)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Valid token address required' }));
              return;
            }
            const iconUrl = writeTokenIconFile(address, dataUrl);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ iconUrl }));
            return;
          } catch (err: unknown) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: getErrorMessage(err) }));
            return;
          }
        }
        if (req.url?.startsWith('/api/dex/token-icons/')) {
          const fileName = req.url.split('/').pop()?.replace(/[^a-zA-Z0-9._-]/g, '');
          if (fileName) {
            const iconPath = resolve(tokenIconFilesDir, fileName);
            if (existsSync(iconPath)) {
              res.writeHead(200, { 'Content-Type': getMimeType(fileName) });
              res.end(readFileSync(iconPath));
              return;
            }
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Icon not found' }));
          return;
        }
        // Token icons: /assets/tokens/{chainId}/{address}.png
        if (req.url?.startsWith('/assets/tokens/')) {
          const safePath = req.url.replace(/\.\./g, '');
          const iconPath = resolve(assetsDir, safePath.replace(/^\/assets\//, ''));
          if (existsSync(iconPath)) {
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(readFileSync(iconPath));
            return;
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Icon not found' }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), siweAuthPlugin(), devkitContractsPlugin(), localAssetsPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom', 'wagmi', 'viem', '@tanstack/react-query'],
  },
  server: {
    port: 3001,
    proxy: {
      '/rpc': {
        target: 'http://localhost:8545',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc/, ''),
      },
      // Proxy /api/* to devkit, EXCEPT routes handled by local plugins
      '/api': {
        target: 'http://localhost:7748',
        changeOrigin: true,
        bypass(req) {
          const u = req.url ?? '';
          // These routes are handled by Vite plugins (localAssetsPlugin, siweAuthPlugin)
          if (u.startsWith('/api/dex/')) return u;
          if (u.startsWith('/api/auth/')) return u;
          if (u.startsWith('/assets/')) return u;
          // Everything else goes to devkit
          return undefined;
        },
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
