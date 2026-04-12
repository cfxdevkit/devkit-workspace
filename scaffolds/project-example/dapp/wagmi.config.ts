import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@wagmi/cli/config';
import { actions, react } from '@wagmi/cli/plugins';

const artifactPath = resolve(import.meta.dirname, '..', 'contracts', 'generated', 'ExampleCounter.json');

if (!existsSync(artifactPath)) {
  throw new Error(
    `Compiled artifact not found: ${artifactPath}\n` +
    `Run: pnpm --filter contracts compile\n` +
    `Or from the project root: pnpm contracts:compile`
  );
}

const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as {
  contractName: string;
  abi: readonly unknown[];
};

export default defineConfig({
  out: 'src/generated/hooks.ts',
  contracts: [
    {
      name: artifact.contractName,
      abi: artifact.abi as never,
    },
  ],
  plugins: [
    actions({ overridePackageName: 'wagmi' }),
    react(),
  ],
});
