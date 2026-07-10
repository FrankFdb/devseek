/**
 * Unit tests for agent completion evidence.
 *
 * Claude Code/Codex-style contract: task_complete is only a closing signal.
 * A fix/edit request needs concrete edit evidence, and code edits need a
 * successful project-appropriate validation command before DevSeek can mark the
 * task complete.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/completion-evidence.bundle.cjs');

execSync(
  `npx esbuild src/agent/completion-evidence.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  classifyTerminalEvidenceCommand,
  coalesceWrittenFileEvidence,
  describeBlockingTerminalFailure,
  extractClaimedSummaryFiles,
  findBlockingTerminalFailureEvidence,
  getUnsupportedSummaryFileClaims,
  getBlockingTerminalFailure,
  getMissingCompletionEvidence,
  hasReadOnlyAnswerEvidence,
  isBlockingTerminalFailureEvidence,
  isFileContentTerminalEvidenceCommand,
  isReadOnlyTerminalEvidenceCommand,
  requiresCodeArtifactForEvidence,
  requiresFileCheckEvidence,
  requiresFileContentReadEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
} = req(bundlePath);

const prompt = '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题';

test('completion evidence: explicit fix request requires code edit evidence', () => {
  assert.equal(requiresCodeArtifactForEvidence(prompt), true);
  assert.deepEqual(
    getMissingCompletionEvidence(prompt, [], [], []),
    ['代码修改结果'],
  );
});

test('completion evidence: read-only analysis does not require code edit evidence', () => {
  assert.equal(
    requiresCodeArtifactForEvidence('只分析 packages/vscode-extension/src/app/workflow-service.ts 的问题，不要修改代码'),
    false,
  );
});

test('completion evidence: advisory implementation countermeasure request is read-only', () => {
  const advisoryPrompt = '原来实现的吊运维保功能：设计文档+代码等/home/ff/uav/tars/huida_uav/src/oam/src/lifting/maintenance 下面是最新的维保提醒的需求： /home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 请分析，给出新需求的实现对策建议，并从主控需要实现功能角度给出task 当前不准备使用原来的逻辑，准备按照新的需求重新做，请帮我结合这些信息分析，给出你的建议';

  assert.equal(requiresFileChangeEvidence(advisoryPrompt), false);
  assert.equal(requiresCodeArtifactForEvidence(advisoryPrompt), false);
});

test('completion evidence: tool-intent prose is not a delivered read-only answer', () => {
  const interrupted = [
    '我来分析新旧需求差异，并给出实现对策建议。首先让我查看相关文件。',
    '',
    '**Tool: read_file**',
    '',
    '```',
    '{"path": "/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md"}',
    '```',
  ].join('\n');

  assert.equal(hasReadOnlyAnswerEvidence(interrupted), false);
  assert.equal(
    hasReadOnlyAnswerEvidence('现在我已经完整查看了新需求文档、旧实现代码和旧设计文档。接下来将生成分析报告。'),
    false,
  );
  assert.equal(
    hasReadOnlyAnswerEvidence('现在我已经收集了足够的信息，让我分析新需求与现有实现的差异，并给出实现对策建议。'),
    false,
  );
  assert.equal(hasReadOnlyAnswerEvidence('结论：新需求需要以状态机重构维保提醒，并把主控任务拆成阈值、状态、事件上报三类。'), true);
});

test('completion evidence: read-only file inspection needs read evidence, not write evidence', () => {
  const inspectPrompt = '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容。不要修改文件。';
  const hallucinatedWriteTodo = [{ title: '创建/更新文件' }];

  assert.equal(requiresReadEvidence(inspectPrompt), true);
  assert.equal(requiresFileContentReadEvidence(inspectPrompt), true);
  assert.equal(requiresFileChangeEvidence(`${inspectPrompt}\n创建/更新文件`), false);
  assert.deepEqual(
    getMissingCompletionEvidence(inspectPrompt, hallucinatedWriteTodo, [], [], []),
    ['文件内容读取结果'],
  );
  assert.deepEqual(
    getMissingCompletionEvidence(inspectPrompt, hallucinatedWriteTodo, [], [], ['docs/manual-phase5-smoke.md']),
    [],
  );
});

test('completion evidence: content display is not satisfied by existence-only terminal checks', () => {
  const inspectPrompt = '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容。不要修改文件。';
  const testEvidence = [{ command: 'test -f docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }];
  const listEvidence = [{ command: 'ls -la docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }];
  const catEvidence = [{ command: 'cat docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }];

  assert.equal(isReadOnlyTerminalEvidenceCommand(testEvidence[0].command), true);
  assert.equal(isFileContentTerminalEvidenceCommand(testEvidence[0].command), false);
  assert.deepEqual(getMissingCompletionEvidence(inspectPrompt, [], [], testEvidence, []), ['文件内容读取结果']);
  assert.deepEqual(getMissingCompletionEvidence(inspectPrompt, [], [], listEvidence, []), ['文件内容读取结果']);
  assert.deepEqual(getMissingCompletionEvidence(inspectPrompt, [], [], catEvidence, []), []);
});

test('completion evidence: existence-only read-only checks can complete with test evidence', () => {
  const inspectPrompt = '检查 docs/manual-phase5-smoke.md 是否存在。不要修改文件。';
  const testEvidence = [{ command: 'test -f docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }];

  assert.equal(requiresReadEvidence(inspectPrompt), true);
  assert.equal(requiresFileContentReadEvidence(inspectPrompt), false);
  assert.deepEqual(getMissingCompletionEvidence(inspectPrompt, [], [], testEvidence, []), []);
});

test('completion evidence: quoted CMake planner run command is compile-run evidence', () => {
  const command = [
    "cmake -S '/home/ff/work/devseek_netai/code/shape_manager' -B '/home/ff/work/devseek_netai/code/shape_manager/.devseek-build'",
    "cmake --build '/home/ff/work/devseek_netai/code/shape_manager/.devseek-build'",
    "if test -x '/home/ff/work/devseek_netai/code/shape_manager/.devseek-build/shape_manager'; then '/home/ff/work/devseek_netai/code/shape_manager/.devseek-build/shape_manager'; else ctest --test-dir '/home/ff/work/devseek_netai/code/shape_manager/.devseek-build' --output-on-failure; fi",
  ].join(' && ');
  const kind = classifyTerminalEvidenceCommand(command);

  assert.equal(kind, 'compile-run');
  assert.deepEqual(
    getMissingCompletionEvidence(
      '编译并运行 shape_manager 验证 X11 图形显示效果',
      [],
      [],
      [{ command, kind, ok: true, exitCode: 0 }],
    ),
    [],
  );
});

test('completion evidence: common Chinese implementation wording requires code evidence', () => {
  assert.equal(requiresCodeArtifactForEvidence('写一个排序算法并放到 code 目录'), true);
});

test('completion evidence: visual interaction enhancement requests require code evidence', () => {
  const visualPrompt = '现在三维图形都能显示了，自动旋转，然后这些立方体能同时显示，然后可以通过不同的控制吗，比如鼠标，背景添加天空？给让感觉更好的方式';

  assert.equal(requiresFileChangeEvidence(visualPrompt), true);
  assert.equal(requiresCodeArtifactForEvidence(visualPrompt), true);
  assert.deepEqual(
    getMissingCompletionEvidence(visualPrompt, [], [], []),
    ['代码修改结果'],
  );
});

test('completion evidence: UI title mojibake fix requires edit evidence', () => {
  const titlePrompt = 'title乱码，是不是存在中文的原因，请修改为英文吧';

  assert.equal(requiresFileChangeEvidence(titlePrompt), true);
  assert.equal(requiresCodeArtifactForEvidence(titlePrompt), true);
  assert.deepEqual(
    getMissingCompletionEvidence(titlePrompt, [], [], []),
    ['代码修改结果'],
  );
});

test('completion evidence: markdown file creation requires file evidence but not code validation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-docs-'));
  try {
    const file = path.join(root, 'docs', 'manual-phase5-smoke.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '# Phase 5 smoke\n');
    const docsPrompt = '创建 docs/manual-phase5-smoke.md，内容为 Phase 5 smoke';

    assert.equal(requiresFileChangeEvidence(docsPrompt), true);
    assert.equal(requiresCodeArtifactForEvidence(docsPrompt), false);
    assert.deepEqual(
      getMissingCompletionEvidence(docsPrompt, [], [], []),
      ['文件修改结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        docsPrompt,
        [],
        [{ path: file, basename: 'manual-phase5-smoke.md', linesAdded: 1, linesRemoved: 0, action: 'create' }],
        [],
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: markdown creation verification is satisfied by file-check evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-docs-verify-'));
  try {
    const file = path.join(root, 'docs', 'manual-phase6-quality.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'phase6 quality gate smoke');
    const docsPrompt = '创建 docs/manual-phase6-quality.md，内容为：phase6 quality gate smoke，并验证文件创建成功。';
    const writeEvidence = [{ path: file, basename: 'manual-phase6-quality.md', linesAdded: 1, linesRemoved: 0, action: 'create' }];
    const fileCheckEvidence = [{
      command: "test -f 'docs/manual-phase6-quality.md' && wc -c 'docs/manual-phase6-quality.md' && sed -n '1,80p' 'docs/manual-phase6-quality.md'",
      kind: 'other',
      ok: true,
      exitCode: 0,
    }];

    assert.equal(requiresFileCheckEvidence(docsPrompt), true);
    assert.deepEqual(
      getMissingCompletionEvidence(docsPrompt, [], writeEvidence, []),
      ['文件读取/检查结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(docsPrompt, [], writeEvidence, fileCheckEvidence),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: coalesces repeated writes to the same file for UI and history accounting', () => {
  const merged = coalesceWrittenFileEvidence([
    {
      path: '/repo/packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
      basename: 'manual-phase6-quality-gate.ts',
      linesAdded: 1,
      linesRemoved: 0,
      action: 'create',
    },
    {
      path: '/repo/packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
      basename: 'manual-phase6-quality-gate.ts',
      linesAdded: 1,
      linesRemoved: 1,
      action: 'modify',
    },
  ], '/repo');

  assert.deepEqual(merged, [{
    path: '/repo/packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
    basename: 'manual-phase6-quality-gate.ts',
    linesAdded: 1,
    linesRemoved: 0,
    action: 'create',
  }]);
});

test('completion evidence: generic file todos do not turn markdown creation into code evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-docs-todo-'));
  try {
    const file = path.join(root, 'docs', 'manual-phase5-smoke.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '# Phase 5 smoke\nworkspace edit service manual test\n');
    const docsPrompt = '创建 docs/manual-phase5-smoke.md，内容为 # Phase 5 smoke workspace edit service manual test';
    const todos = [
      { title: '创建/更新文件' },
      { title: '编译/运行并验证结果' },
    ];

    assert.equal(
      requiresCodeArtifactForEvidence(`${docsPrompt}\n${todos.map(t => t.title).join('\n')}`),
      false,
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        docsPrompt,
        todos,
        [{ path: file, basename: 'manual-phase5-smoke.md', linesAdded: 2, linesRemoved: 0, action: 'create' }],
        [{ command: 'test -f docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }],
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: task summary file claims must match written files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-summary-facts-'));
  try {
    const shapeDir = path.join(root, 'code', 'shape_manager');
    mkdirSync(shapeDir, { recursive: true });
    const main = path.join(shapeDir, 'main.cpp');
    const cmake = path.join(shapeDir, 'CMakeLists.txt');
    writeFileSync(main, 'int main(){return 0;}\n');
    writeFileSync(cmake, 'add_executable(shape_manager main.cpp)\n');

    const summary = [
      '已完成 6 个任务：',
      '✓ 创建 Sphere.h 和 Sphere.cpp（球体3D图形）',
      '✓ 创建 Cube.h 和 Cube.cpp（立方体3D图形）',
      '✓ 创建 Pyramid.h 和 Pyramid.cpp（棱锥3D图形）',
      '✓ 更新 main.cpp 使用三维图形类',
      '✓ 更新 CMakeLists.txt 添加新源文件',
    ].join('\n');

    assert.deepEqual(
      getUnsupportedSummaryFileClaims(
        summary,
        [
          { path: main, basename: 'main.cpp', linesAdded: 1, linesRemoved: 1, action: 'modify' },
          { path: cmake, basename: 'CMakeLists.txt', linesAdded: 1, linesRemoved: 1, action: 'modify' },
        ],
        root,
      ),
      ['Sphere.h', 'Sphere.cpp', 'Cube.h', 'Cube.cpp', 'Pyramid.h', 'Pyramid.cpp'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: Chinese quoted Markdown document claims require written evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-md-claim-'));
  try {
    const summary = '已完成：输出了《吊运维保功能重构——新旧需求对比分析与实现对策建议.md》文档。';

    assert.deepEqual(
      extractClaimedSummaryFiles(summary),
      ['吊运维保功能重构——新旧需求对比分析与实现对策建议.md'],
    );
    assert.deepEqual(
      getUnsupportedSummaryFileClaims(summary, [], root),
      ['吊运维保功能重构——新旧需求对比分析与实现对策建议.md'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: advisory future document suggestions are not completed-file claims', () => {
  const summary = '建议创建 warranty-maintenance-advice.md，用于沉淀新旧需求对比和主控任务清单。';

  assert.deepEqual(extractClaimedSummaryFiles(summary), []);
});

test('completion evidence: code edit requires successful validation evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-'));
  try {
    const file = path.join(root, 'packages', 'vscode-extension', 'src', 'app', 'workflow-service.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export const ok = true;\n');

    assert.deepEqual(
      getMissingCompletionEvidence(
        prompt,
        [],
        [{ path: file, basename: 'workflow-service.ts', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
        [],
      ),
      ['成功的编译/测试/语法验证命令结果'],
    );

    assert.deepEqual(
      getMissingCompletionEvidence(
        prompt,
        [],
        [{ path: file, basename: 'workflow-service.ts', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
        [{ command: 'npm run compile', kind: 'compile', ok: true, exitCode: 0 }],
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: failed runtime validation blocks completion until a later runtime success', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-runtime-'));
  try {
    const file = path.join(root, 'code', 'shape_manager', 'main.cpp');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'int main(){return 0;}\n');
    const runtimePrompt = `${path.dirname(file)} 优化图形描画，完成后，编译，执行看效果`;
    const writtenFiles = [{ path: file, basename: 'main.cpp', linesAdded: 1, linesRemoved: 1, action: 'modify' }];
    const failedRun = {
      command: 'cmake --build . && ./shape_manager',
      kind: 'compile-run',
      ok: false,
      exitCode: 127,
      detail: '/bin/sh: ./shape_manager: not found',
    };

    assert.equal(
      getBlockingTerminalFailure(runtimePrompt, [], writtenFiles, [
        { command: 'cmake --build .', kind: 'compile', ok: true, exitCode: 0 },
        failedRun,
      ]),
      failedRun,
    );
    assert.match(describeBlockingTerminalFailure(failedRun), /exitCode=127/);

    assert.equal(
      getBlockingTerminalFailure(runtimePrompt, [], writtenFiles, [
        failedRun,
        { command: './shape_manager', kind: 'run', ok: true, exitCode: 0 },
      ]),
      undefined,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: generic blocking terminal evidence is cleared by later runtime success', () => {
  const failedRun = {
    command: '/workspace/code/shape_manager/build/shape_manager',
    kind: 'run',
    ok: false,
    exitCode: 127,
    detail: '/bin/sh: shape_manager: not found',
  };
  const successfulRun = {
    command: '/workspace/code/shape_manager/build/bin/shape_manager',
    kind: 'run',
    ok: true,
    exitCode: 0,
    detail: '3D Shape Viewer - Click to select',
  };

  assert.equal(findBlockingTerminalFailureEvidence([failedRun]), failedRun);
  assert.equal(findBlockingTerminalFailureEvidence([failedRun, successfulRun]), undefined);
});

test('completion evidence: failed automatic compile validation remains blocking until cleared', () => {
  const failedAutoValidation = {
    command: "mkdir -p build/devseek && g++ test_selfloop_codex.cpp -o build/devseek/deepseek_auto_exec",
    kind: 'compile',
    ok: false,
    exitCode: 1,
    detail: 'fatal error: mc_log.h: No such file or directory',
  };
  const successfulCompile = {
    command: 'g++ -std=c++17 -I. test_selfloop_codex.cpp -o /tmp/test_warranty',
    kind: 'compile',
    ok: true,
    exitCode: 0,
    detail: 'compiled',
  };

  assert.equal(findBlockingTerminalFailureEvidence([failedAutoValidation]), failedAutoValidation);
  assert.equal(findBlockingTerminalFailureEvidence([failedAutoValidation, successfulCompile]), undefined);
});

test('completion evidence: transfer-source filenames are not treated as modified-file claims', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-transfer-source-'));
  try {
    const file = path.join(root, 'code', 'shape_manager', 'main.cpp');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'int main(){return 0;}\n');
    const summary = '已完成：将 main_3d.cpp 复制为 main.cpp（替换主程序）。';
    const writtenFiles = [{ path: file, basename: 'main.cpp', linesAdded: 12, linesRemoved: 4, action: 'modify' }];

    assert.deepEqual(extractClaimedSummaryFiles(summary), ['main.cpp']);
    assert.deepEqual(getUnsupportedSummaryFileClaims(summary, writtenFiles, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: manual visual review evidence does not become a blocking terminal failure', () => {
  const runtimePrompt = '/workspace/code/shape_manager 升级三维图形，完成后编译运行看效果';
  const reviewEvidence = {
    command: 'cmake --build . && ./shape_manager',
    kind: 'compile-run',
    ok: false,
    exitCode: -1,
    detail: '图形窗口效果需要人工确认。',
    reviewRequired: true,
  };

  assert.equal(isBlockingTerminalFailureEvidence(reviewEvidence), false);
  assert.equal(
    getBlockingTerminalFailure(runtimePrompt, [], [
      { path: '/workspace/code/shape_manager/main.cpp', basename: 'main.cpp', linesAdded: 1, linesRemoved: 1, action: 'modify' },
    ], [reviewEvidence]),
    undefined,
  );
});

console.log('\nCompletion evidence tests passed.\n');
