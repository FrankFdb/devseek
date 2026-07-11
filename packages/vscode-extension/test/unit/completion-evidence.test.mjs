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

    assert.deepEqual(
      getMissingCompletionEvidence(deliverablePrompt, [], alternativeEvidence, [], [], root),
      [`指定交付文件：${required}`],
    );

    const requiredEvidence = [{ path: required, basename: 'result.txt', linesAdded: 1, linesRemoved: 0, action: 'modify' }];
    assert.deepEqual(
      getMissingCompletionEvidence(deliverablePrompt, [], requiredEvidence, [], [], root),
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
