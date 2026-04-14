import { renderOverviewPanel } from './components/OverviewPanel.js';
import { renderRuntimePanel } from './components/RuntimePanel.js';
import { renderContractPanel } from './components/ContractPanel.js';
import { renderWorkspacePanel } from './components/WorkspacePanel.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="layout">
    ${renderOverviewPanel()}
    <section class="grid">
      ${renderRuntimePanel()}
      ${renderContractPanel()}
    </section>
    ${renderWorkspacePanel()}
  </main>
`;
