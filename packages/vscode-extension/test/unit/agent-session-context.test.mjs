import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import Module, { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-session-context-'));
const bundlePath = path.join(bundleDir, 'agent-session-context.cjs');
const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-session-workspace-'));

execFileSync('npx', [
  'esbuild',
  'src/app/agent-session-context.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildAgenticSessionContextFromState,
  projectSessionContinuationFromState,
  resolveSessionContinuationFilesFromState,
} = createRequire(import.meta.url)(bundlePath);
Module._load = originalLoad;
after(() => {
  rmSync(bundleDir, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
});

test('same-session files are restored from state, not from current prompt vocabulary', () => {
  const input = baseInput({
    prompt: '再详细说明它们的差异',
    state: state({
      changedPaths: ['src/main.ts', 'docs/notes.md', 'dist/generated.js', 'build/cache.o'],
    }),
    lastAgentChangedPaths: ['code/tool.cpp', 'node_modules/pkg/index.js'],
    recentFilePaths: [
      path.join(workspaceRoot, 'packages/ui.ts'),
      path.join(workspaceRoot, 'README.md'),
      path.join(workspaceRoot, 'coverage/report.json'),
    ],
  });

  const restored = resolveSessionContinuationFilesFromState(input);

  assert.deepEqual(restored.slice(0, 3), [
    path.join(workspaceRoot, 'code/tool.cpp'),
    path.join(workspaceRoot, 'packages/ui.ts'),
    path.join(workspaceRoot, 'src/main.ts'),
  ]);
  assert.ok(restored.includes(path.join(workspaceRoot, 'docs/notes.md')));
  assert.ok(restored.includes(path.join(workspaceRoot, 'README.md')));
  assert.equal(restored.some(file => /(?:dist|build|node_modules|coverage)/u.test(file)), false);
});

test('restoration is bounded to six code files and three supporting files', () => {
  const codePaths = Array.from({ length: 10 }, (_, index) => `src/module-${index}.ts`);
  const supportPaths = Array.from({ length: 7 }, (_, index) => `docs/note-${index}.md`);
  const restored = resolveSessionContinuationFilesFromState(baseInput({
    state: state({ changedPaths: [...codePaths, ...supportPaths] }),
  }));

  assert.equal(restored.filter(file => file.endsWith('.ts')).length, 6);
  assert.equal(restored.filter(file => file.endsWith('.md')).length, 3);
  assert.equal(restored.length, 9);
  assert.equal(restored.slice(0, 6).every(file => file.endsWith('.ts')), true);
});

test('wildly different current messages produce the same bounded working set', () => {
  const prompts = [
    '继续',
    '说明 GPU CPU',
    'MODEL_LATEST_OK',
    'src/cache.ts を直して',
    'forget the previous task and explain recursion',
  ];
  const restored = prompts.map(prompt => resolveSessionContinuationFilesFromState(baseInput({
    prompt,
    state: state({ changedPaths: ['src/cache.ts', 'docs/cache.md'] }),
  })));

  for (const item of restored.slice(1)) assert.deepEqual(item, restored[0]);
});

test('explicit current files suppress automatic restoration but keep bounded history context', () => {
  const projection = projectSessionContinuationFromState({
    ...baseInput({
      state: state({ changedPaths: ['src/old.ts'] }),
      currentFilePaths: [path.join(workspaceRoot, 'src/current.ts')],
      history: [
        { role: 'user', content: '上一轮先修 old.ts' },
        { role: 'assistant', content: '上一轮尚未完成验证' },
      ],
    }),
    currentPrompt: '现在解释 current.ts',
    newSession: false,
  });

  assert.deepEqual(projection.restoreFiles, []);
  assert.equal(projection.mode, 'context-only');
  assert.match(projection.contextText, /非执行授权/u);
  assert.match(projection.contextText, /现在解释 current\.ts/u);
  assert.match(projection.contextText, /上一轮尚未完成验证/u);
});

test('new session is an absolute isolation boundary', () => {
  const projection = projectSessionContinuationFromState({
    ...baseInput({
      state: state({ changedPaths: ['src/old-task.ts'] }),
      history: [{ role: 'assistant', content: 'UAV telemetry from the old task' }],
    }),
    currentPrompt: '说明 GPU CPU',
    newSession: true,
  });

  assert.deepEqual(projection, { mode: 'none', restoreFiles: [], contextText: '' });
});

test('historical semantic contracts are metadata and never serialized as current authority', () => {
  const oldSemanticContract = {
    mutation: { requested: true, targets: ['src/forbidden-old-target.ts'] },
    intent: { mode: 'destructive' },
  };
  const context = buildAgenticSessionContextFromState({
    ...baseInput({
      state: state({ semanticContract: oldSemanticContract }),
      history: [{ role: 'user', content: '旧任务已经取消' }],
    }),
    currentPrompt: '只说明 GPU CPU',
  });

  assert.match(context, /同一 session 的有界历史上下文（非执行授权）/u);
  assert.match(context, /请由模型根据当前用户消息判断相关性/u);
  assert.doesNotMatch(context, /forbidden-old-target/u);
  assert.doesNotMatch(context, /destructive/u);
});

test('history projection is bounded and keeps recent turns', () => {
  const history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `${index}: ${'x'.repeat(900)}`,
  }));
  const context = buildAgenticSessionContextFromState({
    ...baseInput({ history }),
    currentPrompt: 'continue from the latest answer',
  });

  assert.ok(context.length <= 6000);
  assert.doesNotMatch(context, /- 用户: 0:/u);
  assert.match(context, /10:/u);
  assert.match(context, /11:/u);
});

test('no state, history, or files yields no continuation context', () => {
  const context = buildAgenticSessionContextFromState({
    ...baseInput(),
    currentPrompt: 'fresh input',
  });
  assert.equal(context, '');
});

function baseInput(overrides = {}) {
  const input = {
    workspaceRoot,
    prompt: '继续',
    currentPrompt: '继续',
    state: undefined,
    lastAgentChangedPaths: [],
    recentFilePaths: [],
    currentFilePaths: [],
    history: [],
    ...overrides,
  };
  for (const pathValue of [
    ...(input.state?.changedPaths ?? []),
    ...input.lastAgentChangedPaths,
    ...input.recentFilePaths,
    ...input.currentFilePaths,
  ]) {
    materializeWorkspaceFile(pathValue);
  }
  return input;
}

function state(overrides = {}) {
  return {
    lastUserPrompt: '上一轮任务',
    lastSummary: '上一轮摘要',
    changedPaths: [],
    completed: false,
    savedAt: 1,
    ...overrides,
  };
}

function materializeWorkspaceFile(pathValue) {
  const absolute = path.isAbsolute(pathValue) ? pathValue : path.join(workspaceRoot, pathValue);
  const relative = path.relative(workspaceRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return;
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, 'test fixture\n');
}
