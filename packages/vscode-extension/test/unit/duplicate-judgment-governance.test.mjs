/**
 * ARCH-16 duplicate-judgment governance tests.
 *
 * These are architecture guards, not behavior tests. They keep high-risk
 * decision rules from quietly spreading into another phase of the agent loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../../');
const repositoryRoot = path.resolve(extensionRoot, '../..');
const bundlePath = path.join(extensionRoot, 'test/unit/judgment-owners.bundle.cjs');

execSync(
  `npx esbuild src/app/judgment-owners.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: extensionRoot, stdio: 'pipe' },
);

const {
  ARCHITECTURE_DECISION_PROTOCOL_VERSION,
  validateArchitectureDecisionImpactClosure,
  validateArchitectureDecisionLifecycle,
  validateArchitecturePlanRevisionGuard,
} = createRequire(import.meta.url)(bundlePath);

function readExtensionFile(relPath) {
  return readFileSync(path.join(extensionRoot, relPath), 'utf8');
}

function extensionFileExists(relPath) {
  return existsSync(path.join(extensionRoot, relPath));
}

function readRepositoryFile(relPath) {
  return readFileSync(path.join(repositoryRoot, relPath), 'utf8');
}

function governanceOwnerFileExists(relPath) {
  return relPath.startsWith('packages/') || relPath.startsWith('scripts/')
    ? existsSync(path.join(repositoryRoot, relPath))
    : extensionFileExists(relPath);
}

function collectFiles(relDir, predicate) {
  const baseDir = path.join(extensionRoot, relDir);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const absPath = path.join(dir, name);
      const relPath = path.relative(extensionRoot, absPath).replace(/\\/g, '/');
      if (relPath.includes('/dist/') || relPath.includes('/node_modules/')) continue;
      if (relPath === 'media/marked.umd.js' || relPath === 'media/mermaid.min.js') continue;
      const stat = statSync(absPath);
      if (stat.isDirectory()) {
        walk(absPath);
      } else if (predicate(relPath)) {
        out.push(relPath);
      }
    }
  };
  walk(baseDir);
  return out.sort();
}

const productionFiles = [
  ...collectFiles('src', rel => /\.(ts|js)$/.test(rel)),
  ...collectFiles('media', rel => /\.js$/.test(rel)),
].sort();

const governanceInventoryFiles = new Set([
  'src/app/judgment-owners.ts',
]);

function decisionFilesContaining(pattern) {
  return productionFiles.filter(relPath => !governanceInventoryFiles.has(relPath)).filter((relPath) => {
    const text = readExtensionFile(relPath);
    return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
  });
}

test('ARCH-16 owner registry covers every duplicate-judgment domain', () => {
  const registry = readExtensionFile('src/app/judgment-owners.ts');
  const required = [
    ['task-semantic-intent', 'src/task-semantic-contract.ts'],
    ['architecture-decision', 'src/app/judgment-owners.ts'],
    ['tool-protocol', 'packages/shared/src/coding-tool-schema.ts'],
    ['response-integrity', 'src/llm/providers/web-reliability.ts'],
    ['execution-outcome', 'src/execution-outcome-classifier.ts'],
    ['validation-orchestration', 'src/app/verification-planner.ts'],
    ['task-state', 'src/agent/task-state-machine.ts'],
    ['context-scope', 'src/app/context-scope-resolver.ts'],
    ['agent-display', 'src/app/agent-display-presenter.ts'],
    ['file-workspace', 'src/workspace/file-context-service.ts'],
    ['build-layout', 'src/cpp-build-layout.ts'],
  ];

  for (const [id, ownerModule] of required) {
    assert.ok(registry.includes(`id: '${id}'`), `${id} must have an owner record`);
    assert.ok(registry.includes(`ownerModule: '${ownerModule}'`), `${id} owner must be ${ownerModule}`);
    assert.ok(governanceOwnerFileExists(ownerModule), `${id} owner module must exist`);
  }

  assert.ok(registry.includes('contractTests'), 'owner records must name contract tests');
  assert.ok(registry.includes('guardedTerms'), 'owner records must name guarded terms');
});

test('ARCH-16 app boundary exports the duplicate-judgment owner registry', () => {
  const appIndex = readExtensionFile('src/app/index.ts');
  assert.ok(appIndex.includes("export * from './judgment-owners';"));
});

test('R2-05A architecture decisions require owner, lifecycle, failure model, ports, and non-goals', () => {
  const report = validateArchitectureDecisionLifecycle({
    id: 'adr-r2-05a',
    ownerModule: 'src/app/judgment-owners.ts',
    state: 'accepted',
    failureModes: ['parallel-owner', 'surface-business-rule', 'dual-write-owner'],
    ports: ['DesignAuthority->ImplementationPlanner'],
    nonGoals: ['Surface-owned business rules'],
    ownerClaims: [{ domain: 'task-state', ownerModule: 'src/agent/task-state-machine.ts' }],
    writeEffects: [{ target: 'architecture-decision-record', ownerModule: 'src/app/judgment-owners.ts' }],
  });

  assert.equal(report.version, ARCHITECTURE_DECISION_PROTOCOL_VERSION);
  assert.equal(report.decision, 'allow');
  assert.deepEqual(report.reasons, []);
  assert.equal(report.ownerModule, 'src/app/judgment-owners.ts');
  assert.equal(report.state, 'accepted');
});

test('R2-05A architecture decisions veto parallel owners, Surface rules, and dual writes', () => {
  const report = validateArchitectureDecisionLifecycle({
    id: 'adr-r2-05a-bad',
    ownerModule: '',
    state: 'accepted',
    failureModes: [],
    ports: [],
    nonGoals: [],
    ownerClaims: [
      { domain: 'task-state', ownerModule: 'src/agent/task-state-machine.ts' },
      { domain: 'task-state', ownerModule: 'src/agent/agentic-loop.ts' },
    ],
    surfaceBusinessRules: ['extension.ts decides task completion'],
    writeEffects: [
      { target: 'task-settlement', ownerModule: 'src/app/agent-run-settlement.ts' },
      { target: 'task-settlement', ownerModule: 'src/extension.ts' },
    ],
  });

  assert.equal(report.decision, 'blocked');
  assert.ok(report.reasons.includes('missing-owner'));
  assert.ok(report.reasons.includes('missing-failure-model'));
  assert.ok(report.reasons.includes('missing-port'));
  assert.ok(report.reasons.includes('missing-non-goal'));
  assert.ok(report.reasons.includes('parallel-owner'));
  assert.ok(report.reasons.includes('surface-business-rule'));
  assert.ok(report.reasons.includes('dual-write-owner'));
});

test('R2-05B architecture impact plans require migration, delete, rollback, and acceptance mapping', () => {
  const report = validateArchitectureDecisionImpactClosure({
    id: 'adr-r2-05b',
    impactSet: {
      callers: { items: [{ id: 'caller-extension', target: 'src/extension.ts', evidenceId: 'ev-caller' }] },
      generated: { notApplicableReason: 'no generated files touched', evidenceId: 'ev-generated-na' },
      schemas: { items: [{ id: 'schema-command', target: 'package.json contributes.commands', evidenceId: 'ev-schema' }] },
      releases: { notApplicableReason: 'no Extension/Bridge runtime release required', evidenceId: 'ev-release-na' },
    },
    migrationPlan: { steps: [{ target: 'src/app/old-owner.ts', action: 'delegate-to-judgment-owner', evidenceId: 'ev-migrate' }] },
    deletePlan: { steps: [{ target: 'src/app/parallel-owner.ts', action: 'delete', evidenceId: 'ev-delete' }] },
    rollbackPlan: { steps: [{ target: 'src/app/old-owner.ts', action: 'restore-baseline', evidenceId: 'ev-rollback' }] },
    acceptanceMapping: [{ acceptanceId: 'A1', impactIds: ['caller-extension'], verification: 'npm test', evidenceId: 'ev-accept' }],
  });

  assert.equal(report.version, ARCHITECTURE_DECISION_PROTOCOL_VERSION);
  assert.equal(report.decision, 'allow');
  assert.deepEqual(report.reasons, []);
  assert.equal(report.impactSet.callers.items[0].target, 'src/extension.ts');
});

test('R2-05B architecture impact plans fail closed on partial impact and unverified rollback', () => {
  const report = validateArchitectureDecisionImpactClosure({
    id: 'adr-r2-05b-partial',
    impactSet: {
      callers: { items: [{ id: 'caller-extension', target: 'src/extension.ts' }] },
      generated: {},
      schemas: {},
      releases: {},
    },
    migrationPlan: { steps: [] },
    deletePlan: {},
    rollbackPlan: { steps: [{ target: 'src/app/old-owner.ts', action: 'restore-baseline' }] },
    acceptanceMapping: [],
  });

  assert.equal(report.decision, 'blocked');
  assert.ok(report.reasons.includes('impact-evidence-missing'));
  assert.ok(report.reasons.includes('missing-generated-impact'));
  assert.ok(report.reasons.includes('missing-schema-impact'));
  assert.ok(report.reasons.includes('missing-release-impact'));
  assert.ok(report.reasons.includes('missing-migration-plan'));
  assert.ok(report.reasons.includes('missing-delete-plan'));
  assert.ok(report.reasons.includes('rollback-evidence-missing'));
  assert.ok(report.reasons.includes('missing-acceptance-mapping'));
});

test('R2-05C plan revisions bind new evidence to implementation changes and static guards', () => {
  const report = validateArchitecturePlanRevisionGuard({
    basePlanId: 'plan-r2-05b',
    revisionId: 'plan-r2-05c',
    revisionRationale: 'new source evidence changes the integration target',
    newEvidenceIds: ['ev-source-new', 'ev-import-check'],
    implementationChanges: [
      { target: 'src/app/integration-owner.ts', evidenceIds: ['ev-source-new'] },
    ],
    dependencyChecks: [
      { from: 'src/app/integration-owner.ts', to: 'src/agent/task-state-machine.ts', status: 'allowed', evidenceId: 'ev-import-check' },
    ],
    importReachabilityChecks: [
      { from: 'src/extension.ts', to: 'src/app/integration-owner.ts', reachable: true, evidenceId: 'ev-import-check' },
    ],
  });

  assert.equal(report.version, ARCHITECTURE_DECISION_PROTOCOL_VERSION);
  assert.equal(report.decision, 'allow');
  assert.deepEqual(report.reasons, []);
  assert.equal(report.implementationChanges[0].target, 'src/app/integration-owner.ts');
});

test('R2-05C plan revisions fail closed on unmapped evidence and dependency reachability violations', () => {
  const report = validateArchitecturePlanRevisionGuard({
    basePlanId: 'plan-r2-05b',
    newEvidenceIds: ['ev-source-new'],
    implementationChanges: [
      { target: 'src/extension.ts', evidenceIds: ['ev-unknown'] },
      { target: 'src/app/owner.ts', evidenceIds: [] },
    ],
    dependencyChecks: [
      { from: 'src/extension.ts', to: 'src/agent/task-state-machine.ts', status: 'violation', evidenceId: 'ev-dep' },
    ],
    importReachabilityChecks: [
      { from: 'src/extension.ts', to: 'src/app/owner.ts', reachable: false },
    ],
  });

  assert.equal(report.decision, 'blocked');
  assert.ok(report.reasons.includes('missing-plan-revision'));
  assert.ok(report.reasons.includes('missing-revision-rationale'));
  assert.ok(report.reasons.includes('unmapped-evidence-change'));
  assert.ok(report.reasons.includes('dependency-direction-violation'));
  assert.ok(report.reasons.includes('import-reachability-violation'));
  assert.ok(report.reasons.includes('revision-guard-evidence-missing'));
});

test('ARCH-16 tool alias search_content is owned by shared schema and generated manifest only', () => {
  const hits = decisionFilesContaining('search_content');
  assert.deepEqual(hits, ['media/webview-agent-tool-manifest.js']);
  assert.ok(readRepositoryFile('packages/shared/src/coding-tool-schema.ts').includes("search_content: 'grep_search'"));
  assert.ok(!extensionFileExists('src/agent/tool-registry.ts'));
});

test('ARCH-16 webview tool manifest is generated from shared coding tool schema', () => {
  const packageJson = readExtensionFile('package.json');
  const packageVsix = readFileSync(path.resolve(extensionRoot, '../../scripts/package-vsix.mjs'), 'utf8');
  const manifest = readExtensionFile('media/webview-agent-tool-manifest.js');
  const sanitizer = readExtensionFile('media/webview-agent-sanitizer.js');
  const runtime = readExtensionFile('media/webview-runtime.json');

  assert.ok(packageJson.includes('generate-webview-tool-manifest.mjs'), 'compile must refresh generated webview tool manifest');
  assert.ok(packageVsix.includes('generateWebviewToolManifest'), 'VSIX packaging must refresh generated webview tool manifest');
  assert.ok(runtime.indexOf('webview-agent-tool-manifest.js') < runtime.indexOf('webview-agent-sanitizer.js'));
  assert.ok(manifest.includes('Source of truth: packages/shared/src/coding-tool-schema.ts'));
  assert.ok(manifest.includes('"search_content"'));
  assert.ok(sanitizer.includes('DevSeekAgentToolManifest'), 'sanitizer must read generated tool manifest');
  assert.ok(sanitizer.includes('makeWebviewToolNamePattern'), 'sanitizer regexes must derive tool names from generated manifest');
  assert.ok(!sanitizer.includes('read_file: true'), 'sanitizer must not keep a hand-written tool-name map');
  assert.ok(!sanitizer.includes('search_content'), 'sanitizer must not keep hand-written tool aliases');
  assert.ok(extensionFileExists('test/fixtures/deepseek-tool-transcripts.mjs'), 'DeepSeek transcript replay fixtures must exist');
  assert.ok(extensionFileExists('test/unit/tool-protocol-contract.test.mjs'), 'tool protocol replay contract test must exist');
});

test('ARCH-16 backend cannot reintroduce generic execution-complete UI titles', () => {
  const hits = productionFiles
    .filter(relPath => !governanceInventoryFiles.has(relPath))
    .filter(relPath => relPath !== 'src/app/agent-display-presenter.ts')
    .filter(relPath => relPath.startsWith('src/'))
    .filter(relPath => readExtensionFile(relPath).includes('执行完成'));
  assert.deepEqual(hits, [], 'backend status events must use semantic validation titles, not generic UI text');
  assert.ok(
    readExtensionFile('src/app/agent-display-presenter.ts').includes('运行验证完成'),
    'the display presenter may translate generic completion text into semantic validation language',
  );
});

test('ARCH-16 legacy .devseek-build paths stay limited to compatibility and exclusion code', () => {
  const hits = decisionFilesContaining('.devseek-build');
  assert.deepEqual(hits, ['src/cpp-build-layout.ts']);
  assert.ok(readExtensionFile('src/cpp-build-layout.ts').includes('LEGACY_CPP_BUILD_DIR_NAMES'));
  assert.ok(!readExtensionFile('src/execution-planner.ts').includes('.devseek-build'));
  assert.ok(!readExtensionFile('src/local-execution.ts').includes('.devseek-build'));
  assert.ok(!readExtensionFile('src/validation-planner.ts').includes('.devseek-build'));
});

test('ARCH-16 runtime build planners do not produce legacy .devseek-build paths', () => {
  const hits = [
    'src/execution-planner.ts',
    'src/local-execution.ts',
    'src/tools/terminal.ts',
  ].filter(relPath => readExtensionFile(relPath).includes('.devseek-build'));
  assert.deepEqual(hits, []);
});

test('ARCH-16 unfriendly generated-response placeholder text stays removed from production UI', () => {
  const hits = decisionFilesContaining('可在下方尝试预览/应用');
  assert.deepEqual(hits, []);
});
