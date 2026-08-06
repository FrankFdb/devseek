import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_CODEBASE_EXPLORATION_VERSION,
  CODING_CONTEXT_GRAPH_VERSION,
  CODING_ENGINEERING_ORIENTATION_VERSION,
  CanonicalCodebaseExplorationService,
  CanonicalContextGraphService,
  CanonicalEngineeringOrientationService,
  buildCodingKernelTaskContract,
  renderCodingContextGraphSummary,
} from '../dist/index.js';

function taskContract() {
  return buildCodingKernelTaskContract({
    goal: 'Update src/value.ts and verify the result',
    mode: 'change',
    include: ['src/value.ts', 'src/missing.ts', '.env'],
    deliverables: [{ id: 'source', kind: 'source-change', path: 'src/value.ts' }],
    acceptance: [{ id: 'verified', statement: 'The source change passes verification.' }],
    provenanceRefs: ['user-prompt'],
  });
}

test('canonical context graph composes bounded repository facts without projecting content', () => {
  const graph = new CanonicalContextGraphService().build({
    workspaceRoot: '/repo',
    taskContract: taskContract(),
    seed: {
      files: [
        { path: '/repo/src/value.ts', sizeBytes: 80, contentSample: 'export const value = "projected-only-to-budget";' },
        { path: '/repo/src/value.test.ts', sizeBytes: 90 },
        { path: '/repo/package.json', sizeBytes: 120 },
        { path: '/repo/tsconfig.json', sizeBytes: 50 },
        { path: '/repo/.env', sizeBytes: 20, contentSample: 'TOKEN=never-project-this' },
        { path: '/repo/build.log', sizeBytes: 900_000 },
      ],
      manifests: {
        'package.json': JSON.stringify({ scripts: { build: 'tsc', test: 'node --test' } }),
      },
    },
  });

  assert.equal(graph.version, CODING_CONTEXT_GRAPH_VERSION);
  assert.equal(graph.orientation.version, CODING_ENGINEERING_ORIENTATION_VERSION);
  assert.equal(graph.exploration.version, CODING_CODEBASE_EXPLORATION_VERSION);
  assert.deepEqual(graph.orientation.environment.languages, ['typescript']);
  assert.deepEqual(graph.orientation.environment.buildCommands, ['npm run build']);
  assert.deepEqual(graph.orientation.environment.testCommands, ['npm test']);
  assert.equal(node(graph, 'file:src/value.ts').status, 'available');
  assert.equal(node(graph, 'file:src/missing.ts').status, 'referenced');
  assert.equal(node(graph, 'file:.env').status, 'excluded');
  assert.equal(graph.exploration.excludedFiles.some(file => file.path === 'build.log'), true);
  assert.equal(graph.exploration.visibleFiles.some(file => 'contentSample' in file), false);
  assert.equal(JSON.stringify(graph).includes('never-project-this'), false);
  assert.equal(JSON.stringify(graph).includes('projected-only-to-budget'), false);
  assert.equal(graph.edges.some(edge => edge.from === 'task:current' && edge.to === 'file:src/value.ts'), true);
  assert.match(renderCodingContextGraphSummary(graph), /build commands: npm run build/u);
  assert.throws(() => graph.nodes.push({}), TypeError);
  assert.throws(() => graph.orientation.environment.languages.push('python'), TypeError);
});

test('engineering context path snapshots preserve filesystem roots and reject malformed inputs', () => {
  const orientation = new CanonicalEngineeringOrientationService().orient({
    workspaceRoot: '/',
    files: [{ path: '/src/index.ts' }],
  });
  assert.equal(orientation.workspaceRoot, '/');
  assert.deepEqual(orientation.candidatePaths, ['src/index.ts']);

  assert.throws(
    () => new CanonicalEngineeringOrientationService().orient({ workspaceRoot: '', files: [] }),
    /coding-engineering-orientation:missing-workspace-root/u,
  );
  assert.throws(
    () => new CanonicalContextGraphService().build({
      workspaceRoot: '/repo',
      taskContract: taskContract(),
      seed: { files: [{ path: '', sizeBytes: 1 }] },
    }),
    /coding-engineering-orientation:invalid-file-path/u,
  );
  assert.throws(
    () => new CanonicalCodebaseExplorationService().explore({
      orientation: { version: 'unsupported' },
      files: [],
    }),
    /coding-codebase-exploration:unsupported-orientation/u,
  );
});

function node(graph, id) {
  const value = graph.nodes.find(candidate => candidate.id === id);
  assert.ok(value, `missing graph node ${id}`);
  return value;
}
