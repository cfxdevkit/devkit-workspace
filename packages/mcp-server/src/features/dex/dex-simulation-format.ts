import type { TickResult } from '@cfxdevkit/shared';

export function formatTickResult(result: TickResult): string {
  const lines: string[] = [
    `Tick #${result.tick}  |  processed=${result.processed}  skipped=${result.skipped}  exhausted=${result.exhausted}${result.done ? '  DONE' : ''}`,
  ];

  for (const r of result.results) {
    if (r.method === 'skipped') {
      lines.push(`  ${r.symbol.padEnd(10)} skipped (${r.deviationBps}bps < threshold)`);
    } else {
      const arrow = r.error ? '❌' : '✓';
      lines.push(
        `  ${arrow} ${r.symbol.padEnd(10)} ${r.method}  ${r.priceBefore.toPrecision(4)} → ${r.priceAfter.toPrecision(4)}  ` +
        `(target=${r.targetPrice.toPrecision(4)}, dev=${r.deviationBps}bps)` +
        (r.error ? `  ERR: ${r.error}` : ''),
      );
    }
  }

  return lines.join('\n');
}
