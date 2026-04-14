import { describeTargetFeatures, featureFlagLabel } from '../../../ui-shared/src/devkit.js';
import { getRuntimeSnapshot } from '../providers.js';

export function renderRuntimePanel() {
  const runtime = getRuntimeSnapshot();
  const featureMarkup = describeTargetFeatures(runtime.target.features)
    .map((feature) => `<li><span>${feature.label}</span><strong>${featureFlagLabel(feature.enabled)}</strong></li>`)
    .join('');

  return `
    <article class="card">
      <h2>Runtime Surface</h2>
      <div class="row"><span>Target</span><strong>${runtime.target.description}</strong></div>
      <div class="row"><span>RPC path</span><strong>${runtime.rpcUrl}</strong></div>
      <div class="row"><span>Backend path</span><strong>${runtime.backendUrl}</strong></div>
      <ul class="flags">${featureMarkup}</ul>
    </article>
  `;
}
