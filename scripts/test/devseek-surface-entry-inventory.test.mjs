import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonicalJson, readJson } from '../lib/devseek-capability-ledger.mjs';
import {
  buildSurfaceEntryInventory,
  collectSurfaceEntryInventorySources,
  renderSurfaceEntryInventoryMarkdown,
  validateSurfaceEntryInventory,
} from '../lib/devseek-surface-entry-inventory.mjs';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sources = loadSources();
const expected = buildSurfaceEntryInventory(sources);

test('surface entry inventory is source-bound and covers every current entry denominator', () => {
  const actual = readJson(path.join(repoRoot, 'docs/process/devseek-surface-entry-inventory.json'));

  assert.equal(canonicalJson(actual), canonicalJson(expected));
  assert.equal(actual.qualification_eligible, false);
  assert.equal(actual.qualification_effect, 'NONE');
  assert.equal(actual.claims_permitted, false);
  assert.equal(actual.asserts_gate_pass, false);
  assert.deepEqual(actual.counts, {
    total_entries: 84,
    vscode_manifest_commands: 16,
    vscode_runtime_commands: 22,
    vscode_manifest_commands_missing_runtime: 0,
    vscode_public_runtime_without_manifest: 0,
    webview_protocol_entries: 41,
    webview_handler_entries: 41,
    webview_protocol_missing_handler: 0,
    webview_handler_missing_protocol: 0,
    attachment_entries: 5,
    cli_entrypoints: 8,
    bridge_endpoints: 10,
    unknown_entries: 0,
    declared_adapter_pending_cutover: 0,
    undeclared_legacy_owner_reachability: 0,
    duplicate_runtime_command_registrations: 0,
    duplicate_webview_handler_registrations: 0,
  });
  const resumeEntry = actual.entries.find(item => item.entry_id === 'cli/resume-exec');
  assert.ok(resumeEntry, 'CLI resume must be inventoried as a declared surface entrypoint');
  assert.equal(resumeEntry.coverage_status, 'covered');
  assert.equal(resumeEntry.owner, 'CliSurfaceAdapter');
  assert.equal(resumeEntry.kernel_contract_projection, 'AgentCommand/Event');
  for (const commandId of [
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
  ]) {
    const entry = actual.entries.find(item => item.entry_id === `vscode-command/${commandId}`);
    assert.ok(entry, `${commandId} must be inventoried`);
    assert.equal(entry.kernel_contract_projection, 'AgentCommand/Event');
  }
  const memoryEntry = actual.entries.find(item => item.entry_id === 'vscode-command/devseek.showMemoryFiles');
  assert.ok(memoryEntry, 'devseek.showMemoryFiles must be inventoried');
  assert.equal(memoryEntry.owner, 'MemoryContextRef');
  assert.equal(memoryEntry.kernel_contract_projection, 'ContextRef');
  for (const messageType of [
    'previewGeneratedFiles',
    'applyGeneratedFiles',
    'openGeneratedPath',
    'previewGeneratedPath',
    'applyGeneratedPath',
  ]) {
    const entry = actual.entries.find(item => item.entry_id === `vscode-webview/${messageType}`);
    assert.ok(entry, `${messageType} must be inventoried`);
    assert.equal(entry.owner, 'GeneratedArtifactSurfaceController');
    assert.equal(entry.kernel_contract_projection, 'generated-artifact-action');
  }
  assert.equal(actual.bypass_guards.generic_webview_command_disabled, true);
  assert.equal(actual.bypass_guards.legacy_surface_projection_fallbacks_removed, true);
  assert.equal(actual.bypass_guards.runtime_command_registration_unique, true);
  assert.equal(actual.bypass_guards.webview_handler_registration_unique, true);
  assert.equal(actual.bypass_guards.unknown_entry_fail_closed, true);

  const validation = validateSurfaceEntryInventory(actual, sources);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors, null, 2));
});

test('surface entry inventory schema and generated view are source-bound', () => {
  const actual = readJson(path.join(repoRoot, 'docs/process/devseek-surface-entry-inventory.json'));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(readJson(path.join(repoRoot, 'docs/process/devseek-surface-entry-inventory.schema.json')));
  assert.equal(validate(actual), true, JSON.stringify(validate.errors));

  const generated = fs.readFileSync(
    path.join(repoRoot, 'docs/process/generated/devseek-surface-entry-inventory.md'),
    'utf8',
  );
  assert.equal(generated, renderSurfaceEntryInventoryMarkdown(actual));
});

test('surface inventory fails closed on unknown bridge endpoints', () => {
  const mutatedSources = cloneSources();
  mutatedSources.sourceContents['packages/bridge/src/server.ts'] += "\napp.post('/experimental-surface', (_req, res) => res.json({ ok: true }));\n";
  const mutatedInventory = buildSurfaceEntryInventory(mutatedSources);
  assertHasError(mutatedInventory, mutatedSources, 'entries:unknown-1');
});

test('surface inventory fails closed on webview protocol and handler drift', () => {
  const missingHandlerSources = cloneSources();
  missingHandlerSources.sourceContents['packages/vscode-extension/src/ui/deepseek-view-provider.ts'] =
    missingHandlerSources.sourceContents['packages/vscode-extension/src/ui/deepseek-view-provider.ts']
      .replace("case 'chat':", "case 'chat_REMOVED_FOR_TEST':");
  const missingHandlerInventory = buildSurfaceEntryInventory(missingHandlerSources);
  assertHasError(missingHandlerInventory, missingHandlerSources, 'webview:protocol-missing-handler-1');

  const missingProtocolSources = cloneSources();
  missingProtocolSources.sourceContents['packages/vscode-extension/src/ui/webview-protocol.ts'] =
    missingProtocolSources.sourceContents['packages/vscode-extension/src/ui/webview-protocol.ts']
      .replace("| 'chat' | 'cancel'", "| 'cancel'");
  const missingProtocolInventory = buildSurfaceEntryInventory(missingProtocolSources);
  assertHasError(missingProtocolInventory, missingProtocolSources, 'webview:handler-missing-protocol-1');
});

test('surface inventory fails closed when generic webview command bypass is reopened', () => {
  const mutatedSources = cloneSources();
  mutatedSources.sourceContents['packages/vscode-extension/src/ui/deepseek-view-provider.ts'] =
    mutatedSources.sourceContents['packages/vscode-extension/src/ui/deepseek-view-provider.ts']
      .replace('Generic inbound VS Code commands are disabled; use a typed product action.', 'generic command allowed');
  const mutatedInventory = buildSurfaceEntryInventory(mutatedSources);
  assertHasError(mutatedInventory, mutatedSources, 'bypass:generic-webview-command-not-disabled');
});

test('R1-D2D surface inventory fails closed instead of using legacy pending-D2 command fallbacks', () => {
  const inventoryLib = readText('scripts/lib/devseek-surface-entry-inventory.mjs');
  assert.doesNotMatch(
    inventoryLib,
    /return\s+['"][^'"]*pending-D2[^'"]*['"]/,
    'D2D must physically remove pending-D2 fallback return paths',
  );

  const mutatedSources = cloneSources();
  mutatedSources.packageJson.contributes.commands.push({
    command: 'devseek.experimentalLegacy',
    title: 'Experimental Legacy',
  });
  mutatedSources.sourceContents['packages/vscode-extension/src/ui/extension-command-registration.ts'] =
    mutatedSources.sourceContents['packages/vscode-extension/src/ui/extension-command-registration.ts']
      .replace(
        "['devseek.openChat', async () => { deps.viewProvider.focus(); }],",
        "['devseek.experimentalLegacy', async () => {}],\n    ['devseek.openChat', async () => { deps.viewProvider.focus(); }],",
      );

  const mutatedInventory = buildSurfaceEntryInventory(mutatedSources);
  const entry = mutatedInventory.entries.find(item => item.entry_id === 'vscode-command/devseek.experimentalLegacy');
  assert.ok(entry, 'mutated public command must be inventoried');
  assert.equal(entry.kernel_contract_projection, 'unknown-agent-command-surface');
  assert.equal(mutatedInventory.counts.declared_adapter_pending_cutover, 0);
  assertHasError(mutatedInventory, mutatedSources, 'entries:unknown-1');
});

test('R1-D* surface inventory fails closed on duplicate runtime command registrations', () => {
  const mutatedSources = cloneSources();
  mutatedSources.sourceContents['packages/vscode-extension/src/ui/extension-command-registration.ts'] +=
    "\nvscode.commands.registerCommand('devseek.explain', async () => {});\n";

  const mutatedInventory = buildSurfaceEntryInventory(mutatedSources);
  assert.equal(mutatedInventory.counts.duplicate_runtime_command_registrations, 1);
  assert.equal(mutatedInventory.bypass_guards.runtime_command_registration_unique, false);
  assertHasError(mutatedInventory, mutatedSources, 'runtime-command:duplicate-registration-devseek.explain');
});

test('R1-D2D surface inventory fails closed on duplicate webview handler registrations', () => {
  const mutatedSources = cloneSources();
  mutatedSources.sourceContents['packages/vscode-extension/src/ui/deepseek-view-provider.ts'] +=
    "\ncase 'chat':\n  break;\n";

  const mutatedInventory = buildSurfaceEntryInventory(mutatedSources);
  assert.equal(mutatedInventory.counts.duplicate_webview_handler_registrations, 1);
  assert.equal(mutatedInventory.bypass_guards.webview_handler_registration_unique, false);
  assertHasError(mutatedInventory, mutatedSources, 'webview:duplicate-handler-chat');
});

test('surface inventory checker command validates current inventory and generated view', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-surface-entry-inventory-check.mjs'],
    { cwd: repoRoot },
  );
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.deepEqual(result.summary, {
    inventory_sha256: expected.inventory_sha256,
    entries: 84,
    vscode_commands: 22,
    webview_inbound: 41,
    cli_entrypoints: 8,
    bridge_endpoints: 10,
    attachment_entries: 5,
    unknown_entries: 0,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  });
});

function assertHasError(inventory, activeSources, expectedError) {
  const result = validateSurfaceEntryInventory(inventory, activeSources);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(error => error.includes(expectedError)),
    `expected ${expectedError} in ${JSON.stringify(result.errors, null, 2)}`,
  );
}

function cloneSources() {
  return structuredClone(sources);
}

function loadSources() {
  const loaded = collectSurfaceEntryInventorySources(
    repoRoot,
    relativePath => readText(relativePath),
    relativePath => readJson(path.join(repoRoot, relativePath)),
  );
  loaded.rootPackageJson = readJson(path.join(repoRoot, 'package.json'));
  loaded.sourceContents['package.json'] = readText('package.json');
  return loaded;
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}
