import {
  deriveAccount,
  generateMnemonic,
} from '@cfxdevkit/core/wallet';
import { getKeystoreService } from '@cfxdevkit/services';

function resolveAccountsCount(override?: number): number {
  if (Number.isInteger(override) && (override as number) > 0) {
    return override as number;
  }
  const envRaw = process.env.CFXDEVKIT_ACCOUNTS_COUNT?.trim();
  if (!envRaw) return 5;
  const parsed = Number(envRaw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

function buildDefaultNodeConfig(accountsCount?: number): {
  accountsCount: number;
  chainId: number;
  evmChainId: number;
} {
  return {
    accountsCount: resolveAccountsCount(accountsCount),
    chainId: 2029,
    evmChainId: 2030,
  };
}

export class KeystoreApplicationService {
  async getStatus(): Promise<{
    initialized: boolean;
    locked: boolean;
    encryptionEnabled: boolean;
  }> {
    const ks = getKeystoreService();
    const ready = await ks.isSetupCompleted();
    return {
      initialized: ready,
      locked: ready ? ks.isLocked() : false,
      encryptionEnabled: ready ? ks.isEncryptionEnabled() : false,
    };
  }

  generateMnemonic(): { mnemonic: string } {
    return { mnemonic: generateMnemonic() };
  }

  async completeSetup(params: {
    mnemonic: string;
    label: string;
    password?: string;
    accountsCount?: number;
  }): Promise<{ ok: true }> {
    const ks = getKeystoreService();
    const adminAddress = deriveAccount(params.mnemonic, 0).evmAddress;
    await ks.completeSetup({
      adminAddress,
      mnemonic: params.mnemonic,
      mnemonicLabel: params.label,
      nodeConfig: buildDefaultNodeConfig(params.accountsCount),
      ...(params.password ? { encryption: { enabled: true, password: params.password } } : {}),
    });
    return { ok: true };
  }

  async unlock(password: string): Promise<{ ok: true }> {
    const ks = getKeystoreService();
    await ks.unlockKeystore(password);
    return { ok: true };
  }

  async lock(): Promise<{ ok: true }> {
    const ks = getKeystoreService();
    await ks.lockKeystore();
    return { ok: true };
  }

  async listWallets(): Promise<unknown[]> {
    const ks = getKeystoreService();
    if (!(await ks.isSetupCompleted())) {
      return [];
    }
    return ks.listMnemonics();
  }

  async addWallet(params: {
    mnemonic: string;
    label: string;
    setAsActive?: boolean;
    accountsCount?: number;
  }): Promise<{ ok: true; id: string }> {
    const ks = getKeystoreService();
    const entry = await ks.addMnemonic({
      mnemonic: params.mnemonic,
      label: params.label,
      nodeConfig: buildDefaultNodeConfig(params.accountsCount),
      setAsActive: params.setAsActive ?? false,
    });
    return { ok: true, id: entry.id };
  }

  async activateWallet(id: string): Promise<{ ok: true }> {
    const ks = getKeystoreService();
    await ks.switchActiveMnemonic(id);
    return { ok: true };
  }

  async deleteWallet(id: string, deleteData: boolean): Promise<{ ok: true }> {
    const ks = getKeystoreService();
    await ks.deleteMnemonic(id, deleteData);
    return { ok: true };
  }

  async updateWalletLabel(id: string, label: string): Promise<{ ok: true }> {
    const ks = getKeystoreService();
    await ks.updateMnemonicLabel(id, label);
    return { ok: true };
  }
}
