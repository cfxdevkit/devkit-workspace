export type ExtensionCapabilityFamily = {
  commandFamily: string;
  extensionExamples: string[];
  mcpTools: string[];
  notes?: string;
};

export const EXTENSION_CAPABILITY_MAP: ExtensionCapabilityFamily[] = [
  {
    commandFamily: 'Server lifecycle',
    extensionExamples: ['cfxdevkit.serverStart', 'cfxdevkit.serverStop', 'cfxdevkit.shutdown'],
    mcpTools: ['conflux_server_start', 'conflux_status', 'conflux_node_stop', 'backend_health'],
  },
  {
    commandFamily: 'Keystore lifecycle',
    extensionExamples: ['cfxdevkit.initializeSetup', 'cfxdevkit.unlockKeystore'],
    mcpTools: ['conflux_setup_init', 'conflux_keystore_status', 'conflux_keystore_unlock', 'conflux_keystore_lock'],
  },
  {
    commandFamily: 'Node lifecycle',
    extensionExamples: ['cfxdevkit.nodeStart', 'cfxdevkit.nodeRestart', 'cfxdevkit.nodeWipeRestart'],
    mcpTools: ['conflux_node_start', 'conflux_node_restart', 'conflux_node_wipe_restart', 'conflux_node_wipe'],
  },
  {
    commandFamily: 'Contracts and deploy',
    extensionExamples: ['cfxdevkit.deployContract', 'cfxdevkit.listContracts', 'cfxdevkit.abiCallRead', 'cfxdevkit.abiCallWrite'],
    mcpTools: [
      'conflux_templates',
      'conflux_contract_template_get',
      'conflux_deploy',
      'conflux_contracts',
      'conflux_contract_get',
      'conflux_contract_delete',
      'conflux_contracts_clear',
      'conflux_bootstrap_catalog',
      'conflux_bootstrap_entry',
      'conflux_bootstrap_prepare',
      'conflux_bootstrap_deploy',
      'conflux_bootstrap_deploy_multi',
      'cfxdevkit_contract_call',
      'cfxdevkit_contract_write'
    ],
  },
  {
    commandFamily: 'DEX workflows',
    extensionExamples: ['cfxdevkit.deployDex', 'cfxdevkit.dexUiStart', 'cfxdevkit.dexUiStop'],
    mcpTools: [
      'dex_status',
      'dex_deploy',
      'dex_seed_from_gecko',
      'dex_simulation_start',
      'dex_simulation_stop',
      'dex_manifest_get',
      'dex_manifest_set',
      'dex_translation_table_get',
      'dex_translation_table_set'
    ],
    notes: 'VS Code-only browser/process controls remain UI-only; on-chain and backend DEX state is MCP-addressable.',
  },
  {
    commandFamily: 'Network mode',
    extensionExamples: ['cfxdevkit.selectNetwork'],
    mcpTools: [
      'conflux_network_current',
      'conflux_network_set',
      'conflux_network_capabilities',
      'conflux_network_config_get',
      'conflux_network_config_set'
    ],
  },
  {
    commandFamily: 'Workspace stack',
    extensionExamples: ['devkit.start', 'devkit.stop', 'devkit.status'],
    mcpTools: ['workspace_start', 'workspace_stop', 'workspace_status', 'workspace_logs', 'local_stack_status'],
  },
];
