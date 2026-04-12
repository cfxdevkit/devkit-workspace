import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deployBootstrapContract,
  deployContractTemplate,
  generateMnemonicWords,
  getAccounts,
  getBootstrapCatalog,
  getContractTemplates,
  getDeployedContracts,
  getFullStatus,
  getKeystoreStatus,
  getMiningStatus,
  getNodeStatus,
  isDevkitServerRunning,
  lockKeystore,
  mine,
  restartNode,
  restartWipeNode,
  setupKeystore,
  startMining,
  startNode,
  stopMining,
  stopNode,
  unlockKeystore,
  wipeNodeData,
} from '../confluxdevkit';

// ── Mock fetch ────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mockNetworkError(): void {
  mockFetch.mockRejectedValueOnce(new Error('Network error'));
}

const TEST_CFG = { port: 7748 };

const STOPPED_STATUS = {
  server: 'stopped',
  mining: null,
  rpcUrls: null,
  accounts: 0,
};

const RUNNING_STATUS = {
  server: 'running',
  mining: { isRunning: true, blocksMined: 10 },
  rpcUrls: { core: 'http://127.0.0.1:12537', evm: 'http://127.0.0.1:8545' },
  accounts: 10,
};

// ── isDevkitServerRunning ─────────────────────────────────────────────────────

describe('isDevkitServerRunning', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns true when /health responds 200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    expect(await isDevkitServerRunning(TEST_CFG)).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/health',
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  it('returns false when /health responds non-200', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);
    expect(await isDevkitServerRunning(TEST_CFG)).toBe(false);
  });

  it('returns false on network error', async () => {
    mockNetworkError();
    expect(await isDevkitServerRunning(TEST_CFG)).toBe(false);
  });
});

// ── getNodeStatus ─────────────────────────────────────────────────────────────

describe('getNodeStatus', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns node status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(RUNNING_STATUS));
    const status = await getNodeStatus(TEST_CFG);
    expect(status.server).toBe('running');
    expect(status.accounts).toBe(10);
    expect(status.rpcUrls?.evm).toBe('http://127.0.0.1:8545');
  });

  it('throws on API error', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Internal error' }, 500));
    await expect(getNodeStatus(TEST_CFG)).rejects.toThrow('Internal error');
  });
});

// ── startNode ─────────────────────────────────────────────────────────────────

describe('startNode', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/node/start and returns status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: RUNNING_STATUS }));
    const status = await startNode(TEST_CFG);
    expect(status.server).toBe('running');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/node/start',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ── stopNode ──────────────────────────────────────────────────────────────────

describe('stopNode', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/node/stop', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, server: 'stopped' }));
    await expect(stopNode(TEST_CFG)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/node/stop',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ── restartNode ───────────────────────────────────────────────────────────────

describe('restartNode', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/node/restart and returns status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: RUNNING_STATUS }));
    const status = await restartNode(TEST_CFG);
    expect(status.server).toBe('running');
  });
});

// ── getAccounts ───────────────────────────────────────────────────────────────

describe('getAccounts', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns list of accounts', async () => {
    const accounts = [
      { index: 0, coreAddress: 'cfx:aak...', evmAddress: '0xabc...', coreBalance: '1000' },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(accounts));
    const result = await getAccounts(TEST_CFG);
    expect(result).toHaveLength(1);
    expect(result[0].index).toBe(0);
    expect(result[0].coreAddress).toBe('cfx:aak...');
  });
});

// ── getContractTemplates ──────────────────────────────────────────────────────

describe('getContractTemplates', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns list of templates', async () => {
    const templates = [
      { name: 'Counter', description: 'Simple counter contract' },
      { name: 'TestToken', description: 'ERC-20 test token' },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(templates));
    const result = await getContractTemplates(TEST_CFG);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Counter');
  });
});

// ── deployContractTemplate ────────────────────────────────────────────────────

describe('deployContractTemplate', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('sends deploy request and returns contract', async () => {
    const deployed = { id: 'abc', name: 'Counter', address: '0x123', chain: 'evm' };
    mockFetch.mockResolvedValueOnce(mockResponse(deployed));
    const result = await deployContractTemplate('Counter', [], 'evm', 0, TEST_CFG);
    expect(result.address).toBe('0x123');
    expect(result.chain).toBe('evm');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/contracts/deploy',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ contractName: 'Counter', args: [], chain: 'evm', accountIndex: 0 }),
      })
    );
  });

  it('defaults to evm chain', async () => {
    const deployed = { id: 'def', name: 'SimpleStorage', address: '0x456', chain: 'evm' };
    mockFetch.mockResolvedValueOnce(mockResponse(deployed));
    const result = await deployContractTemplate('SimpleStorage', [], undefined as unknown as 'evm', 0, TEST_CFG);
    expect(result.chain).toBe('evm');
  });
});

// ── getDeployedContracts ──────────────────────────────────────────────────────

describe('getDeployedContracts', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns deployed contracts list', async () => {
    const contracts = [
      { id: '1', name: 'Counter', address: '0xaaa', chain: 'evm' },
      { id: '2', name: 'TestToken', address: '0xbbb', chain: 'core' },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(contracts));
    const result = await getDeployedContracts(TEST_CFG);
    expect(result).toHaveLength(2);
    expect(result[1].chain).toBe('core');
  });
});

// ── mine ──────────────────────────────────────────────────────────────────────

describe('mine', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/mining/mine with block count', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, mined: 5 }));
    await expect(mine(5, TEST_CFG)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/mining/mine',
      expect.objectContaining({ body: JSON.stringify({ blocks: 5 }) })
    );
  });

  it('defaults to 1 block', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, mined: 1 }));
    await mine(undefined, TEST_CFG);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ blocks: 1 }) })
    );
  });
});

// ── getMiningStatus ───────────────────────────────────────────────────────────

describe('getMiningStatus', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns mining status', async () => {
    const miningStatus = { isRunning: true, interval: 2000, blocksMined: 42 };
    mockFetch.mockResolvedValueOnce(mockResponse(miningStatus));
    const result = await getMiningStatus(TEST_CFG);
    expect(result.isRunning).toBe(true);
    expect(result.blocksMined).toBe(42);
  });
});

// ── startMining / stopMining ──────────────────────────────────────────────────

describe('startMining', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/mining/start', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: { isRunning: true, interval: 3000 } }));
    const result = await startMining(3000, TEST_CFG);
    expect(result.isRunning).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/mining/start',
      expect.objectContaining({ body: JSON.stringify({ intervalMs: 3000 }) })
    );
  });
});

describe('stopMining', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/mining/stop', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: { isRunning: false } }));
    const result = await stopMining(TEST_CFG);
    expect(result.isRunning).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/mining/stop',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('throws descriptive error when server is offline', async () => {
    mockNetworkError();
    await expect(getNodeStatus(TEST_CFG)).rejects.toThrow();
  });

  it('throws API error message from response body', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Node is not running. Start it first.' }, 500));
    await expect(startNode(TEST_CFG)).rejects.toThrow('Node is not running. Start it first.');
  });

  it('uses default port 7748 when no config provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    await isDevkitServerRunning();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/health',
      expect.anything()
    );
  });
});

// ── Keystore lifecycle ────────────────────────────────────────────────────────

describe('getKeystoreStatus', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns keystore status', async () => {
    const ks = { initialized: true, locked: false, encryptionEnabled: false };
    mockFetch.mockResolvedValueOnce(mockResponse(ks));
    const result = await getKeystoreStatus(TEST_CFG);
    expect(result.initialized).toBe(true);
    expect(result.locked).toBe(false);
  });

  it('returns not-initialized state', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ initialized: false, locked: false, encryptionEnabled: false }));
    const result = await getKeystoreStatus(TEST_CFG);
    expect(result.initialized).toBe(false);
  });
});

describe('generateMnemonicWords', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns a mnemonic string from POST /api/keystore/generate', async () => {
    const mnemonic = 'word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12';
    mockFetch.mockResolvedValueOnce(mockResponse({ mnemonic }));
    const result = await generateMnemonicWords(TEST_CFG);
    expect(result).toBe(mnemonic);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/keystore/generate',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('setupKeystore', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/keystore/setup with mnemonic and label', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));
    const mnemonic = 'test mnemonic phrase';
    await setupKeystore(mnemonic, 'MyWallet', undefined, TEST_CFG);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/keystore/setup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ mnemonic, label: 'MyWallet' }),
      })
    );
  });

  it('includes password when provided', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));
    await setupKeystore('mnemonic', 'Default', 'secret', TEST_CFG);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ mnemonic: 'mnemonic', label: 'Default', password: 'secret' }),
      })
    );
  });
});

describe('unlockKeystore / lockKeystore', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('unlocks keystore with password', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));
    await unlockKeystore('mypassword', TEST_CFG);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/keystore/unlock',
      expect.objectContaining({ body: JSON.stringify({ password: 'mypassword' }) })
    );
  });

  it('locks keystore', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true }));
    await lockKeystore(TEST_CFG);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/keystore/lock',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ── Wipe / restart-wipe ───────────────────────────────────────────────────────

describe('restartWipeNode', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/node/restart-wipe and returns status', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, status: RUNNING_STATUS }));
    const status = await restartWipeNode(TEST_CFG);
    expect(status.server).toBe('running');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/node/restart-wipe',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

describe('wipeNodeData', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/node/wipe', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ ok: true, server: 'stopped' }));
    await expect(wipeNodeData(TEST_CFG)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/node/wipe',
      expect.objectContaining({ method: 'POST' })
    );
  });
});

// ── Bootstrap catalog ─────────────────────────────────────────────────────────

describe('getBootstrapCatalog', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns the bootstrap catalog', async () => {
    const catalog = [
      { name: 'ERC20Base', category: 'tokens', description: 'ERC-20 token', chains: ['evm', 'core'], constructorArgs: [] },
      { name: 'MultiSigWallet', category: 'governance', description: 'Multi-signature wallet', chains: ['evm'], constructorArgs: [] },
    ];
    mockFetch.mockResolvedValueOnce(mockResponse(catalog));
    const result = await getBootstrapCatalog(TEST_CFG);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('ERC20Base');
    expect(result[0].category).toBe('tokens');
  });
});

describe('deployBootstrapContract', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('calls POST /api/bootstrap/deploy and returns contract', async () => {
    const contract = { id: 'xyz', name: 'ERC20Base', address: '0xdeadbeef', chain: 'evm' };
    mockFetch.mockResolvedValueOnce(mockResponse(contract));
    const result = await deployBootstrapContract('ERC20Base', ['TestToken', 'TT', 1000000], 'evm', 0, TEST_CFG);
    expect(result.address).toBe('0xdeadbeef');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:7748/api/bootstrap/deploy',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'ERC20Base', args: ['TestToken', 'TT', 1000000], chain: 'evm', accountIndex: 0 }),
      })
    );
  });
});

// ── getFullStatus ─────────────────────────────────────────────────────────────

describe('getFullStatus', () => {
  afterEach(() => { mockFetch.mockReset(); });

  it('returns nextStep to start server when offline', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);
    const status = await getFullStatus(TEST_CFG);
    expect(status.serverOnline).toBe(false);
    expect(status.nextStep).toContain('Start the conflux-devkit server');
  });

  it('returns nextStep to setup keystore when not initialized', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response); // health
    mockFetch.mockResolvedValueOnce(mockResponse({ initialized: false, locked: false, encryptionEnabled: false })); // keystore
    mockFetch.mockResolvedValueOnce(mockResponse(STOPPED_STATUS)); // node
    const status = await getFullStatus(TEST_CFG);
    expect(status.serverOnline).toBe(true);
    expect(status.nextStep).toContain('conflux_setup_init');
  });

  it('returns nodeRunning=true when all good', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response); // health
    mockFetch.mockResolvedValueOnce(mockResponse({ initialized: true, locked: false, encryptionEnabled: false })); // keystore
    mockFetch.mockResolvedValueOnce(mockResponse(RUNNING_STATUS)); // node
    const status = await getFullStatus(TEST_CFG);
    expect(status.serverOnline).toBe(true);
    expect(status.nodeRunning).toBe(true);
    expect(status.nextStep).toContain('Node is running');
  });
});
