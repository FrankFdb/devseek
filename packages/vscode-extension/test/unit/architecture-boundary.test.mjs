/**
 * Architecture boundary guards for ARCH-05 Phase 0.
 *
 * These tests make the intended refactor path executable: new business should
 * move into domain services instead of growing extension.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');

function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

function physicalLineCount(content) {
  const lines = content.split(/\r?\n/).length;
  return content.endsWith('\n') ? lines - 1 : lines;
}

function nonBlankLineCount(content) {
  return content.split(/\r?\n/).filter(line => line.trim().length > 0).length;
}

test('Phase 0: composition-root files cannot grow past the baseline', () => {
  const budgets = [
    {
      file: 'src/extension.ts',
      maxPhysicalLines: 4300,
      maxNonBlankLines: 4060,
      target: 'move VS Code business into app, ui, workspace, llm, memory, or agent services',
    },
  ];

  for (const budget of budgets) {
    const content = read(budget.file);
    assert.ok(
      physicalLineCount(content) <= budget.maxPhysicalLines,
      `${budget.file} grew past ${budget.maxPhysicalLines} physical lines; ${budget.target}`,
    );
    assert.ok(
      nonBlankLineCount(content) <= budget.maxNonBlankLines,
      `${budget.file} grew past ${budget.maxNonBlankLines} non-blank lines; ${budget.target}`,
    );
  }
});

test('Phase 0: the retired legacy agent loop cannot return as a second execution owner', () => {
  assert.equal(existsSync(path.join(root, 'src/agent-loop.ts')), false);
  const sourceFiles = readdirSync(path.join(root, 'src'), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => read(`src/${entry.name}`));
  assert.equal(sourceFiles.some(source => /from ['"].*agent-loop['"]/.test(source)), false);
});

test('Phase 0: domain roots expose explicit public boundaries', () => {
  const boundaries = {
    'src/app/index.ts': [
      './agent-application-service',
      './agent-protocol',
      './chat-session-turn-service',
      './chat-controller',
      './permission-service',
      './session-service',
      './provider-recovery-service',
      './resume-context-builder',
      './task-checkpoint-store',
      './task-history-store',
      './task-history-ui-service',
      './task-ledger',
      './session-display-service',
      './quality-gate-service',
      './verification-planner',
      './workflow-service',
    ],
    'src/agent/index.ts': [
      './events',
      './fake-tool-parser',
      './idempotency-guard',
      './task-timeline-service',
      './tool-activity',
      './tool-executor',
    ],
    'src/workspace/index.ts': [
      './change-set',
      './edit-service',
      './path-resolver',
      './review-ledger',
      './validation-service',
    ],
    'src/llm/index.ts': [
      './provider-config-service',
      './provider-events',
      './provider-router',
      './provider-runtime',
      './providers/web-reliability',
      './types',
    ],
    'src/ui/index.ts': [
      './generated-artifact-ui',
      './pending-edit-diff',
      './webview-event-adapter',
      './webview-html',
      './webview-protocol',
    ],
    'src/memory/index.ts': [
      './memory-evidence',
      './memory-pipeline-store',
      './memory-projection',
      './memory-rollout-evidence',
      './memory-semantic-model',
      './memory-store',
      './pipeline-types',
      './repository-memory-location',
      './sensitive-memory-guard',
      './types',
    ],
  };

  for (const [file, expectedExports] of Object.entries(boundaries)) {
    const absPath = path.join(root, file);
    assert.ok(existsSync(absPath), `${file} must exist as the public boundary`);
    const content = read(file);
    for (const expectedExport of expectedExports) {
      assert.match(content, new RegExp(`export \\* from ['"]${expectedExport}['"];`), `${file} exports ${expectedExport}`);
    }
    assert.doesNotMatch(content, /extension|agent-loop/, `${file} must not re-export legacy entry points`);
  }
});

test('Phase 0: domain modules do not import legacy entry points or UI internals', () => {
  const domainDirs = ['src/app', 'src/agent', 'src/workspace', 'src/llm', 'src/memory'];
  const forbidden = [
    '../extension',
    '../agent-loop',
    '../ui/',
    '../../media/',
  ];
  const violations = [];

  for (const dir of domainDirs) {
    const absDir = path.join(root, dir);
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const relPath = path.join(dir, entry.name);
      const content = read(relPath);
      for (const needle of forbidden) {
        if (content.includes(needle)) {
          violations.push(`${relPath} imports ${needle}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('Phase 2/T5: memory boundary separates schema, persistence, semantics, and projections', () => {
  const memoryFiles = readdirSync(path.join(root, 'src/memory')).filter(name => name.endsWith('.ts')).sort();
  assert.deepEqual(memoryFiles, [
    'index.ts',
    'memory-evidence.ts',
    'memory-pipeline-store.ts',
    'memory-projection.ts',
    'memory-rollout-evidence.ts',
    'memory-semantic-model.ts',
    'memory-store.ts',
    'pipeline-types.ts',
    'repository-memory-location.ts',
    'sensitive-memory-guard.ts',
    'types.ts',
  ]);

  const types = read('src/memory/types.ts');
  for (const field of ['id', 'type', 'scope', 'content', 'source', 'confidence', 'createdAt', 'updatedAt', 'ttl', 'lastUsedAt', 'status', 'tags']) {
    assert.match(types, new RegExp(`\\b${field}\\b`), `MemoryRecord includes ${field}`);
  }
  assert.match(read('src/memory/memory-pipeline-store.ts'), /claimStage1/, 'pipeline store owns leased Phase 1 claims');
  assert.match(read('src/memory/memory-evidence.ts'), /assertMemoryCandidateEvidence/, 'evidence owner arbitrates model provenance claims');
  assert.match(read('src/memory/memory-semantic-model.ts'), /MemorySemanticExtractor/, 'semantic model owns extraction');
  assert.match(read('src/memory/memory-projection.ts'), /MemoryReadService/, 'projection boundary owns bounded recall');
  assert.match(read('src/memory/repository-memory-location.ts'), /resolveRepositoryMemoryLocation/, 'location owner isolates repository memory');
});

test('Phase 2: agent tool loop memory_write uses structured evidence-aware proposals only', () => {
  const toolLoop = read('src/agent/tool-loop.ts');
  const loopTypes = read('src/agent/loop-types.ts');
  const evidenceAwareMemoryWrite = read('src/app/evidence-aware-memory-write.ts');
  assert.doesNotMatch(toolLoop, /\.devseek\/memory\.md|memory\.md/, 'tool-loop must not mention legacy memory file paths');
  assert.doesNotMatch(toolLoop, /appendFileSync|writeFileSync|mkdirSync/, 'tool-loop must not persist memory directly');
  assert.match(loopTypes, /onPrepareMemoryWrite\?: \(\s*proposal: MemoryWriteProposal/, 'agent callback protocol emits prepared structured memory proposals');
  assert.match(toolLoop, /const proposal = \{[\s\S]*?type: 'verified-experience' as const/, 'tool-loop creates a typed memory proposal');
  assert.match(toolLoop, /callbacks\.onPrepareMemoryWrite\(proposal\)/, 'tool-loop sends the structured proposal through the canonical prepared host');
  assert.match(evidenceAwareMemoryWrite, /ProductMutationCoordinator/, 'memory writes must use the shared mutation evidence boundary');
  assert.match(evidenceAwareMemoryWrite, /verified-postcondition/, 'memory writes must prove their persisted postcondition');
});

test('Phase 7: task recovery services are split from composition roots', () => {
  const requiredFiles = [
    'src/app/task-checkpoint-store.ts',
    'src/app/task-history-store.ts',
    'src/app/resume-context-builder.ts',
    'src/app/provider-recovery-service.ts',
    'src/agent/idempotency-guard.ts',
    'src/agent/task-timeline-service.ts',
    'src/llm/providers/web-reliability.ts',
  ];
  for (const file of requiredFiles) {
    assert.ok(existsSync(path.join(root, file)), `${file} must exist for Phase 7 recovery architecture`);
  }

  const extension = read('src/extension.ts');
  const checkpoint = read('src/app/task-checkpoint-store.ts');
  assert.match(extension, /ScopedTaskCheckpointService/, 'extension.ts must delegate scoped checkpoint persistence to its application service');
  assert.doesNotMatch(extension, /new TaskCheckpointStore/, 'extension.ts must not construct the raw checkpoint store');
  assert.match(checkpoint, /class ScopedTaskCheckpointService[\s\S]*?new TaskCheckpointStore/, 'the scoped checkpoint service must own raw store construction');
  assert.doesNotMatch(extension, /workspaceState\.update\(CHECKPOINT_KEY/, 'extension.ts must not write checkpoint state directly');
  assert.doesNotMatch(extension, /workspaceState\.get<AgentTaskCheckpoint>\(CHECKPOINT_KEY/, 'extension.ts must not read checkpoint state directly');
});

test('Phase 10: provider chat routing lives in AgentApplicationService', () => {
  const extension = read('src/extension.ts');
  const service = read('../shared/src/agent-application-service.ts');
  const protocol = read('../shared/src/agent-protocol.ts');
  const vscodeServiceFacade = read('src/app/agent-application-service.ts');
  const vscodeProtocolFacade = read('src/app/agent-protocol.ts');
  const router = read('src/app/evidence-aware-chat-router.ts');

  assert.match(service, /class AgentApplicationService/, 'AgentApplicationService must own the application chat entry');
  assert.match(protocol, /export type AgentCommand/, 'AgentCommand must live in the application protocol');
  assert.match(protocol, /export type AgentEvent/, 'AgentEvent must live in the application protocol');
  assert.match(protocol, /interface SurfaceCapabilities/, 'SurfaceCapabilities must be explicit');
  assert.match(protocol, /interface PlatformProfile/, 'PlatformProfile must be explicit');
  assert.match(vscodeServiceFacade, /from '@devseek-netai\/shared'/, 'VS Code app service facade must re-export shared core');
  assert.match(vscodeProtocolFacade, /from '@devseek-netai\/shared'/, 'VS Code app protocol facade must re-export shared protocol');
  assert.match(router, /new AgentApplicationService\(deps\)/, 'evidence-aware router must compose the application service');
  assert.match(router, /this\.application\.routeChat\(request\)/, 'evidence-aware router must delegate provider routing to the application service');
  assert.match(extension, /evidenceAwareChatRouter\.route\(opts\)/, 'extension routeChat must delegate to its evidence-aware adapter');
  assert.doesNotMatch(extension, /const messages: ChatMessage\[\]/, 'extension.ts must not assemble provider chat messages');
  assert.doesNotMatch(extension, /\.chat\(\{\s*messages,/, 'extension.ts must not call provider.chat directly');
});
