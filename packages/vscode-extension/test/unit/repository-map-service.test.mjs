/**
 * Unit tests for R2-03B RepositoryMapService.
 *
 * Repository mapping turns roots, packages, entries, build/test commands,
 * generated boundaries and excludes into EvidenceRefs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/repository-map-service.bundle.cjs');

execSync(
  `npx esbuild src/app/repository-map-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  INTEGRATION_CALL_GRAPH_PROTOCOL_VERSION,
  buildIntegrationCallGraph,
  buildRepositoryMap,
} = createRequire(import.meta.url)(bundlePath);

function withTempWorkspace(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-repo-map-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(root, relPath, content = '') {
  const absPath = path.join(root, relPath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

test('RepositoryMapService: maps monorepo packages, entries, build/test commands and excludes', () => {
  withTempWorkspace((workspace) => {
    write(workspace, 'package.json', JSON.stringify({
      main: 'src/index.ts',
      scripts: { build: 'tsc -b', test: 'node --test' },
    }));
    write(workspace, 'src/index.ts', 'export const root = true;\n');
    write(workspace, 'packages/app/package.json', JSON.stringify({
      main: 'src/main.ts',
      scripts: { build: 'vite build', test: 'vitest run' },
    }));
    write(workspace, 'packages/app/src/main.ts', 'export const app = true;\n');
    write(workspace, 'dist/generated.js', 'generated\n');
    write(workspace, 'node_modules/pkg/index.js', 'ignored\n');

    const map = buildRepositoryMap({ workspaceRoots: [workspace] });
    const evidence = (kind) => map.evidence.filter(item => item.kind === kind);

    assert.equal(map.version, 'devseek.repository-map/v1');
    assert.ok(evidence('root').some(item => item.absPath === workspace));
    assert.deepEqual(evidence('package-manifest').map(item => item.relPath).sort(), [
      'package.json',
      'packages/app/package.json',
    ]);
    assert.ok(evidence('entrypoint').some(item => item.relPath === 'src/index.ts'));
    assert.ok(evidence('entrypoint').some(item => item.relPath === 'packages/app/src/main.ts'));
    assert.ok(evidence('build-command').some(item => item.value === 'npm run build' && item.relPath === 'package.json'));
    assert.ok(evidence('test-command').some(item => item.value === 'npm run test' && item.relPath === 'packages/app/package.json'));
    assert.ok(evidence('generated-boundary').some(item => item.relPath === 'dist/'));
    assert.ok(evidence('excluded-path').some(item => (
      item.relPath === 'node_modules/'
      && item.securityEffect === 'performance-skip-not-security-deny'
    )));
    assert.deepEqual(map.diagnostics.filter(item => item.kind === 'symlink-escape'), []);
  });
});

test('RepositoryMapService: refuses symlink escapes without treating ignores as safety deny', () => {
  withTempWorkspace((workspace) => {
    const outside = mkdtempSync(path.join(tmpdir(), 'devseek-repo-map-outside-'));
    try {
      write(workspace, 'package.json', '{"scripts":{"test":"node --test"}}');
      write(outside, 'secret.ts', 'export const outside = true;\n');
      mkdirSync(path.join(workspace, 'vendor'), { recursive: true });
      symlinkSync(outside, path.join(workspace, 'vendor', 'outside'));

      const map = buildRepositoryMap({ workspaceRoots: [workspace] });
      const symlink = map.diagnostics.find(item => item.kind === 'symlink-escape');

      assert.equal(symlink.relPath, 'vendor/outside');
      assert.ok(!map.evidence.some(item => item.absPath === path.join(outside, 'secret.ts')));
      assert.ok(map.evidence.every(item => item.securityEffect !== 'security-deny'));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('RepositoryMapService: large trees are truncated with evidence instead of broad scans', () => {
  withTempWorkspace((workspace) => {
    write(workspace, 'package.json', '{"scripts":{"build":"tsc"}}');
    for (let i = 0; i < 20; i += 1) {
      write(workspace, `src/file-${i}.ts`, `export const v${i} = ${i};\n`);
    }

    const map = buildRepositoryMap({ workspaceRoots: [workspace], maxEntriesPerRoot: 8 });
    const truncated = map.diagnostics.find(item => item.kind === 'large-tree-truncated');

    assert.equal(truncated.rootAbsPath, workspace);
    assert.ok(map.evidence.some(item => item.kind === 'root' && item.absPath === workspace));
    assert.ok(map.evidence.some(item => item.kind === 'scan-policy' && item.value === 'maxEntriesPerRoot:8'));
  });
});

test('RepositoryMapService: computes integration caller, callee, registry, protocol, and build closure', () => {
  const graph = buildIntegrationCallGraph({
    formalProject: true,
    changedNodeIds: ['impl'],
    nodes: [
      { id: 'impl', kind: 'source', path: 'src/license-service.ts', symbol: 'LicenseService' },
      { id: 'caller', kind: 'source', path: 'src/routes/license-route.ts', symbol: 'handleLicense' },
      { id: 'callee', kind: 'source', path: 'src/protocol/license-codec.ts', symbol: 'encodeLicense' },
      { id: 'registry', kind: 'registry', path: 'src/registry.ts', symbol: 'license.handlers' },
      { id: 'protocol', kind: 'protocol', path: 'proto/license.proto', symbol: 'LicenseRequest' },
      { id: 'build', kind: 'build-target', path: 'package.json', symbol: 'build:license' },
    ],
    edges: [
      { from: 'caller', to: 'impl', kind: 'caller', evidenceId: 'ev-caller' },
      { from: 'impl', to: 'callee', kind: 'callee', evidenceId: 'ev-callee' },
      { from: 'registry', to: 'impl', kind: 'registry', evidenceId: 'ev-registry' },
      { from: 'impl', to: 'protocol', kind: 'protocol', evidenceId: 'ev-protocol' },
      { from: 'build', to: 'impl', kind: 'build-target', evidenceId: 'ev-build' },
    ],
  });

  assert.equal(graph.version, INTEGRATION_CALL_GRAPH_PROTOCOL_VERSION);
  assert.equal(graph.decision, 'allow');
  assert.deepEqual(graph.missingRelationKinds, []);
  assert.deepEqual(new Set(graph.impactClosure.nodeIds), new Set(['impl', 'caller', 'callee', 'registry', 'protocol', 'build']));
  assert.deepEqual(new Set(graph.impactClosure.relationKinds), new Set(['caller', 'callee', 'registry', 'protocol', 'build-target']));
  assert.equal(graph.impactClosure.edgeIds.length, 5);
});

test('RepositoryMapService: formal project isolated demo/main changes are blocked', () => {
  const graph = buildIntegrationCallGraph({
    formalProject: true,
    changedNodeIds: ['demo'],
    nodes: [
      { id: 'demo', kind: 'source', path: 'demo/main.ts', symbol: 'main' },
    ],
    edges: [],
  });

  assert.equal(graph.decision, 'blocked');
  assert.ok(graph.reasons.includes('isolated-demo-main-risk'));
  assert.ok(graph.reasons.includes('missing-caller'));
  assert.ok(graph.reasons.includes('missing-callee'));
  assert.ok(graph.reasons.includes('missing-registry'));
  assert.ok(graph.reasons.includes('missing-protocol'));
  assert.ok(graph.reasons.includes('missing-build-target'));
  assert.deepEqual(graph.impactClosure.nodeIds, ['demo']);
});

test('RepositoryMapService: partial integration closure requests replan with explicit missing relation kinds', () => {
  const graph = buildIntegrationCallGraph({
    formalProject: true,
    changedNodeIds: ['impl'],
    nodes: [
      { id: 'impl', kind: 'source', path: 'src/license-service.ts', symbol: 'LicenseService' },
      { id: 'caller', kind: 'source', path: 'src/routes/license-route.ts', symbol: 'handleLicense' },
    ],
    edges: [
      { from: 'caller', to: 'impl', kind: 'caller', evidenceId: 'ev-caller' },
    ],
  });

  assert.equal(graph.decision, 'replan');
  assert.deepEqual(graph.missingRelationKinds, ['callee', 'registry', 'protocol', 'build-target']);
  assert.ok(graph.reasons.includes('missing-build-target'));
  assert.deepEqual(new Set(graph.impactClosure.nodeIds), new Set(['impl', 'caller']));
});

test('R2-06B Integration graph allows minimal main-flow implementation with sibling closure', () => {
  const graph = buildIntegrationCallGraph({
    formalProject: true,
    changedNodeIds: ['impl'],
    nodes: [
      { id: 'impl', kind: 'source', path: 'src/app/license-service.ts', symbol: 'LicenseService' },
      { id: 'caller', kind: 'source', path: 'src/app/license-route.ts', symbol: 'handleLicense' },
      { id: 'callee', kind: 'source', path: 'src/app/license-codec.ts', symbol: 'encodeLicense' },
      { id: 'registry', kind: 'registry', path: 'src/app/registry.ts', symbol: 'license.handlers' },
      { id: 'protocol', kind: 'protocol', path: 'proto/license.proto', symbol: 'LicenseRequest' },
      { id: 'build', kind: 'build-target', path: 'package.json', symbol: 'build' },
      { id: 'cli-sibling', kind: 'source', path: 'packages/cli/src/license.ts', symbol: 'LicenseService' },
    ],
    edges: [
      { from: 'caller', to: 'impl', kind: 'caller', evidenceId: 'ev-caller' },
      { from: 'impl', to: 'callee', kind: 'callee', evidenceId: 'ev-callee' },
      { from: 'registry', to: 'impl', kind: 'registry', evidenceId: 'ev-registry' },
      { from: 'impl', to: 'protocol', kind: 'protocol', evidenceId: 'ev-protocol' },
      { from: 'build', to: 'impl', kind: 'build-target', evidenceId: 'ev-build' },
    ],
    implementationRoutes: [
      { kind: 'main-flow', nodeIds: ['impl', 'caller'], evidenceId: 'ev-main-flow' },
    ],
    siblingClosures: [
      {
        id: 'same-license-service-contract',
        defectClass: 'license-service-contract',
        changedNodeIds: ['impl'],
        siblingNodeIds: ['cli-sibling'],
        status: 'covered',
        evidenceId: 'ev-sibling-closure',
      },
    ],
  });

  assert.equal(graph.decision, 'allow');
  assert.deepEqual(graph.reasons, []);
  assert.equal(graph.implementationRoutes[0].kind, 'main-flow');
  assert.equal(graph.siblingClosures[0].status, 'covered');
});

test('R2-06B Integration graph blocks harness bypasses and replans missing sibling closure', () => {
  const graph = buildIntegrationCallGraph({
    formalProject: true,
    changedNodeIds: ['harness'],
    nodes: [
      { id: 'harness', kind: 'source', path: 'test/harness/license-service.ts', symbol: 'LicenseServiceHarness' },
      { id: 'impl', kind: 'source', path: 'src/app/license-service.ts', symbol: 'LicenseService' },
      { id: 'caller', kind: 'source', path: 'src/app/license-route.ts', symbol: 'handleLicense' },
      { id: 'callee', kind: 'source', path: 'src/app/license-codec.ts', symbol: 'encodeLicense' },
      { id: 'registry', kind: 'registry', path: 'src/app/registry.ts', symbol: 'license.handlers' },
      { id: 'protocol', kind: 'protocol', path: 'proto/license.proto', symbol: 'LicenseRequest' },
      { id: 'build', kind: 'build-target', path: 'package.json', symbol: 'build' },
    ],
    edges: [
      { from: 'caller', to: 'harness', kind: 'caller', evidenceId: 'ev-caller' },
      { from: 'harness', to: 'callee', kind: 'callee', evidenceId: 'ev-callee' },
      { from: 'registry', to: 'harness', kind: 'registry', evidenceId: 'ev-registry' },
      { from: 'harness', to: 'protocol', kind: 'protocol', evidenceId: 'ev-protocol' },
      { from: 'build', to: 'harness', kind: 'build-target', evidenceId: 'ev-build' },
    ],
    implementationRoutes: [
      { kind: 'harness-bypass', nodeIds: ['harness'], evidenceId: 'ev-harness' },
    ],
    siblingClosures: [
      {
        id: 'same-license-service-contract',
        defectClass: 'license-service-contract',
        changedNodeIds: ['harness'],
        siblingNodeIds: ['impl'],
        status: 'missing',
      },
    ],
  });

  assert.equal(graph.decision, 'blocked');
  assert.ok(graph.reasons.includes('implementation-bypass-risk'));
  assert.ok(graph.reasons.includes('missing-sibling-closure'));
  assert.ok(graph.reasons.includes('sibling-closure-evidence-missing'));
});

console.log('\nRepository map service tests passed.\n');
