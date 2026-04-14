export function renderWorkspacePanel() {
  return `
    <section class="card muted">
      <h2>Workspace Layout</h2>
      <ul>
        <li><code>dapp/</code> holds the browser application and generated target metadata</li>
        <li><code>contracts/</code> holds source and generated contract artifacts</li>
        <li><code>scripts/</code> holds doctor, network sync, contract metadata, and listing utilities</li>
        <li><code>ui-shared/</code> is copied from the canonical package at scaffold generation time</li>
        <li><code>.devcontainer/</code> references the shared infrastructure image with baked backend and extension</li>
      </ul>
    </section>
  `;
}
