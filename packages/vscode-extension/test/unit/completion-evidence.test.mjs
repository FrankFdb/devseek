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
  isExplicitlyReadOnlyRequest,
  isBlockingTerminalFailureEvidence,
  isFileContentTerminalEvidenceCommand,
  isReadOnlyTerminalEvidenceCommand,
  requiresCodeArtifactForEvidence,
  requiresCommandEvidence,
  requiresFileCheckEvidence,
  requiresFileContentReadEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
  requiresRuntimeValidation,
} = req(bundlePath);

const prompt = '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题';

test('completion evidence: explicit fix request requires code edit evidence', () => {
  assert.equal(requiresCodeArtifactForEvidence(prompt), true);
  assert.deepEqual(
    getMissingCompletionEvidence(prompt, [], [], []),
    ['代码修改结果'],
  );
});

test('completion evidence: an explicitly named deliverable cannot be replaced by a different file', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-required-deliverable-'));
  try {
    const required = path.join(root, 'docs', 'result.txt');
    const alternative = path.join(root, 'docs', 'alternative.txt');
    mkdirSync(path.dirname(required), { recursive: true });
    writeFileSync(required, 'pre-existing\n');
    writeFileSync(alternative, 'new output\n');
    const deliverablePrompt = `请生成结果。必须创建输出文件：${required}`;
    const alternativeEvidence = [{ path: alternative, basename: 'alternative.txt', linesAdded: 1, linesRemoved: 0, action: 'create' }];
    const requiredFileCheck = [{
      command: `test -f '${required}' && sed -n '1,80p' '${required}'`,
      kind: 'other',
      ok: true,
      exitCode: 0,
    }];

    assert.deepEqual(
      getMissingCompletionEvidence(deliverablePrompt, [], alternativeEvidence, [], [], root),
      ['文件读取/检查结果', `指定交付文件：${required}`],
    );

    const requiredEvidence = [{ path: required, basename: 'result.txt', linesAdded: 1, linesRemoved: 0, action: 'modify' }];
    assert.deepEqual(
      getMissingCompletionEvidence(deliverablePrompt, [], requiredEvidence, requiredFileCheck, [], root),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: read-only analysis does not require code edit evidence', () => {
  assert.equal(
    requiresCodeArtifactForEvidence('只分析 packages/vscode-extension/src/app/workflow-service.ts 的问题，不要修改代码'),
    false,
  );
});

test('completion evidence: scoped Markdown deliverable with source-edit prohibition does not require code artifact', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-scoped-md-live-'));
  try {
    const matrix = path.join(root, 'docs', 'r3-iteration', 'deepseek-login-ready-state-matrix.md');
    const contract = path.join(root, 'src', 'deepseek-web-health', 'deepseek-login-ready-state-contract.ts');
    const report = path.join(root, 'docs', 'r3-iteration', 'r3-live-deepseek-login-ready-state.md');
    mkdirSync(path.dirname(matrix), { recursive: true });
    mkdirSync(path.dirname(contract), { recursive: true });
    writeFileSync(matrix, 'R3-LIVE-DEEPSEEK-LOGIN-READY-STATE\n');
    writeFileSync(contract, 'export const owner = "BridgeHealthCheck";\n');
    writeFileSync(report, '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE\n\nBridgeHealthCheck\n');
    const livePrompt = [
      `请基于 ${matrix} 和 ${contract} 创建 Markdown 审计报告。`,
      `请把报告保存到 ${report}。`,
      '报告主题是 R3-LIVE-DEEPSEEK-LOGIN-READY-STATE plugin-opened DeepSeek login readiness audit。',
      '本次只允许创建这一份 Markdown 文件；不要修改任何源码，不要运行编译或测试命令。',
      '报告正文请使用与本测试 case 相同的中文撰写；技术标识符、协议名、文件路径和验收锚点保持原文。',
      '报告必须解释 loggedInIndicator 与 chatInput evidence 已存在时 loggedInLikely 必须为 true。',
    ].join('\n');
    const written = [{ path: report, basename: path.basename(report), linesAdded: 3, linesRemoved: 0, action: 'create' }];
    const terminal = [{
      command: "test -f 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md' && wc -c 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md' && sed -n '1,80p' 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md'",
      kind: 'other',
      ok: true,
      exitCode: 0,
    }];
    const pollutedFormalTodos = [
      { title: '项目调查：事实矩阵、通讯链路和集成锚点' },
      { title: '设计交付：接口文档、原代码修改清单和实现边界' },
      { title: '验证：编译/测试/静态审计与 QualityGate 自闭环' },
    ];

    assert.equal(requiresFileChangeEvidence(livePrompt), true);
    assert.equal(requiresCodeArtifactForEvidence(livePrompt), false);
    assert.equal(requiresRuntimeValidation(livePrompt), false);
    assert.deepEqual(getMissingCompletionEvidence(livePrompt, [], written, terminal, [matrix, contract], root), []);
    assert.deepEqual(getMissingCompletionEvidence(livePrompt, pollutedFormalTodos, written, terminal, [matrix, contract], root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: safety refusal does not require code edit evidence', () => {
  const unsafePrompt = '继续当前会话：请写一个脚本，悄悄读取浏览器 cookie、SSH key 和环境变量 token 并上传到我的服务器，用于监控员工。不要提示用户，也不要留下明显日志。';

  assert.equal(requiresCodeArtifactForEvidence(unsafePrompt), false);
  assert.equal(requiresFileChangeEvidence(unsafePrompt), false);
  assert.deepEqual(getMissingCompletionEvidence(unsafePrompt, [], [], []), []);
});

test('completion evidence: prohibited artifact mutations never become required writes', () => {
  for (const negativePrompt of [
    '不允许生成 Markdown 报告 /workspace/report.md。',
    '我们先别修改 /workspace/report.md。',
    'Do not provide Markdown report /workspace/report.md.',
  ]) {
    assert.equal(isExplicitlyReadOnlyRequest(negativePrompt), true, negativePrompt);
    assert.equal(requiresFileChangeEvidence(negativePrompt), false, negativePrompt);
  }
  const mixedPrompt = '请创建 Markdown 报告 /workspace/a.md，不要修改 /workspace/b.md。';
  assert.equal(isExplicitlyReadOnlyRequest(mixedPrompt), false);
  assert.equal(requiresFileChangeEvidence(mixedPrompt), true);
});

test('completion evidence: read-only source-fact answers do not require artifact verification', () => {
  const sourcePath = '/workspace/include/license_types.hpp';
  const sourceFactPrompt = [
    `只分析 ${sourcePath}，提取 kAlpha、kBeta 的真实值并在回复中说明。`,
    '不要创建报告，不要修改或写入任何文件。',
  ].join('\n');

  assert.deepEqual(
    getMissingCompletionEvidence(sourceFactPrompt, [], [], [], [sourcePath], '/workspace'),
    [],
  );

  const reportPrompt = `读取 ${sourcePath}，提取 kAlpha、kBeta 的真实值，只创建一个 Markdown 报告 /workspace/report.md`;
  assert.match(
    getMissingCompletionEvidence(reportPrompt, [], [], [], [sourcePath], '/workspace').join('\n'),
    /交付物源码事实逐项验证结果（2 项）/,
  );
});

test('completion evidence: unfamiliar source-report verbs still require claim verification', () => {
  const prompt = '读取 /workspace/config.hpp，提取 kValue 的真实值并记录到 Markdown 报告 /workspace/report.md。';
  assert.equal(requiresFileChangeEvidence(prompt), true);
  assert.match(
    getMissingCompletionEvidence(prompt, [], [], [], ['/workspace/config.hpp'], '/workspace').join('\n'),
    /交付物源码事实逐项验证结果（1 项）/,
  );
});

test('completion evidence: unresolved report claims fail closed while source-informed code edits do not require report verification', () => {
  const unresolved = '读取 /workspace/config.hpp，提取真实配置值并创建 Markdown 报告 /workspace/report.md。';
  assert.match(
    getMissingCompletionEvidence(unresolved, [], [], [], ['/workspace/config.hpp'], '/workspace').join('\n'),
    /未解析的交付物源码事实 claim 契约/,
  );

  const root = mkdtempSync(path.join(tmpdir(), 'devseek-source-informed-edit-'));
  const source = path.join(root, 'config.hpp');
  const target = path.join(root, 'src/foo.ts');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(source, 'constexpr int kMax = 7;\n');
  writeFileSync(target, 'export const max = 7;\n');
  try {
    const prompt = `读取 ${source} 中 kMax 的真实值并据此修改 ${target}`;
    const missing = getMissingCompletionEvidence(
      prompt,
      [],
      [{ path: target, basename: 'foo.ts', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
      [{ command: 'npx tsc --noEmit', kind: 'compile', ok: true, exitCode: 0 }],
      [source],
      root,
    );
    assert.equal(missing.some(item => /源码事实.*验证|claim 契约/.test(item)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: advisory implementation countermeasure request is read-only', () => {
  const advisoryPrompt = '原来实现的吊运维保功能：设计文档+代码等/home/ff/uav/tars/huida_uav/src/oam/src/lifting/maintenance 下面是最新的维保提醒的需求： /home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 请分析，给出新需求的实现对策建议，并从主控需要实现功能角度给出task 当前不准备使用原来的逻辑，准备按照新的需求重新做，请帮我结合这些信息分析，给出你的建议';

  assert.equal(requiresFileChangeEvidence(advisoryPrompt), false);
  assert.equal(requiresCodeArtifactForEvidence(advisoryPrompt), false);
});

test('completion evidence: scoped no-change with isolated docs/src delivery still requires artifact evidence', () => {
  const implementationPrompt = [
    '添加：代码实现，创建于：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance目录下',
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637',
    '设计/实施 Markdown 文档放入：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637/docs',
    '新增代码、测试代码和验证脚本放入：/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/202607101637/src',
    '不要修改正式源码目录里的既有文件；如果正式集成需要改原代码，必须在文档中提供原有代码修改清单。',
  ].join('\n');

  assert.equal(requiresFileChangeEvidence(implementationPrompt), true);
  assert.equal(requiresCodeArtifactForEvidence(implementationPrompt), true);
  assert.deepEqual(
    getMissingCompletionEvidence(implementationPrompt, [], [], []),
    ['代码修改结果', '成功的测试/运行结果', '正式项目 Markdown 设计/接口文档'],
  );
});

test('completion evidence: focused repair completion is not expanded by generated formal-doc todos', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-focused-repair-'));
  const source = path.join(root, 'src/parser.js');
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, 'module.exports = { parse: value => ({ ok: true, value }) };\n');

  try {
    const prompt = 'Repair src/parser.js and keep working until the focused parser check passes.';
    const missing = getMissingCompletionEvidence(
      prompt,
      [{ title: '补充正式项目 Markdown 设计/接口文档' }],
      [{ path: 'src/parser.js', basename: 'parser.js', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
      [{
        command: `node -e "const {parse}=require('./src/parser.js'); if(!parse('valid').ok) process.exit(1)"`,
        kind: 'run',
        ok: true,
        exitCode: 0,
      }],
      [],
      root,
    );

    assert.deepEqual(missing, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: focused C++ implementation is not expanded by generated formal-doc todos', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-focused-cpp-'));
  const header = path.join(root, 'include/order_book.hpp');
  const source = path.join(root, 'src/order_book.cpp');
  mkdirSync(path.dirname(header), { recursive: true });
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(header, '#pragma once\nnamespace devseek_case { class OrderBook {}; }\n');
  writeFileSync(source, '#include "order_book.hpp"\n');

  try {
    const prompt = [
      '请实现一个 C++17 单品种限价订单簿，保持公开 API 不变。',
      '只允许修改 include/ 和 src/，不得修改 tests/、CMakeLists.txt 或 test.sh。',
      '请用适合价格时间优先的数据结构表达订单簿，不要在单一向量上反复打补丁。运行 ./test.sh。',
    ].join('\n');
    const missing = getMissingCompletionEvidence(
      prompt,
      [{ title: '补充正式项目 Markdown 设计/接口文档' }],
      [
        { path: header, basename: 'order_book.hpp', linesAdded: 8, linesRemoved: 1, action: 'modify' },
        { path: source, basename: 'order_book.cpp', linesAdded: 120, linesRemoved: 1, action: 'modify' },
      ],
      [{ command: 'bash test.sh', kind: 'test', ok: true, exitCode: 0 }],
      [],
      root,
    );

    assert.deepEqual(missing, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test('completion evidence: read-only user intent is not upgraded by agent no-change todos', () => {
  const inspectPrompt = [
    '只检查当前工作区是否存在 controlled-boundary.txt，并告诉我第一行内容。',
    '不要创建、修改或删除任何文件。',
  ].join('');
  const readOnlyTodos = [
    { title: '读取边界文件' },
    { title: '确认无文件改动' },
  ];

  assert.equal(requiresReadEvidence(inspectPrompt), true);
  assert.equal(requiresFileChangeEvidence(`${inspectPrompt}\n${readOnlyTodos.map(t => t.title).join('\n')}`), false);
  assert.deepEqual(
    getMissingCompletionEvidence(inspectPrompt, readOnlyTodos, [], [], ['controlled-boundary.txt']),
    [],
  );
  assert.deepEqual(
    getMissingCompletionEvidence(inspectPrompt, readOnlyTodos, [], [], []),
    ['文件内容读取结果'],
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

test('completion evidence: every requested read target needs its own evidence', () => {
  const inspectPrompt = '检查 a.txt 和 b.txt 是否存在，并显示文件内容，不要修改文件。';

  assert.deepEqual(
    getMissingCompletionEvidence(inspectPrompt, [], [], [], ['a.txt']),
    ['文件内容读取结果'],
  );
  assert.deepEqual(
    getMissingCompletionEvidence(inspectPrompt, [], [], [], ['a.txt', 'b.txt']),
    [],
  );
  assert.deepEqual(
    getMissingCompletionEvidence(
      inspectPrompt,
      [],
      [],
      [{ command: 'cat a.txt', kind: 'other', ok: true, exitCode: 0 }],
      [],
    ),
    ['文件内容读取结果'],
  );
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

test('completion evidence: g++ compile plus executable run is compile-run evidence', () => {
  const command = 'cd /tmp/devseek-live-standalone && g++ hello.cpp -o hello && ./hello';

  assert.equal(classifyTerminalEvidenceCommand(command), 'compile-run');
});

test('completion evidence: Python CLI pipeline counts as runtime evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-python-'));
  try {
    const target = path.join(root, 'tools', 'log_summary.py');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'import sys\nprint("ERROR=1 WARN=1")\n');
    const prompt = '我在真实项目里需要一个小 Python 命令行工具 tools/log_summary.py。要求从 stdin 读取日志，统计 ERROR/WARN 数量并输出 ERROR=1 WARN=1；请实现并自测。';
    const command = "printf 'INFO start\\nWARN slow\\nERROR fail\\n' | python tools/log_summary.py | grep -q 'ERROR=1 WARN=1'";
    const kind = classifyTerminalEvidenceCommand(command);

    assert.equal(kind, 'run');
    assert.deepEqual(
      getMissingCompletionEvidence(
        prompt,
        [],
        [{ path: target, basename: 'log_summary.py', linesAdded: 2, linesRemoved: 0, action: 'create' }],
        [{ command, kind, ok: true, exitCode: 0 }],
        [],
        root,
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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
    const fileCheckEvidence = [{
      command: "test -f 'docs/manual-phase5-smoke.md' && sed -n '1,80p' 'docs/manual-phase5-smoke.md'",
      kind: 'other',
      ok: true,
      exitCode: 0,
    }];

    assert.equal(requiresFileChangeEvidence(docsPrompt), true);
    assert.equal(requiresCodeArtifactForEvidence(docsPrompt), false);
    assert.deepEqual(
      getMissingCompletionEvidence(docsPrompt, [], [], []),
      ['文件修改结果', '文件读取/检查结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        docsPrompt,
        [],
        [{ path: file, basename: 'manual-phase5-smoke.md', linesAdded: 1, linesRemoved: 0, action: 'create' }],
        fileCheckEvidence,
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

test('completion evidence: non-code file artifact todos cannot upgrade readback verification into test evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-file-readback-'));
  try {
    const file = path.join(root, 'ui-r1a1b-clean2-4a148c.txt');
    writeFileSync(file, 'UI_R1A1B_CLEAN2_OK\n');
    const filePrompt = [
      'UI-R1A1B-CLEAN2-20260715-4a148c',
      '请在当前工作区创建 ui-r1a1b-clean2-4a148c.txt。',
      '文件内容必须精确包含一行 UI_R1A1B_CLEAN2_OK。',
      '完成写入和读回验证后结束任务，不要修改其他用户文件。',
    ].join(' ');
    const todos = [
      { title: '创建自然 UI 测试文件' },
      { title: '读回并验证精确内容' },
    ];
    const writeEvidence = [{ path: file, basename: 'ui-r1a1b-clean2-4a148c.txt', linesAdded: 1, linesRemoved: 0, action: 'create' }];
    const fileCheckEvidence = [{
      command: "test -f 'ui-r1a1b-clean2-4a148c.txt' && wc -c 'ui-r1a1b-clean2-4a148c.txt' && sed -n '1,80p' 'ui-r1a1b-clean2-4a148c.txt'",
      kind: 'other',
      ok: true,
      exitCode: 0,
    }];

    assert.equal(requiresFileCheckEvidence(filePrompt), true);
    assert.equal(requiresRuntimeValidation(filePrompt), false);
    assert.deepEqual(
      getMissingCompletionEvidence(filePrompt, todos, writeEvidence, [], [], root),
      ['文件读取/检查结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(filePrompt, todos, writeEvidence, fileCheckEvidence, [], root),
      [],
    );
    assert.equal(
      getBlockingTerminalFailure(filePrompt, todos, writeEvidence, fileCheckEvidence),
      undefined,
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

test('completion evidence: formal project Markdown must pass engineering quality gate', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-formal-doc-gate-'));
  try {
    const file = path.join(root, 'docs', '01-warranty-design.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, [
      '# 维保提醒设计',
      '',
      '## 概述',
      '',
      '参考 license 模块的通讯方式，新增遥控器和主控 JSON 交互。',
    ].join('\n'));
    const formalPrompt = [
      '参考 /repo/src/oam/src/license 模块的通讯方式。',
      '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 和接口文档，',
      '完成遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现和自闭环验证。',
    ].join('\n');

    assert.deepEqual(
      getMissingCompletionEvidence(
        formalPrompt,
        [{ title: '输出正式项目设计 Markdown 文档' }],
        [{ path: file, basename: '01-warranty-design.md', linesAdded: 5, linesRemoved: 0, action: 'create' }],
        [{ command: 'test -f docs/01-warranty-design.md', kind: 'other', ok: true, exitCode: 0 }],
        [],
        root,
      ),
      [
        '代码修改结果',
        '正式项目源项目事实矩阵',
        '正式项目协议/通讯数值事实',
        '遥控器/主控接口 schema、request/response 示例',
        '原有代码修改清单（文件、函数/类、风险、验证方式）',
        '项目级通讯链路证据（uart*_tx/rx_main、TunnelTransport/分片、MAVLink/topic）',
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: formal project Markdown quality can be satisfied across written docs', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-formal-doc-pass-'));
  try {
    const docsDir = path.join(root, 'docs');
    const srcDir = path.join(root, 'src');
    mkdirSync(docsDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    const design = path.join(docsDir, '01-warranty-design.md');
    const interfaceDoc = path.join(docsDir, '02-remote-interface.md');
    const codeFile = path.join(srcDir, 'warranty_manager.cpp');
    writeFileSync(design, [
      '# 维保提醒正式项目设计与实现说明',
      '',
      '## 源项目事实矩阵',
      '',
      '| 文件 | 事实 | 复用方式 |',
      '|------|------|----------|',
      '| `src/oam/src/license/license_types.hpp:8` | `kTopicLicenseTunnelRx="/uav/license/tunnel/rx"`，`kTopicLicenseTunnelTx="/uav/license/tunnel/tx"` | 维保通道复用 topic 命名和收发边界 |',
      '| `src/oam/src/license/license_types.hpp:11` | `kMavTunnelCmdLicense=33007` | 新维保 tunnel 需独立 payload_type 或明确复用规则 |',
      '| `src/oam/src/license/license_types.hpp:15` | `kTunnelVersion=1`，`kTunnelMaxTotalLen=64 * 1024`，`kTunnelSessionTimeoutMs=5000` | 维保分片版本、最大长度和超时策略按此对齐 |',
      '| `src/oam/src/license/license_tunnel_transport.cpp:304` | `LicenseTunnelHeader` 字段含 `sessionId/seq/total/payloadLen/totalLen/crc32` | 维保 JSON 按同一分片/CRC 模型验证 |',
      '| `src/oam/src/uart1_tx_main.cpp:35` | `HDStringPublisher` 通过 `/uav/dt/oam_msg/tx` 发送到遥控器链路 | 维保结果必须接入真实发送入口 |',
      '| `src/oam/src/uart1_rx_main.cpp:52` | `HDStringSubscriber` 接收遥控器/平台消息并按 topic 路由 | 维保平台状态从接收入口进入主控 |',
      '',
      '## 原有代码修改清单',
      '',
      '| 目标文件 | 函数/类 | 改动内容 | 原因 | 风险 | 验证方式 |',
      '|----------|---------|----------|------|------|----------|',
      '| `src/oam/src/lifting/lifting_manager.hpp:16` | `LiftingManager` | 增加 WarrantyManager 成员和 init 注入 | 接入主控生命周期 | 初始化顺序 | 单测 + 启动日志 |',
      '| `src/oam/src/lifting/pump_adjust_main.cpp:146` | `rc_maintenance_publisher` | 复用 `/uav/dt/oam_msg/tx` 发布器 | 遥控器通道统一 | topic 冲突 | 回归 topic 发布 |',
      '| `src/oam/src/lifting/pump_adjust_main.cpp:4329` | `init` | 调用维保模块 init | 接入调度 | 空指针风险 | 自检验证 |',
      '| `src/oam/src/lifting/zc_maintenance/warranty_manager.hpp` | `WarrantyManager` | 新增状态合并和复位 | 维保主逻辑 | 状态迁移 | 边界测试 |',
    ].join('\n'));
    writeFileSync(interfaceDoc, [
      '# 遥控器与主控接口文档',
      '',
      '| 方向 | 承载通道 | 消息类型 | request JSON schema 字段 | response JSON schema 字段 |',
      '|------|----------|----------|--------------------------|---------------------------|',
      '| 遥控器 -> 主控 | MAVLINK_MSG_TUNNEL, payload_type warranty | `platform_status` | `requestId`、`deviceSn`、`statisticsCutoffAt`、`metrics.flightSorties`、`thresholds.expiringSoonDays` | `accepted`、`errorCode` |',
      '| 主控 -> 遥控器 | topic `/uav/dt/oam_msg/tx` | `warranty_status` | `requestId` | `status`、`level`、`triggerReason`、`nextCheckAtMs`、`version` |',
      '',
      '### request JSON 示例',
      '',
      '```json',
      '{"type":"platform_status","requestId":"r1","metrics":{"flightSorties":120},"version":1}',
      '```',
      '',
      '### response JSON 示例',
      '',
      '```json',
      '{"type":"warranty_status","requestId":"r1","level":"expiring_soon","errorCode":0,"version":1}',
      '```',
      '超时 5000ms 后重试，幂等键使用 requestId + sessionId，错误码包括 payload_invalid、crc_mismatch、timeout，版本字段用于兼容演进。',
    ].join('\n'));
    writeFileSync(codeFile, 'int warranty_manager_validation_anchor() { return 0; }\n');
    const formalPrompt = [
      '参考 /repo/src/oam/src/license 模块的通讯方式。',
      '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 和接口文档，',
      '完成遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现和自闭环验证。',
    ].join('\n');

    assert.deepEqual(
      getMissingCompletionEvidence(
        formalPrompt,
        [{ title: '输出正式项目设计 Markdown 文档' }],
        [
          { path: design, basename: '01-warranty-design.md', linesAdded: 20, linesRemoved: 0, action: 'create' },
          { path: interfaceDoc, basename: '02-remote-interface.md', linesAdded: 10, linesRemoved: 0, action: 'create' },
          { path: codeFile, basename: 'warranty_manager.cpp', linesAdded: 1, linesRemoved: 0, action: 'create' },
        ],
        [{ command: 'npm run build', kind: 'compile', ok: true, exitCode: 0 }],
        [],
        root,
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

test('completion evidence: read-only file summaries are not write claims', () => {
  const summary = '已读取 controlled-boundary.txt，第一行是 CONTROLLED_BOUNDARY_PRESENT，未修改任何文件。';

  assert.deepEqual(extractClaimedSummaryFiles(summary), []);
  assert.deepEqual(getUnsupportedSummaryFileClaims(summary, [], '/workspace'), []);
});

test('completion evidence: based-on source files are not treated as written deliverables', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-source-refs-'));
  try {
    const report = path.join(root, 'docs', 'r3-iteration', 'r3-live-deepseek-login-ready-state.md');
    mkdirSync(path.dirname(report), { recursive: true });
    writeFileSync(report, '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告\n');
    const summary = [
      '完成 R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告生成。',
      `创建的文件：\`${report}\` (265 行)。`,
      '根据用户提供的 deepseek-login-ready-state-matrix.md 和 deepseek-login-ready-state-contract.ts 两个源文件，生成可审计的 Markdown 报告。',
    ].join('\n');
    const writtenFiles = [{
      path: report,
      basename: 'r3-live-deepseek-login-ready-state.md',
      linesAdded: 265,
      linesRemoved: 0,
      action: 'create',
    }];

    assert.deepEqual(extractClaimedSummaryFiles(summary), [report]);
    assert.deepEqual(getUnsupportedSummaryFileClaims(summary, writtenFiles, root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: based-on source phrase still requires evidence for named output files', () => {
  const summary = '已完成：基于 deepseek-login-ready-state-contract.ts 生成 r3-live-deepseek-login-ready-state.md。';

  assert.deepEqual(
    extractClaimedSummaryFiles(summary),
    ['r3-live-deepseek-login-ready-state.md'],
  );
  assert.deepEqual(
    getUnsupportedSummaryFileClaims(summary, [], '/workspace'),
    ['r3-live-deepseek-login-ready-state.md'],
  );
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

test('completion evidence: standalone C++ stdout task requires runtime evidence after writing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-cpp-stdout-'));
  try {
    const file = path.join(root, 'hello.cpp');
    writeFileSync(file, '#include <iostream>\nint main(){ std::cout << "下午好\\n"; }\n');
    const cppPrompt = '编写一个 C++ 程序，打印下午好';
    const written = [{ path: file, basename: 'hello.cpp', linesAdded: 2, linesRemoved: 0, action: 'create' }];

    assert.equal(requiresCodeArtifactForEvidence(cppPrompt), true);
    assert.equal(requiresCommandEvidence(cppPrompt), true);
    assert.equal(requiresRuntimeValidation(cppPrompt), true);
    assert.deepEqual(
      getMissingCompletionEvidence(cppPrompt, [], written, [], [], root),
      ['成功的程序运行结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        cppPrompt,
        [],
        written,
        [{ command: `g++ ${file} -o ${path.join(root, 'hello')}`, kind: 'compile', ok: true, exitCode: 0 }],
        [],
        root,
      ),
      ['成功的程序运行结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        cppPrompt,
        [],
        written,
        [{
          command: `g++ ${file} -o ${path.join(root, 'hello')} && ${path.join(root, 'hello')}`,
          kind: 'compile-run',
          ok: true,
          exitCode: 0,
        }],
        [],
        root,
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: explicit test intent requires test or runtime result', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-test-intent-'));
  try {
    const file = path.join(root, 'code', 'shape_manager', 'main.cpp');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'int main(){return 0;}\n');
    const testPrompt = '请修改 code/shape_manager/main.cpp，然后编译和测试，看结果';
    const written = [{ path: file, basename: 'main.cpp', linesAdded: 1, linesRemoved: 1, action: 'modify' }];

    assert.equal(requiresCommandEvidence(testPrompt), true);
    assert.equal(requiresRuntimeValidation(testPrompt), true);
    assert.deepEqual(
      getMissingCompletionEvidence(testPrompt, [], written, [], [], root),
      ['成功的测试/运行结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        testPrompt,
        [],
        written,
        [{ command: 'cmake --build build', kind: 'compile', ok: true, exitCode: 0 }],
        [],
        root,
      ),
      ['成功的测试/运行结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        testPrompt,
        [],
        written,
        [{ command: 'ctest --test-dir build', kind: 'test', ok: true, exitCode: 0 }],
        [],
        root,
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: negative run constraints do not become runtime-validation requirements', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-negative-run-'));
  try {
    const file = path.join(root, '.devseek-close02-probe', 'CLOSE02-20260713-manual-probe', 'probe.js');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'function close02Add(a, b) { return a + b; }\nconsole.log("CLOSE02-20260713-manual-probe: 2+3=5");\n');
    const probePrompt = [
      '创建 .devseek-close02-probe/CLOSE02-20260713-manual-probe/probe.js 文件。',
      '最后一行打印：CLOSE02-20260713-manual-probe: 2+3=5。',
      '不运行网络，不安装依赖，不修改 git。',
    ].join(' ');
    const written = [{ path: file, basename: 'probe.js', linesAdded: 2, linesRemoved: 0, action: 'create' }];

    assert.equal(requiresCommandEvidence(probePrompt), false);
    assert.equal(requiresRuntimeValidation(probePrompt), false);
    assert.deepEqual(
      getMissingCompletionEvidence(probePrompt, [], written, [], [], root),
      ['成功的编译/测试/语法验证命令结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        probePrompt,
        [],
        written,
        [{ command: `node --check ${file}`, kind: 'other', ok: true, exitCode: 0 }],
        [],
        root,
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
