import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODING_CONFORMANCE_DEVELOPMENT_FIXTURES,
  classifyCodingTerminalEffects,
  extractCodingWorkspacePaths,
  projectCodingKernelTaskContract,
  resolveCodingKernelTaskContract,
} from '../dist/index.js';

test('one task-contract resolver keeps all fixture semantics equal across Surfaces', () => {
  for (const fixture of CODING_CONFORMANCE_DEVELOPMENT_FIXTURES) {
    const projections = ['vscode', 'cli', 'headless'].map(surface => projectCodingKernelTaskContract(
      resolveCodingKernelTaskContract({
        prompt: fixture.prompt,
        surface,
        ...(fixture.taskContractInput ?? {}),
      }),
    ));
    for (const projection of projections) {
      assert.deepEqual(
        { ...projection, provenanceRefs: projection.provenanceRefs.length > 0 },
        { ...fixture.expected.taskContract, provenanceRefs: true },
        fixture.fixtureId,
      );
    }
  }
});

test('task-contract mode resolution preserves read-only questions and explicit change authority', () => {
  const explain = resolveCodingKernelTaskContract({
    prompt: 'How does the update command work?',
    surface: 'headless',
  });
  const review = resolveCodingKernelTaskContract({
    prompt: 'Analyze the release workflow and package.json.',
    surface: 'headless',
  });
  const change = resolveCodingKernelTaskContract({
    prompt: 'Review src/value.ts and fix the incorrect return value.',
    surface: 'headless',
  });

  assert.equal(explain.mode, 'explain');
  assert.equal(explain.orientation.mode, explain.mode);
  assert.equal(review.mode, 'review');
  assert.equal(review.orientation.mode, review.mode);
  assert.equal(change.mode, 'change');
  assert.equal(change.orientation.mode, change.mode);
  assert.deepEqual(change.deliverables.map(deliverable => deliverable.kind), [
    'source-change',
    'verification-result',
  ]);
});

test('Surface semantic arbitration prevents domain nouns from becoming external-effect boundaries', () => {
  const prompt = [
    'Complete include/deployment_coordinator.hpp and src/deployment_coordinator.cpp.',
    'Run ./test.sh after the local implementation is complete.',
  ].join(' ');
  const localContract = resolveCodingKernelTaskContract({
    prompt,
    surface: 'vscode',
    modeHint: 'change',
    externalEffectIntent: 'none',
  });
  const externalContract = resolveCodingKernelTaskContract({
    prompt: 'Deploy the service to production after running ./test.sh.',
    surface: 'vscode',
    modeHint: 'release',
    externalEffectIntent: 'requested',
  });

  assert.deepEqual(localContract.externalBoundaries, []);
  assert.equal(localContract.acceptance.some(item => item.id === 'verified'), true);
  assert.deepEqual(
    externalContract.externalBoundaries.map(boundary => boundary.id),
    ['external-deployment'],
  );
});

test('explicit run-only verification keeps the workspace read-only and requires terminal evidence', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: '只跑一下 health 检查，把结果告诉我；不要改文件，失败也不要修。',
    surface: 'vscode',
    modeHint: 'review',
    verificationRequired: true,
  });

  assert.equal(contract.mode, 'review');
  assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), [
    'report',
    'verification-result',
  ]);
  assert.deepEqual(contract.acceptance.map(criterion => criterion.id), [
    'grounded-response',
    'verified',
  ]);
  assert.equal(contract.constraints.includes('no-workspace-mutation'), true);
  assert.equal(contract.constraints.includes('verification-before-completion'), true);
  assert.equal(contract.nonGoals.includes('workspace-mutation'), true);
});

test('an explicit no-run boundary overrides a stale run-only verification proposal', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Review src/health.js only. Do not run, test, or modify anything.',
    surface: 'vscode',
    modeHint: 'review',
    verificationRequired: true,
  });

  assert.deepEqual(contract.deliverables.map(deliverable => deliverable.kind), ['report']);
  assert.deepEqual(contract.acceptance.map(criterion => criterion.id), ['grounded-response']);
  assert.equal(contract.constraints.includes('verification-before-completion'), false);
});

test('authoritative Surface verification is not revoked by a scoped test-file write prohibition', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: '只修改 src/value.cpp，不要改测试和 CMake，完成后运行 ./test.sh。',
    surface: 'vscode',
    modeHint: 'change',
    verificationRequired: true,
    verificationRequirementAuthoritative: true,
    externalEffectIntent: 'none',
  });

  assert.equal(contract.constraints.includes('verification-before-completion'), true);
  assert.equal(contract.acceptance.some(item => item.id === 'verified'), true);
});

test('terminal effect classification is command-owned and conservative for package operations', () => {
  assert.deepEqual(classifyCodingTerminalEffects('node --test test/value.test.js'), ['process']);
  assert.deepEqual(classifyCodingTerminalEffects('./test.sh 2>&1'), ['process']);
  assert.deepEqual(classifyCodingTerminalEffects('cmake -S . -B build 2>&1'), ['process']);
  assert.deepEqual(classifyCodingTerminalEffects('printf result > result.txt'), [
    'process',
    'workspace-mutation',
  ]);
  assert.deepEqual(classifyCodingTerminalEffects('npm install left-pad'), [
    'process',
    'network',
    'workspace-mutation',
  ]);
  assert.deepEqual(classifyCodingTerminalEffects('git add src/value.ts'), [
    'process',
    'workspace-mutation',
  ]);
  assert.throws(() => classifyCodingTerminalEffects(''), /missing-command/);
});

test('task resolution separates subjective acceptance from executable verification', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Create report.md and make it look professional.',
    surface: 'vscode',
    targetPaths: ['report.md'],
  });

  assert.equal(contract.acceptance.some(item => item.oracle.kind === 'subjective'), true);
  assert.equal(contract.acceptance.some(item => item.oracle.kind === 'workspace-readback'), true);
});

test('workspace paths named license do not create an external license boundary', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Refactor src/license/client.ts and run focused tests.',
    surface: 'vscode',
  });

  assert.equal(contract.externalBoundaries.some(boundary => boundary.kind === 'license'), false);
});

test('task resolution normalizes sentence punctuation and keeps every declared root or nested target', () => {
  const prompt = 'Create src/todo.cpp. Also create devseek.verify.json, then verify both.';
  const contract = resolveCodingKernelTaskContract({ prompt, surface: 'cli' });

  assert.deepEqual(extractCodingWorkspacePaths(prompt), ['src/todo.cpp', 'devseek.verify.json']);
  assert.deepEqual(contract.scope.include, ['src/todo.cpp', 'devseek.verify.json']);
  assert.deepEqual(
    contract.deliverables.filter(item => item.kind === 'source-change').map(item => item.path),
    ['src/todo.cpp', 'devseek.verify.json'],
  );
});

test('Chinese standalone authoring request scopes the explicitly named root file', () => {
  const prompt = [
    '请在当前工作区编写一个最小 C++ 程序 controlled-hello.cpp，运行后打印下午好。',
    '必须用 g++ 编译并运行验证输出后结束，不要修改其他文件。',
  ].join('');
  const contract = resolveCodingKernelTaskContract({ prompt, surface: 'vscode' });

  assert.deepEqual(extractCodingWorkspacePaths(prompt), ['controlled-hello.cpp']);
  assert.deepEqual(contract.scope.include, ['controlled-hello.cpp']);
  assert.equal(contract.deliverables.find(item => item.kind === 'source-change')?.path, 'controlled-hello.cpp');
  assert.equal(contract.constraints.includes('no-other-files'), true);
  assert.equal(contract.constraints.includes('verification-before-completion'), true);
});

test('context files remain evidence and cannot silently become mutation targets', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Implement the requested behavior and run focused tests.',
    surface: 'cli',
    contextFiles: ['src/context-only.ts'],
  });

  assert.deepEqual(contract.scope.include, []);
  assert.equal(contract.deliverables.find(item => item.kind === 'source-change')?.path, undefined);
});

test('slash-delimited stdin values cannot become workspace deliverables', () => {
  const prompt = 'Create an interactive CLI, run it with stdin Alice/3/4, and verify the output.';
  const contract = resolveCodingKernelTaskContract({ prompt, surface: 'cli' });

  assert.deepEqual(extractCodingWorkspacePaths(prompt), []);
  assert.deepEqual(contract.scope.include, []);
  assert.equal(contract.deliverables.find(item => item.kind === 'source-change')?.path, undefined);
});

test('reference files stay context while an explicitly named target directory owns mutation scope', () => {
  const prompt = [
    '参考 docs/requirement.md 和 src/reference.cpp。',
    '代码实现，创建于：src/oam/zc_maintenance 目录下。',
  ].join('');
  const contract = resolveCodingKernelTaskContract({ prompt, surface: 'cli' });

  assert.deepEqual(extractCodingWorkspacePaths(prompt), [
    'docs/requirement.md',
    'src/reference.cpp',
    'src/oam/zc_maintenance',
  ]);
  assert.deepEqual(contract.scope.include, ['src/oam/zc_maintenance/**']);
  assert.equal(contract.deliverables.find(item => item.kind === 'source-change')?.path, undefined);
});

test('host-declared target paths remain exact mutation deliverables', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Implement the requested behavior and verify it.',
    surface: 'vscode',
    contextFiles: ['docs/reference.md'],
    targetPaths: ['src/feature.ts'],
  });

  assert.deepEqual(contract.scope.include, ['src/feature.ts']);
  assert.equal(contract.deliverables.find(item => item.kind === 'source-change')?.path, 'src/feature.ts');
});

test('directory-only coding scope excludes prohibited paths and ignores technology labels', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: [
      '直接修改当前既有 Node.js 项目。',
      '只允许修改 `src/` 下的生产代码，不得修改 `tests/`、`package.json`。',
      '`src/domain/policy.js` 负责领域规则，执行 npm test。',
    ].join('\n'),
    surface: 'vscode',
  });

  assert.deepEqual(extractCodingWorkspacePaths(contract.goal), [
    'src/',
    'tests/',
    'package.json',
    'src/domain/policy.js',
  ]);
  assert.deepEqual(contract.scope.include, ['src/**']);
  assert.deepEqual(contract.scope.exclude, ['package.json', 'tests/**']);
  assert.equal(contract.constraints.includes('no-other-files'), true);
  assert.deepEqual(
    contract.deliverables.filter(item => item.kind === 'source-change'),
    [{ id: 'source-change', kind: 'source-change' }],
  );
});

test('mixed Chinese allow and deny lists bind every path to its nearest action', () => {
  const prompt = [
    '修复并重构 C++17 限流器。',
    '只允许修改 include/ 和 src/，不得修改 tests/、CMakeLists.txt 或 test.sh。',
    '运行 ./test.sh 验证。',
  ].join('\n');
  const contract = resolveCodingKernelTaskContract({ prompt, surface: 'vscode' });

  assert.deepEqual(extractCodingWorkspacePaths(prompt), [
    'include/',
    'src/',
    'tests/',
    'CMakeLists.txt',
    'test.sh',
  ]);
  assert.deepEqual(contract.scope.include, ['include/**', 'src/**']);
  assert.deepEqual(contract.scope.exclude, ['CMakeLists.txt', 'test.sh', 'tests/**']);
  assert.equal(contract.constraints.includes('no-other-files'), true);
  assert.deepEqual(
    contract.deliverables.filter(item => item.kind === 'source-change'),
    [{ id: 'source-change', kind: 'source-change' }],
  );
});

test('allowed file scope is not projected as one required deliverable per file', () => {
  const targets = [
    'include/deployment_coordinator.hpp',
    'src/deployment_coordinator.cpp',
    'test.sh',
  ];
  const contract = resolveCodingKernelTaskContract({
    prompt: [
      '仍然只允许修改 include/deployment_coordinator.hpp 和 src/deployment_coordinator.cpp，',
      '不能修改 tests、CMake、test.sh 或已有组件。完成后运行 ./test.sh。',
    ].join(''),
    surface: 'vscode',
    modeHint: 'change',
    targetPaths: targets,
    targetPathsAuthoritative: false,
    deliverableKinds: ['source-change', 'verification-result'],
    verificationRequired: true,
    verificationRequirementAuthoritative: true,
  });

  assert.deepEqual(contract.scope.include, targets.slice(0, 2));
  assert.deepEqual(contract.scope.exclude, ['test.sh']);
  assert.deepEqual(contract.deliverables, [
    { id: 'source-change', kind: 'source-change' },
    { id: 'verification-result', kind: 'verification-result' },
  ]);
});

test('Chinese completion requests remain mutating when behavior requirements mention inspection', () => {
  const prompt = [
    '请完善 C++17 分层配置合并和 schema 验证组件。',
    'merge 接收从低到高优先级的 layers，输入 layers 不得被修改。',
    'validate 对每条 Rule 检查 required、ValueType，并返回所有错误。',
    '只允许修改 include/ 和 src/，不得修改 tests/、CMakeLists.txt 或 test.sh。',
    '运行 ./test.sh。',
  ].join('\n');
  const contract = resolveCodingKernelTaskContract({ prompt, surface: 'vscode' });

  assert.equal(contract.mode, 'change');
  assert.equal(contract.orientation.mutating, true);
  assert.deepEqual(contract.scope.include, ['include/**', 'src/**']);
  assert.deepEqual(contract.scope.exclude, ['CMakeLists.txt', 'test.sh', 'tests/**']);
  assert.deepEqual(
    contract.deliverables.map(deliverable => deliverable.kind),
    ['source-change', 'verification-result'],
  );
  assert.equal(contract.nonGoals.includes('workspace-mutation'), false);
});

test('postfix actions do not claim a context path when they name another target', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Read docs/example.md and fix src/value.cpp, then run tests.',
    surface: 'cli',
  });

  assert.deepEqual(contract.scope.include, ['src/value.cpp']);
  assert.deepEqual(contract.scope.exclude, []);
});

test('a do-not-modify-other-files guard preserves the named repair target', () => {
  const contract = resolveCodingKernelTaskContract({
    prompt: 'Fix add(a, b) in src/math.js, do not modify other files, and verify the result.',
    surface: 'vscode',
  });

  assert.deepEqual(contract.scope.include, ['src/math.js']);
  assert.deepEqual(contract.scope.exclude, []);
  assert.equal(contract.constraints.includes('no-other-files'), true);
});
