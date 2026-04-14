import { getDefaultChainLabel } from '../chains.js';
import { getRuntimeSnapshot } from '../providers.js';

export function renderOverviewPanel() {
  const runtime = getRuntimeSnapshot();
  return `
    <section class="hero">
      <p class="eyebrow">New DevKit Reference Scaffold</p>
      <h1>{{PROJECT_NAME}}</h1>
      <p class="lede">A richer monorepo example with a browser app package, a contracts package, root utility scripts, copied shared helpers, and generated target metadata.</p>
      <div class="hero-grid">
        <div class="pill"><span>Default chain</span><strong>${getDefaultChainLabel()}</strong></div>
        <div class="pill"><span>Target</span><strong>${runtime.target.name}</strong></div>
        <div class="pill"><span>Network profile</span><strong>${runtime.network}</strong></div>
      </div>
    </section>
  `;
}
