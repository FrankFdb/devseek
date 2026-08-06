import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AgentEvalReplayStore,
  CanonicalCodebaseExplorationService,
  CanonicalEngineeringOrientationService,
  ConflictGuard,
  DependencyPolicyService,
  DocGroundingService,
  PreviewVerificationService,
  WorkspaceRootService,
} from '../dist/index.js';

test('canonical orientation and exploration exclude content before indexing project facts', () => {
  const files = [
    { path: 'src/index.ts', sizeBytes: 1200, contentSample: 'export const value = 1;' },
    { path: 'src/index.test.ts', sizeBytes: 800 },
    { path: 'package.json', sizeBytes: 120 },
    { path: 'tsconfig.json', sizeBytes: 90 },
    { path: 'node_modules/lib/index.js', sizeBytes: 100 },
    { path: '.env', sizeBytes: 20, contentSample: 'TOKEN=do-not-project' },
    { path: 'private/notes.md', sizeBytes: 20 },
    { path: 'coverage/report.json', sizeBytes: 20 },
    { path: 'tmp/scratch.ts', sizeBytes: 20 },
  ];
  const manifests = {
    'package.json': JSON.stringify({ scripts: { build: 'tsc', test: 'node --test', dev: 'vite' } }),
  };
  const orientation = new CanonicalEngineeringOrientationService().orient({
    workspaceRoot: '/repo',
    files,
    manifests,
  });
  const context = new CanonicalCodebaseExplorationService().explore({
    orientation,
    files,
    devseekignore: 'private/\n',
    gitignore: 'coverage/\n',
    userExcludes: ['tmp/'],
  });

  assert.deepEqual(context.visibleFiles.map(file => file.path), [
    'package.json',
    'src/index.test.ts',
    'src/index.ts',
    'tsconfig.json',
  ]);
  assert.equal(context.index.totalFiles, 4);
  assert.deepEqual(context.index.testFiles, ['src/index.test.ts']);
  assert.equal(orientation.environment.packageManager, 'npm');
  assert.deepEqual(orientation.environment.buildCommands, ['npm run build']);
  assert.deepEqual(orientation.environment.testCommands, ['npm test']);
  assert.equal(orientation.runtimes.some(runtime => runtime.language === 'typescript'), true);
  assert.equal(context.excludedFiles.some(file => file.path === '.env' && file.sensitive), true);
  assert.equal(context.excludedFiles.some(file => file.path === 'node_modules/lib/index.js'), true);
  assert.equal(context.visibleFiles.some(file => 'contentSample' in file), false);
  assert.equal(JSON.stringify(context).includes('do-not-project'), false);
});

test('Engineering policies expose dependency, docs, preview, conflict, root, and replay decisions', () => {
  const dependency = new DependencyPolicyService().classifyCommand('npm install left-pad');
  assert.equal(dependency.requiresApproval, true);
  assert.deepEqual(dependency.reasons, ['network-side-effect', 'lockfile-change']);

  const docs = new DocGroundingService().plan('OpenAI SDK', {
    localVersion: '5.x',
    officialSources: ['https://platform.openai.com/docs'],
    currentInformationNeeded: true,
  });
  assert.equal(docs.requiresNetwork, true);
  assert.deepEqual(docs.allowedSources, ['https://platform.openai.com/docs']);

  const preview = new PreviewVerificationService().plan({
    languages: ['typescript'],
    buildCommands: ['npm run build'],
    testCommands: ['npm test'],
    lintCommands: [],
    runCommands: ['npm run dev'],
    configFiles: [],
  }, ['src/App.tsx']);
  assert.equal(preview.required, true);
  assert.deepEqual(preview.commands, ['npm run build', 'npm run dev']);

  const conflict = new ConflictGuard().check(
    { path: 'src/a.ts', hash: 'old', mtimeMs: 1 },
    { path: 'src/a.ts', hash: 'new', mtimeMs: 2 },
  );
  assert.equal(conflict.conflict, true);
  assert.deepEqual(conflict.reasons, ['hash-changed', 'mtime-advanced']);

  const root = new WorkspaceRootService().resolve(['/repo', '/repo/packages/app'], '/repo/packages/app/src/index.ts');
  assert.equal(root.root, '/repo/packages/app');

  const replay = new AgentEvalReplayStore().createCase({
    id: 'case-1',
    prompt: 'use api_key=abc123 and fix tests',
    providerType: 'bridge',
    events: [{ type: 'chat.started' }, { type: 'qualityGate.completed' }],
    evidenceRefs: ['validation:passed'],
  });
  assert.equal(replay.prompt.includes('abc123'), false);
  assert.deepEqual(replay.expectedEvents, ['chat.started', 'qualityGate.completed']);
});

test('canonical engineering orientation uses stable build/ directory for CMake command hints', () => {
  const context = new CanonicalEngineeringOrientationService().orient({
    workspaceRoot: '/repo',
    files: [
      { path: 'CMakeLists.txt', sizeBytes: 80 },
      { path: 'main.cpp', sizeBytes: 120 },
    ],
  });

  assert.deepEqual(context.environment.buildCommands, ['cmake -S . -B build && cmake --build build']);
  assert.deepEqual(context.environment.testCommands, ['ctest --test-dir build --output-on-failure']);
  assert.equal(context.environment.buildCommands.join('\n').includes('.devseek-build'), false);
});
