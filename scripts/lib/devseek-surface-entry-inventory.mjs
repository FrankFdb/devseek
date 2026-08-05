import crypto from 'node:crypto';
import {
  SUPPORTED_INTEGRITY,
  canonicalJson,
  sha256Object,
} from './devseek-capability-ledger.mjs';

export const SURFACE_ENTRY_INVENTORY_SCHEMA_VERSION = 'devseek.surface-entry-inventory/v1';
export const SURFACE_ENTRY_INVENTORY_ID = 'DEVSEEK-R1-D1A-SURFACE-ENTRY-INVENTORY/v1';
export const SURFACE_ENTRY_INVENTORY_INTEGRITY_SCOPE = 'local-surface-entry-inventory-conformance';
export const SURFACE_ENTRY_INVENTORY_QUALIFICATION_EFFECT = 'NONE';

export const REQUIRED_OWNER_COMPONENTS = Object.freeze([
  'docs/process/devseek-surface-entry-inventory.json',
  'docs/process/devseek-surface-entry-inventory.schema.json',
  'docs/process/generated/devseek-surface-entry-inventory.md',
  'scripts/devseek-surface-entry-inventory-check.mjs',
  'scripts/lib/devseek-surface-entry-inventory.mjs',
  'scripts/test/devseek-surface-entry-inventory.test.mjs',
]);

const SOURCE_PATHS = Object.freeze({
  packageJson: 'packages/vscode-extension/package.json',
  extensionCommands: 'packages/vscode-extension/src/ui/extension-command-registration.ts',
  providerRouter: 'packages/vscode-extension/src/llm/provider-router.ts',
  pendingEditCoordinator: 'packages/vscode-extension/src/pending-edit-coordinator.ts',
  realPluginHarness: 'packages/vscode-extension/src/ui/real-plugin-harness.ts',
  webviewProtocol: 'packages/vscode-extension/src/ui/webview-protocol.ts',
  deepseekViewProvider: 'packages/vscode-extension/src/ui/deepseek-view-provider.ts',
  cliPackageJson: 'packages/cli/package.json',
  cliIndex: 'packages/cli/src/index.ts',
  cliSurfaceAdapter: 'packages/cli/src/cli-surface-adapter.ts',
  headlessPackageJson: 'packages/headless/package.json',
  headlessIndex: 'packages/headless/src/index.ts',
  headlessExecutor: 'packages/headless/src/headless-coding-kernel.ts',
  bridgeServer: 'packages/bridge/src/server.ts',
  schemaSource: 'docs/process/devseek-surface-entry-inventory.schema.json',
  checkerSource: 'scripts/devseek-surface-entry-inventory-check.mjs',
  inventoryLibSource: 'scripts/lib/devseek-surface-entry-inventory.mjs',
  oracleSource: 'scripts/test/devseek-surface-entry-inventory.test.mjs',
});

const KNOWN_WEBVIEW_TYPES = new Set([
  'ready',
  'chat',
  'agentSteer',
  'previewGeneratedFiles',
  'applyGeneratedFiles',
  'openGeneratedPath',
  'previewGeneratedPath',
  'applyGeneratedPath',
  'openPendingEdit',
  'keepPendingHunk',
  'undoPendingHunk',
  'keepPendingEdit',
  'undoPendingEdit',
  'keepAllPendingEdits',
  'undoAllPendingEdits',
  'cancel',
  'clearContext',
  'agentToggle',
  'clearHistory',
  'insertCode',
  'relogin',
  'getStatus',
  'setMode',
  'terminalConfirmReply',
  'runInVsTerminal',
  'setAutopilot',
  'runCommand',
  'getProblems',
  'resolveFile',
  'listSessions',
  'loadSession',
  'listTasks',
  'openTask',
  'continueTask',
  'archiveTask',
  'deleteTask',
  'exportTask',
  'deleteSession',
  'saveSession',
  'resumeAgentCheckpoint',
  'dismissAgentCheckpoint',
]);

const KNOWN_BRIDGE_ENDPOINTS = new Map([
  ['GET /ping', { surface: 'bridge-health', scope: 'local-public', projection: 'health-read' }],
  ['GET /status', { surface: 'bridge-status', scope: 'local-public', projection: 'status-read' }],
  ['POST /cancel', { surface: 'bridge-control', scope: 'local-public', projection: 'agent-cancel' }],
  ['POST /shutdown', { surface: 'bridge-control', scope: 'internal-control', projection: 'lifecycle-control' }],
  ['POST /relogin', { surface: 'bridge-auth', scope: 'local-public', projection: 'auth-session-action' }],
  ['POST /preattach', { surface: 'bridge-attachment', scope: 'local-public', projection: 'context-ref-preattach' }],
  ['POST /chat', { surface: 'bridge-provider-transport', scope: 'local-public', projection: 'agent-command-provider-transport' }],
  ['GET /index/file', { surface: 'bridge-context-index', scope: 'local-public', projection: 'context-ref-read' }],
  ['GET /index/search', { surface: 'bridge-context-index', scope: 'local-public', projection: 'context-ref-search' }],
]);

const VSCODE_AGENT_COMMAND_CUTOVER = new Set([
  'devseek.applyDiff',
  'devseek.ask',
  'devseek.explain',
  'devseek.fix',
  'devseek.genDoc',
  'devseek.generateCommit',
  'devseek.genTest',
  'devseek.inlineChat',
  'devseek.refactor',
  'devseek.runTerminalCommand',
  'devseek.runTests',
]);

const VSCODE_MEMORY_COMMANDS = new Set([
  'devseek.showMemoryFiles',
  'devseek.manageMemory',
  'devseek.disableMemory',
  'devseek.deleteMemory',
]);

export function collectSurfaceEntryInventorySources(repoRoot, readText, readJson) {
  const sourceContents = {};
  for (const sourcePath of Object.values(SOURCE_PATHS)) {
    sourceContents[sourcePath] = readText(sourcePath);
  }
  return {
    repoRoot,
    packageJson: readJson(SOURCE_PATHS.packageJson),
    cliPackageJson: readJson(SOURCE_PATHS.cliPackageJson),
    headlessPackageJson: readJson(SOURCE_PATHS.headlessPackageJson),
    sourceContents,
  };
}

export function buildSurfaceEntryInventory(sources) {
  const entries = [
    ...buildVscodeCommandEntries(sources),
    ...buildWebviewEntries(sources),
    ...buildAttachmentEntries(sources),
    ...buildCliEntries(sources),
    ...buildHeadlessEntries(sources),
    ...buildBridgeEntries(sources),
  ].sort((left, right) => left.entry_id.localeCompare(right.entry_id));
  const packageJson = sources.packageJson;
  const sourceRefs = buildSourceRefs(sources);
  const inventory = {
    schema_version: SURFACE_ENTRY_INVENTORY_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    inventory_id: SURFACE_ENTRY_INVENTORY_ID,
    inventory_version: 1,
    source_status: 'verified',
    integrity_scope: SURFACE_ENTRY_INVENTORY_INTEGRITY_SCOPE,
    qualification_eligible: false,
    qualification_effect: SURFACE_ENTRY_INVENTORY_QUALIFICATION_EFFECT,
    claims_permitted: false,
    asserts_gate_pass: false,
    sources: sourceRefs,
    owner: {
      task_id: 'R1-D1A-SURFACE-ENTRY-INVENTORY',
      required_component_paths: REQUIRED_OWNER_COMPONENTS.map(componentPath => ({
        path: componentPath,
        present: Boolean(sources.sourceContents[componentPath]) || componentPath.startsWith('docs/process/'),
      })),
      package_scripts: {
        generate: Boolean(sources.rootPackageJson?.scripts?.['generate:surface-entry-inventory']),
        verify: Boolean(sources.rootPackageJson?.scripts?.['verify:surface-entry-inventory']),
      },
    },
    package_manifest: {
      extension_id: `${packageJson.publisher}.${packageJson.name}`,
      command_count: manifestCommands(packageJson).length,
      view_count: manifestViews(packageJson).length,
      view_container_count: manifestViewContainers(packageJson).length,
    },
    entries,
    bypass_guards: buildBypassGuards(sources, entries),
    counts: buildCounts(entries, sources),
  };
  inventory.inventory_sha256 = surfaceEntryInventoryHash(inventory);
  return inventory;
}

export function validateSurfaceEntryInventory(inventory, sources) {
  const errors = [];
  const expected = buildSurfaceEntryInventory(sources);
  if (canonicalJson(inventory) !== canonicalJson(expected)) {
    errors.push('inventory:drift-from-sources');
  }
  if (inventory.schema_version !== SURFACE_ENTRY_INVENTORY_SCHEMA_VERSION) {
    errors.push(`schema_version:unexpected-${inventory.schema_version}`);
  }
  if (inventory.inventory_id !== SURFACE_ENTRY_INVENTORY_ID) {
    errors.push(`inventory_id:unexpected-${inventory.inventory_id}`);
  }
  if (inventory.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (inventory.qualification_effect !== SURFACE_ENTRY_INVENTORY_QUALIFICATION_EFFECT) {
    errors.push('qualification_effect:must-be-NONE');
  }
  if (inventory.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (inventory.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (inventory.inventory_sha256 !== surfaceEntryInventoryHash(inventory)) {
    errors.push('inventory_sha256:mismatch');
  }
  const counts = inventory.counts ?? {};
  if (counts.unknown_entries !== 0) errors.push(`entries:unknown-${counts.unknown_entries}`);
  if (counts.duplicate_surface_entry_ids !== 0) {
    const duplicateIds = duplicateEntryIds(inventory.entries ?? []);
    if (duplicateIds.length === 0) {
      errors.push(`entries:duplicate-id-${counts.duplicate_surface_entry_ids}`);
    } else {
      for (const entryId of duplicateIds) {
        errors.push(`entries:duplicate-id-${entryId}`);
      }
    }
  }
  if (counts.declared_adapter_pending_cutover !== 0) {
    errors.push(`legacy:declared-pending-d2-${counts.declared_adapter_pending_cutover}`);
  }
  if (counts.vscode_manifest_commands_missing_runtime !== 0) {
    errors.push(`vscode:manifest-missing-runtime-${counts.vscode_manifest_commands_missing_runtime}`);
  }
  if (counts.vscode_public_runtime_without_manifest !== 0) {
    errors.push(`vscode:public-runtime-without-manifest-${counts.vscode_public_runtime_without_manifest}`);
  }
  if (counts.webview_protocol_missing_handler !== 0) {
    errors.push(`webview:protocol-missing-handler-${counts.webview_protocol_missing_handler}`);
  }
  if (counts.webview_handler_missing_protocol !== 0) {
    errors.push(`webview:handler-missing-protocol-${counts.webview_handler_missing_protocol}`);
  }
  if (counts.undeclared_legacy_owner_reachability !== 0) {
    errors.push(`legacy:undeclared-reachability-${counts.undeclared_legacy_owner_reachability}`);
  }
  if (counts.duplicate_manifest_command_declarations !== 0) {
    const duplicateIds = duplicateManifestCommandIds(sources.packageJson);
    if (duplicateIds.length === 0) {
      errors.push(`manifest-command:duplicate-declaration-${counts.duplicate_manifest_command_declarations}`);
    } else {
      for (const commandId of duplicateIds) {
        errors.push(`manifest-command:duplicate-declaration-${commandId}`);
      }
    }
  }
  if (counts.duplicate_runtime_command_registrations !== 0) {
    const duplicateIds = duplicateRuntimeCommandIds(sources.sourceContents);
    if (duplicateIds.length === 0) {
      errors.push(`runtime-command:duplicate-registration-${counts.duplicate_runtime_command_registrations}`);
    } else {
      for (const commandId of duplicateIds) {
        errors.push(`runtime-command:duplicate-registration-${commandId}`);
      }
    }
  }
  if (counts.duplicate_webview_protocol_declarations !== 0) {
    const duplicateTypes = duplicateWebviewProtocolTypes(sources.sourceContents);
    if (duplicateTypes.length === 0) {
      errors.push(`webview:duplicate-protocol-${counts.duplicate_webview_protocol_declarations}`);
    } else {
      for (const type of duplicateTypes) {
        errors.push(`webview:duplicate-protocol-${type}`);
      }
    }
  }
  if (counts.duplicate_webview_handler_registrations !== 0) {
    const duplicateTypes = duplicateWebviewHandlerTypes(sources.sourceContents);
    if (duplicateTypes.length === 0) {
      errors.push(`webview:duplicate-handler-${counts.duplicate_webview_handler_registrations}`);
    } else {
      for (const type of duplicateTypes) {
        errors.push(`webview:duplicate-handler-${type}`);
      }
    }
  }
  const guards = inventory.bypass_guards ?? {};
  if (guards.generic_webview_command_disabled !== true) {
    errors.push('bypass:generic-webview-command-not-disabled');
  }
  if (guards.legacy_surface_projection_fallbacks_removed !== true) {
    errors.push('bypass:legacy-surface-projection-fallbacks-present');
  }
  if (guards.manifest_command_declaration_unique !== true) {
    errors.push('bypass:manifest-command-declaration-not-unique');
  }
  if (guards.runtime_command_registration_unique !== true) {
    errors.push('bypass:runtime-command-registration-not-unique');
  }
  if (guards.webview_protocol_declaration_unique !== true) {
    errors.push('bypass:webview-protocol-declaration-not-unique');
  }
  if (guards.webview_handler_registration_unique !== true) {
    errors.push('bypass:webview-handler-registration-not-unique');
  }
  if (guards.unknown_entry_fail_closed !== true) {
    errors.push('bypass:unknown-entry-not-fail-closed');
  }
  if (guards.surface_entry_ids_unique !== true) {
    errors.push('bypass:surface-entry-ids-not-unique');
  }
  if (guards.headless_single_product_entrypoint !== true) {
    errors.push('bypass:headless-product-entrypoint-not-unique');
  }
  if (guards.headless_surface_no_vscode_dependency !== true) {
    errors.push('bypass:headless-surface-depends-on-vscode');
  }
  if (guards.inventory_asserts_gate_pass === true) {
    errors.push('bypass:inventory-asserts-gate-pass');
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      inventory_sha256: inventory.inventory_sha256,
      entries: counts.total_entries ?? 0,
      vscode_commands: counts.vscode_runtime_commands ?? 0,
      webview_inbound: counts.webview_protocol_entries ?? 0,
      cli_entrypoints: counts.cli_entrypoints ?? 0,
      headless_entrypoints: counts.headless_entrypoints ?? 0,
      bridge_endpoints: counts.bridge_endpoints ?? 0,
      attachment_entries: counts.attachment_entries ?? 0,
      unknown_entries: counts.unknown_entries ?? 0,
      qualification_effect: inventory.qualification_effect,
      claims_permitted: inventory.claims_permitted,
      asserts_gate_pass: inventory.asserts_gate_pass,
    },
  };
}

export function renderSurfaceEntryInventoryMarkdown(inventory) {
  const lines = [
    '# DevSeek Surface Entry Inventory',
    '',
    `- inventory_id: \`${inventory.inventory_id}\``,
    `- inventory_sha256: \`${inventory.inventory_sha256}\``,
    `- qualification_effect: \`${inventory.qualification_effect}\``,
    `- claims_permitted: \`${inventory.claims_permitted}\``,
    `- asserts_gate_pass: \`${inventory.asserts_gate_pass}\``,
    '',
    '## Counts',
    '',
    '| Metric | Count |',
    '| --- | ---: |',
  ];
  for (const [key, value] of Object.entries(inventory.counts)) {
    lines.push(`| ${key} | ${value} |`);
  }
  lines.push('', '## Entries', '', '| Entry | Surface | Kind | Scope | Source | Coverage | Projection |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const entry of inventory.entries) {
    lines.push(`| \`${entry.entry_id}\` | ${entry.surface} | ${entry.kind} | ${entry.scope} | \`${entry.source_ref}\` | ${entry.coverage_status} | ${entry.kernel_contract_projection} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function surfaceEntryInventoryHash(inventory) {
  return sha256Object(withoutKeys(inventory, ['inventory_sha256']), inventory?.integrity);
}

function buildSourceRefs(sources) {
  const refs = {};
  for (const [key, sourcePath] of Object.entries(SOURCE_PATHS)) {
    refs[key] = {
      path: sourcePath,
      source_sha256: sha256Text(sources.sourceContents[sourcePath] ?? ''),
    };
  }
  if (sources.rootPackageJson) {
    refs.rootPackageJson = {
      path: 'package.json',
      source_sha256: sha256Text(sources.sourceContents['package.json'] ?? JSON.stringify(sources.rootPackageJson)),
    };
  }
  return refs;
}

function buildVscodeCommandEntries(sources) {
  const packageJson = sources.packageJson;
  const manifest = new Set(manifestCommands(packageJson));
  const runtime = collectRuntimeCommands(sources.sourceContents);
  const all = new Set([...manifest, ...runtime.keys()]);
  return [...all].sort().map(commandId => {
    const runtimeRegistered = runtime.has(commandId);
    const manifestDeclared = manifest.has(commandId);
    const scope = commandScope(commandId);
    const coverageStatus = commandCoverageStatus({ commandId, runtimeRegistered, manifestDeclared, scope });
    return {
      entry_id: `vscode-command/${commandId}`,
      surface: 'vscode',
      kind: 'command',
      scope,
      source_ref: runtime.get(commandId)?.source_ref ?? SOURCE_PATHS.packageJson,
      entrypoint: commandId,
      manifest_declared: manifestDeclared,
      runtime_registered: runtimeRegistered,
      protocol_declared: null,
      handler_declared: null,
      owner: commandOwner(commandId),
      kernel_contract_projection: commandProjection(commandId),
      coverage_status: coverageStatus,
    };
  });
}

function buildWebviewEntries(sources) {
  const protocolTypes = new Set(extractWebviewInboundTypes(sources.sourceContents[SOURCE_PATHS.webviewProtocol] ?? ''));
  const handlerTypes = new Set(extractWebviewHandlerCases(sources.sourceContents[SOURCE_PATHS.deepseekViewProvider] ?? ''));
  const all = new Set([...protocolTypes, ...handlerTypes]);
  return [...all].sort().map(type => {
    const protocolDeclared = protocolTypes.has(type);
    const handlerDeclared = handlerTypes.has(type);
    const known = KNOWN_WEBVIEW_TYPES.has(type);
    return {
      entry_id: `vscode-webview/${type}`,
      surface: 'vscode-webview',
      kind: 'webview-inbound-message',
      scope: webviewScope(type),
      source_ref: SOURCE_PATHS.deepseekViewProvider,
      entrypoint: type,
      manifest_declared: null,
      runtime_registered: true,
      protocol_declared: protocolDeclared,
      handler_declared: handlerDeclared,
      owner: webviewOwner(type),
      kernel_contract_projection: webviewProjection(type),
      coverage_status: !known
        ? 'unknown-entry'
        : protocolDeclared && handlerDeclared
          ? 'covered'
          : protocolDeclared
            ? 'missing-handler'
            : 'missing-protocol',
    };
  });
}

function buildAttachmentEntries(sources) {
  const protocolSource = sources.sourceContents[SOURCE_PATHS.webviewProtocol] ?? '';
  const viewSource = sources.sourceContents[SOURCE_PATHS.deepseekViewProvider] ?? '';
  const commandSource = sources.sourceContents[SOURCE_PATHS.extensionCommands] ?? '';
  const bridgeSource = sources.sourceContents[SOURCE_PATHS.bridgeServer] ?? '';
  return [
    {
      entry_id: 'attachment/vscode-command-add-file-to-chat',
      surface: 'vscode',
      kind: 'attachment-command',
      scope: 'public',
      source_ref: SOURCE_PATHS.extensionCommands,
      entrypoint: 'devseek.addFileToChat',
      manifest_declared: true,
      runtime_registered: commandSource.includes("registerCommand('devseek.addFileToChat'"),
      protocol_declared: null,
      handler_declared: null,
      owner: 'AttachmentContextRef',
      kernel_contract_projection: 'ContextRef',
      coverage_status: commandSource.includes("registerCommand('devseek.addFileToChat'") ? 'covered' : 'missing-source',
    },
    {
      entry_id: 'attachment/webview-chat-files',
      surface: 'vscode-webview',
      kind: 'attachment-message-field',
      scope: 'public',
      source_ref: SOURCE_PATHS.webviewProtocol,
      entrypoint: 'WebviewInboundMessage.files',
      manifest_declared: null,
      runtime_registered: viewSource.includes('msg.files'),
      protocol_declared: protocolSource.includes('files?: string[]'),
      handler_declared: viewSource.includes('files: msg.files'),
      owner: 'DeepSeekViewProvider',
      kernel_contract_projection: 'ContextRef',
      coverage_status: protocolSource.includes('files?: string[]') && viewSource.includes('files: msg.files') ? 'covered' : 'missing-source',
    },
    {
      entry_id: 'attachment/webview-chat-images',
      surface: 'vscode-webview',
      kind: 'attachment-message-field',
      scope: 'public',
      source_ref: SOURCE_PATHS.webviewProtocol,
      entrypoint: 'WebviewInboundMessage.images',
      manifest_declared: null,
      runtime_registered: viewSource.includes('msg.images'),
      protocol_declared: protocolSource.includes('images?: string[]'),
      handler_declared: viewSource.includes('images: msg.images'),
      owner: 'DeepSeekViewProvider',
      kernel_contract_projection: 'ContextRef',
      coverage_status: protocolSource.includes('images?: string[]') && viewSource.includes('images: msg.images') ? 'covered' : 'missing-source',
    },
    {
      entry_id: 'attachment/bridge-preattach',
      surface: 'bridge-attachment',
      kind: 'bridge-endpoint',
      scope: 'local-public',
      source_ref: SOURCE_PATHS.bridgeServer,
      entrypoint: 'POST /preattach',
      manifest_declared: null,
      runtime_registered: bridgeSource.includes("app.post('/preattach'"),
      protocol_declared: null,
      handler_declared: bridgeSource.includes("app.post('/preattach'"),
      owner: 'BridgeServer',
      kernel_contract_projection: 'ContextRef',
      coverage_status: bridgeSource.includes("app.post('/preattach'") ? 'covered' : 'missing-source',
    },
  ];
}

function buildCliEntries(sources) {
  const cliSource = sources.sourceContents[SOURCE_PATHS.cliIndex] ?? '';
  const surfaceSource = sources.sourceContents[SOURCE_PATHS.cliSurfaceAdapter] ?? '';
  const packageJson = sources.cliPackageJson;
  const execObserved = cliSource.includes("arg === 'exec'")
    && cliSource.includes('const prompt = options.resume ? await readLastPrompt(options.cwd) : options.prompt')
    && cliSource.includes('return runPrompt(options, prompt)');
  const resumeObserved = cliSource.includes("arg === '--resume'")
    && cliSource.includes('options.resume = true')
    && cliSource.includes('readLastPrompt(options.cwd)')
    && cliSource.includes('return runPrompt(options, prompt)');
  return [
    cliEntry('cli/interactive', 'interactive', cliSource.includes("command: 'interactive'") && cliSource.includes('runInteractive(options)'), 'cli-interactive', 'AgentCommand/Event'),
    cliEntry('cli/exec', 'exec', execObserved, 'cli-exec', 'AgentCommand/Event'),
    cliEntry('cli/jsonl-exec', 'exec --jsonl', cliSource.includes("arg === '--jsonl'") && surfaceSource.includes("this.kind = options.jsonl ? 'jsonl' : 'cli'"), 'jsonl', 'AgentEvent JSONL'),
    cliEntry('cli/resume-exec', 'exec --resume', resumeObserved, 'cli-resume', 'AgentCommand/Event'),
    cliEntry('cli/help', '--help', cliSource.includes("arg === '--help'") && cliSource.includes('printHelp()'), 'cli-help', 'help-text'),
    cliEntry('cli/version', '--version', cliSource.includes("arg === '--version'") && cliSource.includes('console.log(VERSION)'), 'cli-version', 'version-text'),
    cliEntry('cli/mock-exec', 'exec --mock', cliSource.includes("arg === '--mock'") && cliSource.includes('DEVSEEK_CLI_MOCK'), 'cli-test', 'local-mock-provider'),
    {
      entry_id: 'cli/bin-devseek',
      surface: 'cli',
      kind: 'binary-entrypoint',
      scope: 'public',
      source_ref: SOURCE_PATHS.cliPackageJson,
      entrypoint: 'devseek',
      manifest_declared: Boolean(packageJson.bin?.devseek),
      runtime_registered: Boolean(packageJson.bin?.devseek),
      protocol_declared: null,
      handler_declared: null,
      owner: 'CliSurfaceAdapter',
      kernel_contract_projection: 'binary-to-cli-surface',
      coverage_status: packageJson.bin?.devseek === 'dist/index.js' ? 'covered' : 'missing-source',
    },
  ];
}

function buildHeadlessEntries(sources) {
  const packageJson = sources.headlessPackageJson;
  const indexSource = sources.sourceContents[SOURCE_PATHS.headlessIndex] ?? '';
  const executorSource = sources.sourceContents[SOURCE_PATHS.headlessExecutor] ?? '';
  const observed = packageJson.name === '@devseek-netai/headless'
    && packageJson.main === 'dist/index.js'
    && packageJson.types === 'dist/index.d.ts'
    && indexSource.includes("export * from './headless-coding-kernel';")
    && executorSource.includes('export class HeadlessCodingKernelExecutor')
    && executorSource.includes('new CanonicalCodingKernel(runtime)')
    && executorSource.includes("surface: 'headless'");
  return [{
    entry_id: 'headless/programmatic-run',
    surface: 'headless',
    kind: 'programmatic-entrypoint',
    scope: 'public',
    source_ref: SOURCE_PATHS.headlessExecutor,
    entrypoint: 'HeadlessCodingKernelExecutor.execute',
    manifest_declared: true,
    runtime_registered: observed,
    protocol_declared: true,
    handler_declared: observed,
    owner: 'HeadlessCodingKernelExecutor',
    kernel_contract_projection: 'CanonicalCodingKernelRequest/Output',
    coverage_status: observed ? 'covered' : 'missing-source',
  }];
}

function cliEntry(entryId, entrypoint, observed, scope, projection) {
  return {
    entry_id: entryId,
    surface: 'cli',
    kind: 'cli-entrypoint',
    scope,
    source_ref: SOURCE_PATHS.cliIndex,
    entrypoint,
    manifest_declared: null,
    runtime_registered: observed,
    protocol_declared: null,
    handler_declared: observed,
    owner: 'CliSurfaceAdapter',
    kernel_contract_projection: projection,
    coverage_status: observed ? 'covered' : 'missing-source',
  };
}

function buildBridgeEntries(sources) {
  const bridgeSource = sources.sourceContents[SOURCE_PATHS.bridgeServer] ?? '';
  const actual = extractBridgeEndpoints(bridgeSource);
  return actual.map(endpoint => {
    const known = KNOWN_BRIDGE_ENDPOINTS.get(endpoint);
    return {
      entry_id: `bridge/${endpoint.toLowerCase().replace(/\s+/g, '-').replace(/\//g, ':')}`,
      surface: known?.surface ?? 'bridge-unknown',
      kind: 'http-endpoint',
      scope: known?.scope ?? 'unknown',
      source_ref: SOURCE_PATHS.bridgeServer,
      entrypoint: endpoint,
      manifest_declared: null,
      runtime_registered: true,
      protocol_declared: null,
      handler_declared: true,
      owner: 'BridgeServer',
      kernel_contract_projection: known?.projection ?? 'unknown',
      coverage_status: known ? 'covered' : 'unknown-entry',
    };
  });
}

function buildBypassGuards(sources, entries) {
  const provider = sources.sourceContents[SOURCE_PATHS.deepseekViewProvider] ?? '';
  const inventoryLib = sources.sourceContents[SOURCE_PATHS.inventoryLibSource] ?? '';
  const headlessSource = sources.sourceContents[SOURCE_PATHS.headlessExecutor] ?? '';
  return {
    unknown_entry_fail_closed: entries.every(entry => entry.coverage_status !== 'unknown-entry'),
    surface_entry_ids_unique: duplicateEntryIds(entries).length === 0,
    headless_single_product_entrypoint: entries.filter(entry => entry.surface === 'headless').length === 1,
    headless_surface_no_vscode_dependency: !/from\s+['"]vscode['"]|require\(['"]vscode['"]\)/.test(headlessSource),
    generic_webview_command_disabled: provider.includes('Generic inbound VS Code commands are disabled; use a typed product action.'),
    legacy_surface_projection_fallbacks_removed: !hasLegacySurfaceProjectionFallbacks(inventoryLib),
    manifest_command_declaration_unique: duplicateManifestCommandIds(sources.packageJson).length === 0,
    runtime_command_registration_unique: duplicateRuntimeCommandIds(sources.sourceContents).length === 0,
    webview_protocol_declaration_unique: duplicateWebviewProtocolTypes(sources.sourceContents).length === 0,
    webview_handler_registration_unique: duplicateWebviewHandlerTypes(sources.sourceContents).length === 0,
    manifest_runtime_drift_present: entries.some(entry => (
      entry.kind === 'command'
      && entry.manifest_declared === true
      && entry.runtime_registered !== true
    )),
    webview_protocol_handler_drift_present: entries.some(entry => (
      entry.kind === 'webview-inbound-message'
      && entry.coverage_status !== 'covered'
    )),
    undeclared_legacy_owner_reachability_present: entries.some(entry => (
      entry.kernel_contract_projection === 'legacy-owner-bypass'
    )),
    inventory_asserts_gate_pass: false,
  };
}

function buildCounts(entries, sources) {
  const commandEntries = entries.filter(entry => entry.kind === 'command');
  const webviewEntries = entries.filter(entry => entry.kind === 'webview-inbound-message');
  return {
    total_entries: entries.length,
    vscode_manifest_commands: manifestCommands(sources.packageJson).length,
    vscode_runtime_commands: commandEntries.filter(entry => entry.runtime_registered === true).length,
    vscode_manifest_commands_missing_runtime: commandEntries.filter(entry => (
      entry.manifest_declared === true && entry.runtime_registered !== true
    )).length,
    vscode_public_runtime_without_manifest: commandEntries.filter(entry => (
      entry.scope === 'public' && entry.runtime_registered === true && entry.manifest_declared !== true
    )).length,
    webview_protocol_entries: webviewEntries.filter(entry => entry.protocol_declared === true).length,
    webview_handler_entries: webviewEntries.filter(entry => entry.handler_declared === true).length,
    webview_protocol_missing_handler: webviewEntries.filter(entry => entry.coverage_status === 'missing-handler').length,
    webview_handler_missing_protocol: webviewEntries.filter(entry => entry.coverage_status === 'missing-protocol').length,
    attachment_entries: entries.filter(entry => entry.kind.startsWith('attachment') || entry.surface.includes('attachment')).length,
    cli_entrypoints: entries.filter(entry => entry.surface === 'cli').length,
    headless_entrypoints: entries.filter(entry => entry.surface === 'headless').length,
    bridge_endpoints: entries.filter(entry => entry.surface.startsWith('bridge')).length,
    unknown_entries: entries.filter(entry => (
      entry.coverage_status === 'unknown-entry'
      || entry.coverage_status === 'missing-source'
      || entry.kernel_contract_projection.startsWith('unknown-')
    )).length,
    duplicate_surface_entry_ids: duplicateEntryIds(entries).length,
    declared_adapter_pending_cutover: entries.filter(entry => entry.kernel_contract_projection.includes('pending-D2')).length,
    undeclared_legacy_owner_reachability: entries.filter(entry => entry.kernel_contract_projection === 'legacy-owner-bypass').length,
    duplicate_manifest_command_declarations: duplicateManifestCommandIds(sources.packageJson).length,
    duplicate_runtime_command_registrations: duplicateRuntimeCommandIds(sources.sourceContents).length,
    duplicate_webview_protocol_declarations: duplicateWebviewProtocolTypes(sources.sourceContents).length,
    duplicate_webview_handler_registrations: duplicateWebviewHandlerTypes(sources.sourceContents).length,
  };
}

function collectRuntimeCommands(sourceContents) {
  const commandMap = new Map();
  for (const record of collectRuntimeCommandRegistrationRecords(sourceContents)) {
    commandMap.set(record.commandId, { source_ref: record.source_ref });
  }
  return commandMap;
}

function runtimeCommandSourcePaths() {
  return [
    SOURCE_PATHS.extensionCommands,
    SOURCE_PATHS.providerRouter,
    SOURCE_PATHS.pendingEditCoordinator,
    SOURCE_PATHS.realPluginHarness,
  ];
}

function collectRuntimeCommandRegistrationRecords(sourceContents) {
  const records = [];
  for (const sourcePath of runtimeCommandSourcePaths()) {
    const source = sourceContents[sourcePath] ?? '';
    for (const commandId of extractDirectRegisterCommandIds(source)) {
      records.push({ commandId, source_ref: sourcePath, registration_kind: 'direct-registerCommand' });
    }
    if (sourcePath === SOURCE_PATHS.extensionCommands) {
      for (const commandId of extractVisibleCommandTupleIds(source)) {
        records.push({ commandId, source_ref: sourcePath, registration_kind: 'visible-command-tuple' });
      }
    }
  }
  return records;
}

function duplicateEntryIds(entries) {
  const counts = new Map();
  for (const entry of entries ?? []) {
    if (!entry?.entry_id) continue;
    counts.set(entry.entry_id, (counts.get(entry.entry_id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([entryId]) => entryId)
    .sort();
}

function duplicateRuntimeCommandIds(sourceContents) {
  const counts = new Map();
  for (const record of collectRuntimeCommandRegistrationRecords(sourceContents)) {
    counts.set(record.commandId, (counts.get(record.commandId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([commandId]) => commandId)
    .sort();
}

function duplicateManifestCommandIds(packageJson) {
  const counts = new Map();
  for (const commandId of manifestCommands(packageJson)) {
    counts.set(commandId, (counts.get(commandId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([commandId]) => commandId)
    .sort();
}

function extractDirectRegisterCommandIds(source) {
  return [...source.matchAll(/registerCommand\(\s*['"]([^'"]+)['"]/gu)]
    .map(match => match[1])
    .sort();
}

function extractVisibleCommandTupleIds(source) {
  const start = source.indexOf('const commands:');
  const end = start >= 0 ? source.indexOf('];', start) : -1;
  if (start < 0 || end < 0) return [];
  const chunk = source.slice(start, end);
  return [...chunk.matchAll(/\[\s*['"]([^'"]+)['"]\s*,/gu)]
    .map(match => match[1])
    .sort();
}

function extractWebviewInboundTypes(source) {
  return [...new Set(collectWebviewProtocolTypeRecords(source))].sort();
}

function collectWebviewProtocolTypeRecords(source) {
  const types = [];
  const taskStart = source.indexOf('export const WEBVIEW_TASK_HISTORY_COMMANDS');
  const taskEnd = taskStart >= 0 ? source.indexOf('] as const', taskStart) : -1;
  if (taskStart >= 0 && taskEnd >= 0) {
    for (const match of source.slice(taskStart, taskEnd).matchAll(/'([^']+)'/gu)) types.push(match[1]);
  }
  const unionStart = source.indexOf('export type WebviewInboundType =');
  const unionEnd = unionStart >= 0 ? source.indexOf('export interface WebviewInboundMessage', unionStart) : -1;
  if (unionStart >= 0 && unionEnd >= 0) {
    for (const match of source.slice(unionStart, unionEnd).matchAll(/'([^']+)'/gu)) types.push(match[1]);
  }
  return types;
}

function duplicateWebviewProtocolTypes(sourceContents) {
  const source = sourceContents[SOURCE_PATHS.webviewProtocol] ?? '';
  const counts = new Map();
  for (const type of collectWebviewProtocolTypeRecords(source)) {
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([type]) => type)
    .sort();
}

function extractWebviewHandlerCases(source) {
  return [...new Set([...source.matchAll(/case '([^']+)'/gu)].map(match => match[1]))].sort();
}

function duplicateWebviewHandlerTypes(sourceContents) {
  const source = sourceContents[SOURCE_PATHS.deepseekViewProvider] ?? '';
  const counts = new Map();
  for (const match of source.matchAll(/case '([^']+)'/gu)) {
    const type = match[1];
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([type]) => type)
    .sort();
}

function extractBridgeEndpoints(source) {
  return [...source.matchAll(/app\.(get|post)\(\s*['"]([^'"]+)['"]/gu)]
    .map(match => `${match[1].toUpperCase()} ${match[2]}`)
    .sort();
}

function manifestCommands(packageJson) {
  return (packageJson.contributes?.commands ?? [])
    .map(command => command.command)
    .filter(Boolean)
    .sort();
}

function manifestViews(packageJson) {
  return Object.values(packageJson.contributes?.views ?? {})
    .flat()
    .map(view => view.id)
    .filter(Boolean)
    .sort();
}

function manifestViewContainers(packageJson) {
  return Object.values(packageJson.contributes?.viewsContainers ?? {})
    .flat()
    .map(container => container.id)
    .filter(Boolean)
    .sort();
}

function commandScope(commandId) {
  if (commandId.startsWith('_devseek.harness')) return 'test-only';
  if (commandId.startsWith('_')) return 'internal';
  if (commandId === 'devseek.keepOrUndoActive') return 'hidden-statusbar';
  return 'public';
}

function commandOwner(commandId) {
  if (commandId.startsWith('_devseek.harness')) return 'RealPluginHarness';
  if (commandId.startsWith('_devseek.diff') || commandId === 'devseek.keepOrUndoActive') return 'PendingEditCoordinator';
  if (commandId === 'devseek.switchProvider') return 'ProviderStatusBar';
  if (commandId === 'devseek.addFileToChat') return 'AttachmentContextRef';
  if (VSCODE_MEMORY_COMMANDS.has(commandId)) return 'MemoryContextRef';
  if (commandId === 'devseek.inlineChat') return 'InlineChatCommand';
  if (commandId === 'devseek.openChat') return 'ChatViewSurface';
  if (commandId === '_deepseek.askChat') return 'ChatRelayCommand';
  return 'ExtensionCommandRegistration';
}

function commandProjection(commandId) {
  if (commandId.startsWith('_devseek.harness')) return 'test-only-controlled-surface';
  if (commandId.startsWith('_devseek.diff') || commandId === 'devseek.keepOrUndoActive') return 'pending-edit-action';
  if (commandId === '_deepseek.askChat') return 'chat-relay-internal';
  if (VSCODE_AGENT_COMMAND_CUTOVER.has(commandId)) return 'AgentCommand/Event';
  if (commandId === 'devseek.addFileToChat' || VSCODE_MEMORY_COMMANDS.has(commandId)) return 'ContextRef';
  if (commandId === 'devseek.openChat' || commandId === 'devseek.triggerCompletion') return 'surface-ui-action';
  if (commandId === 'devseek.switchProvider') return 'provider-config-action';
  if (commandId.startsWith('devseek.')) return 'unknown-agent-command-surface';
  return 'internal-adapter';
}

function hasLegacySurfaceProjectionFallbacks(source) {
  return /return\s+['"][^'"]*pending-D2[^'"]*['"]/u.test(source);
}

function commandCoverageStatus({ commandId, runtimeRegistered, manifestDeclared, scope }) {
  if (manifestDeclared && runtimeRegistered) return 'covered';
  if (manifestDeclared && !runtimeRegistered) return 'missing-runtime';
  if (!manifestDeclared && runtimeRegistered && (scope === 'internal' || scope === 'test-only' || scope === 'hidden-statusbar')) return 'covered';
  if (!manifestDeclared && runtimeRegistered && commandId.startsWith('devseek.')) return 'missing-manifest';
  return 'unknown-entry';
}

function webviewScope(type) {
  if (type === 'runCommand') return 'disabled-generic-command';
  if (type.includes('Pending') || type.includes('Generated') || type.includes('Task') || ['terminalConfirmReply', 'runInVsTerminal'].includes(type)) {
    return 'ui-action';
  }
  if (['ready', 'setMode', 'getStatus', 'getProblems', 'resolveFile'].includes(type)) return 'ui-read';
  return 'public';
}

function webviewProjection(type) {
  if (type === 'chat') return 'AgentCommand/Event';
  if (type === 'agentSteer') return 'AgentSteer';
  if (type === 'runCommand') return 'disabled-generic-command';
  if (type.includes('Pending')) return 'pending-edit-action';
  if (type.includes('Generated')) return 'generated-artifact-action';
  if (['listTasks', 'openTask', 'continueTask', 'archiveTask', 'deleteTask', 'exportTask'].includes(type)) return 'task-history-action';
  if (['resumeAgentCheckpoint', 'dismissAgentCheckpoint'].includes(type)) return 'checkpoint-action';
  return 'typed-webview-action';
}

function webviewOwner(type) {
  if (type.includes('Generated')) return 'GeneratedArtifactSurfaceController';
  return 'DeepSeekViewProvider';
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function withoutKeys(value, keys) {
  if (Array.isArray(value)) return value.map(item => withoutKeys(item, keys));
  if (!value || typeof value !== 'object') return value;
  const drop = new Set(keys);
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (drop.has(key)) continue;
    output[key] = withoutKeys(child, keys);
  }
  return output;
}
