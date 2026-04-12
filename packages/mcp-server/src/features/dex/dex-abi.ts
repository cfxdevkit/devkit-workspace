import type { ContractArtifact } from '@cfxdevkit/dex-contracts';

export function createDexAbiAccessors(loadArtifact: (name: string) => ContractArtifact) {
  function abiPick(artifactName: string, names: string[]): unknown[] {
    const art = loadArtifact(artifactName);
    const set = new Set(names);
    return art.abi.filter((e: unknown) => {
      const entry = e as Record<string, unknown>;
      return typeof entry.name === 'string' && set.has(entry.name);
    });
  }

  let erc20Abi: unknown[] | null = null;
  let pairAbi: unknown[] | null = null;
  let routerAbi: unknown[] | null = null;
  let factoryAbi: unknown[] | null = null;
  let wethAbi: unknown[] | null = null;
  let mirrorAbi: unknown[] | null = null;

  function ERC20_ABI() {
    if (!erc20Abi) {
      erc20Abi = abiPick('MirrorERC20', ['approve', 'transfer', 'balanceOf', 'symbol', 'decimals', 'totalSupply', 'mint']);
    }
    return erc20Abi;
  }

  function PAIR_ABI() {
    if (!pairAbi) {
      pairAbi = abiPick('UniswapV2Pair', ['getReserves', 'sync', 'token0', 'token1', 'totalSupply', 'balanceOf', 'approve', 'transfer']);
    }
    return pairAbi;
  }

  function ROUTER_ABI() {
    if (!routerAbi) {
      routerAbi = abiPick('UniswapV2Router02', [
        'swapExactTokensForTokens', 'swapExactETHForTokens', 'swapExactTokensForETH',
        'addLiquidity', 'addLiquidityETH', 'removeLiquidity', 'removeLiquidityETH',
        'getAmountsOut', 'factory', 'WETH',
      ]);
    }
    return routerAbi;
  }

  function FACTORY_ABI() {
    if (!factoryAbi) {
      factoryAbi = abiPick('UniswapV2Factory', ['getPair', 'allPairsLength', 'allPairs', 'createPair']);
    }
    return factoryAbi;
  }

  function WETH_ABI() {
    if (!wethAbi) {
      wethAbi = abiPick('WETH9', ['deposit', 'withdraw', 'approve', 'transfer', 'balanceOf']);
    }
    return wethAbi;
  }

  function MIRROR_ABI() {
    if (!mirrorAbi) {
      mirrorAbi = abiPick('MirrorERC20', ['mint', 'approve', 'transfer', 'balanceOf', 'symbol', 'decimals']);
    }
    return mirrorAbi;
  }

  return {
    ERC20_ABI,
    PAIR_ABI,
    ROUTER_ABI,
    FACTORY_ABI,
    WETH_ABI,
    MIRROR_ABI,
  };
}
