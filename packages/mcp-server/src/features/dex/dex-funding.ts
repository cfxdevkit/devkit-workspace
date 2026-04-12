import { EspaceWalletClient } from '@cfxdevkit/core';
import { fundAccount, mine as mineBlocks } from '@cfxdevkit/shared';
import { fundViaBackend, mineViaBackend } from './dex-backend-client.js';

const WEI_PER_CFX = 10n ** 18n;
const CFX_PER_BLOCK = 7;
const FUNDING_MINE_BATCH = 250;
const FUNDING_BRIDGE_CHUNK = 5_000;

function toWeiFromDecimalString(value: string): bigint {
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole + frac.padEnd(18, '0').slice(0, 18));
}

function formatCfxAmount(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(1);
}

export async function ensureEspaceFunding(params: {
  devkitUrl?: string;
  rpcUrl: string;
  chainId: number;
  wallet?: EspaceWalletClient;
  deployer: string;
  privateKey: string;
  requiredWei: bigint;
  label: string;
  fundingLines?: string[];
  logPrefix?: string;
}): Promise<void> {
  const {
    devkitUrl = process.env.DEVKIT_URL ?? 'http://127.0.0.1:7748',
    rpcUrl,
    chainId,
    deployer,
    privateKey,
    requiredWei,
    label,
    fundingLines,
    logPrefix = '[dex_seed]',
  } = params;
  if (requiredWei <= 0n) return;

  const wallet = params.wallet ?? new EspaceWalletClient({ rpcUrl, chainId, privateKey });
  const currentWei = toWeiFromDecimalString(await wallet.getBalance(deployer as `0x${string}`));
  if (currentWei >= requiredWei) return;

  const deficitWei = requiredWei - currentWei;
  fundingLines?.push(
    `  💰 ${label}: need ${formatCfxAmount(requiredWei)} CFX, have ${formatCfxAmount(currentWei)} CFX`,
    `     Short ${formatCfxAmount(deficitWei)} CFX - mining and bridging in stages...`,
  );

  const blocksNeeded = Math.max(1, Math.ceil(Number(deficitWei) / 1e18 / CFX_PER_BLOCK));
  let lastLoggedAt = 0;
  let nextMilestone = 25;

  for (let mined = 0; mined < blocksNeeded; mined += FUNDING_MINE_BATCH) {
    const batch = Math.min(FUNDING_MINE_BATCH, blocksNeeded - mined);
    try {
      const minedViaBackend = await mineViaBackend(batch, devkitUrl);
      if (!minedViaBackend) {
        await mineBlocks(batch);
      }
    } catch {
      // non-critical
    }

    const completed = mined + batch;
    const percent = Math.min(100, Math.floor((completed / blocksNeeded) * 100));
    const now = Date.now();
    if (now - lastLoggedAt >= 10_000 || percent >= nextMilestone || completed >= blocksNeeded) {
      console.error(`${logPrefix}   ⛏️  ${label}: mined ${completed.toLocaleString()}/${blocksNeeded.toLocaleString()} blocks (${percent}%)`);
      lastLoggedAt = now;
      while (percent >= nextMilestone) nextMilestone += 25;
    }
  }

  let remainingWei = deficitWei;
  const maxIterations = Math.ceil(Number(remainingWei) / 1e18 / FUNDING_BRIDGE_CHUNK) + 10;
  for (let iteration = 0; iteration < maxIterations && remainingWei > 0n; iteration++) {
    const wantedCfx = Math.max(1, Math.min(FUNDING_BRIDGE_CHUNK, Math.ceil(Number(remainingWei) / 1e18)));
    let funded = false;

    for (const amount of [wantedCfx, Math.ceil(wantedCfx / 2), Math.ceil(wantedCfx / 4), 100, 25, 1]) {
      if (amount < 1) continue;
      try {
        const fundedViaBackend = await fundViaBackend(deployer, amount, devkitUrl);
        if (!fundedViaBackend) {
          await fundAccount(deployer, String(amount), 'evm');
        }
        const sentWei = BigInt(amount) * WEI_PER_CFX;
        remainingWei = remainingWei > sentWei ? remainingWei - sentWei : 0n;
        console.error(`${logPrefix}   💸 ${label}: bridged ${amount.toLocaleString()} CFX (${formatCfxAmount(remainingWei)} left)`);
        funded = true;
        break;
      } catch {
        // try smaller chunk
      }
    }

    if (!funded) break;
  }

  const finalWei = toWeiFromDecimalString(await wallet.getBalance(deployer as `0x${string}`));
  if (finalWei < requiredWei) {
    throw new Error(`${label}: still short ${formatCfxAmount(requiredWei - finalWei)} CFX after staged funding`);
  }
}
