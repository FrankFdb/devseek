/**
 * Unit tests for restored Agentic history.
 *
 * Claude Code/Codex-style contract: a completed coding-agent turn keeps a
 * compact visible summary, while detailed plan/change/validation evidence
 * remains available behind collapsible history. Persisting only a one-line
 * "done" summary loses the information the user needs when reopening history.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-history.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-history.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { buildAgenticHistoryText, buildAgenticQualityGateForHistory } = req(bundlePath);

test('Agentic history: free loop path must not persist thin one-line summaries', () => {
  const extensionSource = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
  const persistsThinSummary = /agentHistoryText\s*=\s*`\[Agentic\]\s*\$\{prompt\.slice\(0,\s*80\)\}\s*→\s*done/.test(extensionSource);

  assert.equal(
    persistsThinSummary,
    false,
    'free Agentic path should persist a collapsible evidence summary, not a thin "[Agentic] ... done" line',
  );
});

test('Agentic history: builds collapsible restored history with execution evidence', () => {
  const text = buildAgenticHistoryText({
    userPrompt: '创建 docs/manual-phase5-smoke.md，内容为：# Phase 5 smoke\nworkspace edit service manual test',
    roundCount: 1,
    completed: true,
    summary: '已创建文件并完成验证。',
    workspaceRoot: '/workspace/devseek',
    todos: [
      { id: 1, title: '创建/更新文件', status: 'completed' },
      { id: 2, title: '验证文件创建成功', status: 'completed' },
    ],
    writtenFiles: [
      {
        path: '/workspace/devseek/docs/manual-phase5-smoke.md',
        basename: 'manual-phase5-smoke.md',
        linesAdded: 2,
        linesRemoved: 0,
        action: 'create',
      },
    ],
    terminalEvidence: [
      {
        command: 'test -f /workspace/devseek/docs/manual-phase5-smoke.md && cat /workspace/devseek/docs/manual-phase5-smoke.md',
        kind: 'other',
        ok: true,
        exitCode: 0,
      },
    ],
    qualityGate: {
      status: 'pass',
      summary: 'QualityGate 通过：文件检查已通过。',
      evidenceRefs: ['terminal:ok:test -f docs/manual-phase5-smoke.md'],
    },
  });

  assert.match(text, /\*\*\[Agentic\] 已完成（1 轮）\*\*/);
  assert.match(text, /<details class="agent-history-details">/);
  assert.match(text, /<summary>任务清单与执行证据<\/summary>/);
  assert.match(text, /创建\/更新文件/);
  assert.match(text, /docs\/manual-phase5-smoke\.md/);
  assert.match(text, /QualityGate/);
  assert.match(text, /QualityGate 通过/);
  assert.match(text, /test -f \/workspace\/devseek\/docs\/manual-phase5-smoke\.md/);
  assert.doesNotMatch(text, /→\s*done/);
});

test('Agentic history: QualityGate records risks, alternatives, and required actions after reload', () => {
  const text = buildAgenticHistoryText({
    userPrompt: '创建 packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
    roundCount: 0,
    completed: false,
    failedReason: '自动验证未通过。',
    todos: [
      { id: 1, title: '创建目标文件', status: 'completed' },
      { id: 2, title: '验证文件创建成功', status: 'completed' },
      { id: 3, title: '运行自动验证 / QualityGate', status: 'failed' },
    ],
    writtenFiles: [
      {
        path: '/workspace/devseek/packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
        basename: 'manual-phase6-quality-gate.ts',
        linesAdded: 1,
        linesRemoved: 0,
        action: 'create',
      },
    ],
    terminalEvidence: [],
    qualityGate: {
      status: 'fail',
      summary: 'QualityGate 未通过：自动验证失败（exitCode=2）。',
      risks: ['自动验证命令失败，不能把任务标记为完成。'],
      evidenceRefs: ['validation:failed:npx tsc --noEmit'],
      alternativeChecks: ['人工检查变更文件内容是否符合用户请求。'],
      requiredActions: ['修复自动验证失败后重新运行 QualityGate。'],
    },
    workspaceRoot: '/workspace/devseek',
  });

  assert.match(text, /QualityGate/);
  assert.match(text, /<code>fail<\/code>/);
  assert.match(text, /风险/);
  assert.match(text, /证据引用/);
  assert.match(text, /替代检查/);
  assert.match(text, /待处理事项/);
  assert.match(text, /运行自动验证 \/ QualityGate/);
});

test('Agentic history: synthesizes a result summary when the model did not provide one', () => {
  const text = buildAgenticHistoryText({
    userPrompt: 'CLOSE02 probe：创建 probe.js 并验证。',
    roundCount: 4,
    completed: true,
    todos: [
      { id: 1, title: '创建/更新代码文件', status: 'completed' },
      { id: 2, title: '编译/运行并验证结果', status: 'completed' },
    ],
    writtenFiles: [
      {
        path: '/workspace/devseek/.devseek-close02-probe/CLOSE02-20260713-manual-probe/probe.js',
        basename: 'probe.js',
        linesAdded: 3,
        linesRemoved: 1,
        action: 'modify',
      },
    ],
    terminalEvidence: [
      {
        command: "test -s '/workspace/devseek/.devseek-close02-probe/CLOSE02-20260713-manual-probe/probe.js' && node --check '/workspace/devseek/.devseek-close02-probe/CLOSE02-20260713-manual-probe/probe.js'",
        kind: 'other',
        ok: true,
        exitCode: 0,
      },
    ],
    qualityGate: {
      status: 'pass',
      summary: 'QualityGate 通过：other 证据已通过。',
      evidenceRefs: ['terminal:ok:other:exitCode=0:test -s probe.js && node --check probe.js'],
    },
    workspaceRoot: '/workspace/devseek',
  });

  assert.match(text, /\*\*结果摘要：\*\*/);
  assert.match(text, /已完成 2\/2 个任务/);
  assert.match(text, /修改 1 个文件：probe\.js/);
  assert.match(text, /QualityGate 通过/);
});

test('Agentic history: visible summary stays useful while raw command evidence is folded', () => {
  const command = "g++ '/workspace/demo/hello.cpp' -o '/workspace/demo/build/hello' && '/workspace/demo/build/hello'";
  const text = buildAgenticHistoryText({
    userPrompt: '写一个 C++ 程序，打印下午好',
    roundCount: 1,
    completed: true,
    todos: [
      { id: 1, title: '创建 C++ 源文件', status: 'completed' },
      { id: 2, title: '编译运行并验证输出', status: 'completed' },
    ],
    writtenFiles: [
      {
        path: '/workspace/demo/hello.cpp',
        basename: 'hello.cpp',
        linesAdded: 6,
        linesRemoved: 0,
        action: 'create',
      },
    ],
    terminalEvidence: [
      { command, kind: 'compile-run', ok: true, exitCode: 0 },
    ],
    qualityGate: {
      status: 'pass',
      summary: 'QualityGate 通过：compile-run 证据已通过。',
      evidenceRefs: ['terminal:ok:compile-run:exitCode=0:g++ hello.cpp'],
    },
    workspaceRoot: '/workspace/demo',
  });

  const [visible, details = ''] = text.split('<details class="agent-history-details">');
  assert.match(visible, /已完成 2\/2 个任务/);
  assert.match(visible, /创建 1 个文件：hello\.cpp/);
  assert.match(visible, /QualityGate 通过/);
  assert.doesNotMatch(visible, /g\+\+/);
  assert.match(details, /验证\/终端证据/);
  assert.match(details, /g\+\+/);
});

test('Agentic history: visual manual review evidence is a blocked QualityGate, not a failed one', () => {
  const terminalEvidence = [
    {
      command: 'cmake --build /workspace/code/shape_manager/.devseek-build && /workspace/code/shape_manager/.devseek-build/shape_manager',
      kind: 'compile-run',
      ok: true,
      exitCode: -1,
      detail: '图形窗口效果需要人工确认。',
      reviewRequired: true,
    },
  ];
  const qualityGate = buildAgenticQualityGateForHistory({
    writtenFiles: [],
    terminalEvidence,
  });
  const text = buildAgenticHistoryText({
    userPrompt: '/workspace/code/shape_manager 优化图形描画，完成后编译执行看效果',
    roundCount: 2,
    completed: true,
    summary: '程序已启动，等待人工确认窗口效果。',
    todos: [
      { id: 1, title: '编译并运行 shape_manager 验证 X11 图形显示', status: 'completed' },
    ],
    writtenFiles: [
      {
        path: '/workspace/code/shape_manager/CMakeLists.txt',
        basename: 'CMakeLists.txt',
        linesAdded: 1,
        linesRemoved: 0,
        action: 'modify',
      },
    ],
    terminalEvidence,
    qualityGate,
    workspaceRoot: '/workspace',
  });

  assert.equal(qualityGate.status, 'blocked');
  assert.match(text, /QualityGate/);
  assert.match(text, /<code>blocked<\/code>/);
  assert.match(text, /图形窗口效果需要人工确认/);
  assert.doesNotMatch(text, /<code>fail<\/code>/);
});

test('Agentic history: later successful terminal evidence does not overwrite failure diagnosis', () => {
  const terminalEvidence = [
    {
      command: 'npm run compile',
      kind: 'compile',
      ok: false,
      exitCode: 2,
      detail: 'src/main.ts:7:1 - error TS2304: Cannot find name x.',
    },
    {
      command: 'test -f src/main.ts',
      kind: 'other',
      ok: true,
      exitCode: 0,
    },
  ];
  const qualityGate = buildAgenticQualityGateForHistory({
    writtenFiles: [
      {
        path: '/workspace/devseek/src/main.ts',
        basename: 'main.ts',
        linesAdded: 1,
        linesRemoved: 0,
        action: 'modify',
      },
    ],
    terminalEvidence,
  });
  const text = buildAgenticHistoryText({
    userPrompt: '修改 src/main.ts 并验证',
    roundCount: 2,
    completed: false,
    todos: [{ id: 1, title: '修改 src/main.ts', status: 'failed' }],
    writtenFiles: [
      {
        path: '/workspace/devseek/src/main.ts',
        basename: 'main.ts',
        linesAdded: 1,
        linesRemoved: 0,
        action: 'modify',
      },
    ],
    terminalEvidence,
    qualityGate,
    workspaceRoot: '/workspace/devseek',
  });

  assert.equal(qualityGate.status, 'fail');
  assert.equal(qualityGate.failureDiagnosis?.kind, 'validation-command-failed');
  assert.deepEqual(qualityGate.failureDiagnosis?.relatedPaths, ['/workspace/devseek/src/main.ts']);
  assert.match(text, /失败诊断/);
  assert.match(text, /Cannot find name x/);
  assert.doesNotMatch(text, /QualityGate 通过/);
});

test('Agent history: restored summary can preserve failed task progress and evidence', () => {
  const text = buildAgenticHistoryText({
    label: 'Agent',
    countLabel: '1/6 个任务',
    userPrompt: '/workspace/code/shape_manager 优化图形描画，完成后编译执行看效果',
    roundCount: 6,
    completed: false,
    failedReason: '4 个子任务缺少完成证据或执行失败。',
    todos: [
      { id: 1, title: '将 draw() 从字符串画改为使用 XDrawArc 绘制圆形边框', status: 'failed' },
      { id: 2, title: '将 draw() 从字符串画改为使用 XDrawRectangle 绘制矩形边框', status: 'failed' },
      { id: 3, title: '确保链接 X11 库（-lX11）并添加必要的编译选项', status: 'completed' },
      { id: 4, title: '使用 run_terminal 执行 cmake 编译并运行程序验证 X11 图形显示', status: 'failed' },
    ],
    writtenFiles: [
      {
        path: '/workspace/code/shape_manager/CMakeLists.txt',
        basename: 'CMakeLists.txt',
        linesAdded: 1,
        linesRemoved: 0,
        action: 'modify',
      },
    ],
    terminalEvidence: [
      {
        command: 'cmake -S /workspace/code/shape_manager -B /workspace/code/shape_manager/.devseek-build && cmake --build /workspace/code/shape_manager/.devseek-build',
        kind: 'compile',
        ok: true,
        exitCode: 0,
      },
    ],
    qualityGate: {
      status: 'blocked',
      summary: 'QualityGate 阻塞：缺少运行验证证据。',
      risks: ['不能仅凭构建成功证明图形程序运行效果。'],
      requiredActions: ['重新生成缺失源码修改，并实际运行程序。'],
    },
    workspaceRoot: '/workspace',
  });

  assert.match(text, /\*\*\[Agent\] 未完成（1\/6 个任务）\*\*/);
  assert.match(text, /<code>failed<\/code> 将 draw\(\) 从字符串画改为使用 XDrawArc/);
  assert.match(text, /code\/shape_manager\/CMakeLists\.txt/);
  assert.match(text, /compile/);
  assert.match(text, /QualityGate 阻塞/);
  assert.doesNotMatch(text, /\[Agent\] 已完成 1\/6 个任务/);
});
