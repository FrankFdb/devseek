/**
 * Regression tests for Markdown document deliverables.
 *
 * Claude Code/Codex-style contract: file evidence is collected locally and the
 * runtime owns the write/verify step. A corrupted provider turn must not leave a
 * requested Markdown deliverable without an artifact.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/markdown-deliverable-task.bundle.cjs');

execSync(
  `npx esbuild src/agent/markdown-deliverable-task.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { tryExecuteMarkdownDeliverableTask } = req(bundlePath);

const ALLOW_FILE_WRITE = Object.freeze({
  decision: 'allow',
  reason: 'test-file-write-allowed',
  evidenceRefs: Object.freeze(['test:file-write-allowed']),
});
const DENY_FILE_WRITE = Object.freeze({
  decision: 'deny',
  reason: 'test-file-write-denied',
  evidenceRefs: Object.freeze(['test:file-write-denied']),
});

function makeCallbacks() {
  const statuses = [];
  const changes = [];
  const activities = [];
  return {
    statuses,
    changes,
    activities,
    callbacks: {
      onDelta() {},
      onWorkflowStatus() {},
      onAgentStatus(status) { statuses.push(status); },
      onAppliedChange(change) { changes.push(change); },
      onResponseMeta() {},
      onToolActivity(kind, label) { activities.push({ kind, label }); },
      onResolveFileWriteConstraint: async () => ALLOW_FILE_WRITE,
    },
  };
}

function createMaintenanceWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-deliverable-'));
  const maintenanceDir = path.join(root, 'src/oam/src/lifting/maintenance');
  const licenseDir = path.join(root, 'src/oam/src/license');
  const oamSrcDir = path.join(root, 'src/oam/src');
  const docsDir = path.join(root, 'src/oam/src/lifting/zc_maintenance/docs');
  mkdirSync(maintenanceDir, { recursive: true });
  mkdirSync(licenseDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  const requirementDoc = path.join(docsDir, 'uav-warranty-reminder-plan_v1.7.md');
  writeFileSync(requirementDoc, [
    '# UAV 维保提醒需求',
    '',
    '- 新增作业次数、飞行时长和阈值状态字段。',
    '- 扩展 JSON 持久化字段并兼容旧版本。',
    '- 通过 UAV_EVENT 1022 通知主控维保提醒。',
    '- 增加复位逻辑，支持多维度状态合并。',
  ].join('\n'));
  writeFileSync(path.join(maintenanceDir, 'maintenance_types.hpp'), [
    'struct MaintenanceStat {',
    '  int operation_count;',
    '  double flight_hours;',
    '};',
  ].join('\n'));
  writeFileSync(path.join(maintenanceDir, 'maintenance_state_machine.hpp'), [
    'class MaintenanceStateMachine {',
    ' public:',
    '  bool updateState(const MaintenanceStat& stat);',
    '};',
  ].join('\n'));
  writeFileSync(path.join(licenseDir, 'license_tunnel_transport.hpp'), [
    '#pragma once',
    'constexpr uint16_t kMavTunnelCmdLicense = 33007;',
    'constexpr uint32_t kTunnelMaxTotalLen = 64 * 1024;',
    'constexpr uint32_t kTunnelSessionTimeoutMs = 5000;',
    'struct LicenseTunnelHeader { uint32_t sessionId; uint16_t seq; uint16_t total; uint16_t payloadLen; uint32_t totalLen; uint32_t crc32; };',
    'class TunnelTransport { public: bool appendFragment(const LicenseTunnelHeader& header); };',
  ].join('\n'));
  writeFileSync(path.join(oamSrcDir, 'uart1_tx_main.cpp'), [
    '#include "license/license_tunnel_transport.hpp"',
    'static const char* kTopicLicenseTunnelTx = "/uav/license/tunnel/tx";',
    'static const char* kOamTxTopic = "/uav/dt/oam_msg/tx";',
    'void uart1_tx_main() { HDStringPublisher publisher(kOamTxTopic); publisher.publish(kTopicLicenseTunnelTx); }',
  ].join('\n'));
  writeFileSync(path.join(oamSrcDir, 'uart1_rx_main.cpp'), [
    '#include "license/license_tunnel_transport.hpp"',
    'static const char* kTopicLicenseTunnelRx = "/uav/license/tunnel/rx";',
    'void uart1_rx_main() { HDStringSubscriber subscriber(kTopicLicenseTunnelRx); route(payload_type); }',
  ].join('\n'));
  return { root, maintenanceDir, licenseDir, docsDir, requirementDoc };
}

function createLicenseFactWorkspace() {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-license-grounding-'));
  const source = path.join(root, 'src/oam/src/license/license_types.hpp');
  const target = path.join(root, 'docs/license-transport-facts.md');
  mkdirSync(path.dirname(source), { recursive: true });
  mkdirSync(path.dirname(target), { recursive: true });
  const fixtureDir = path.join(rootDir, 'test/fixtures/runtime-replay/20260711-131537');
  const sourceContent = readFileSync(path.join(fixtureDir, 'license_types.hpp'), 'utf8');
  const wrong = readFileSync(path.join(fixtureDir, 'license-transport-facts.wrong.md'), 'utf8')
    .replace('/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp', source);
  const repaired = wrong
    .replace('# License 模块传输常量事实记录', '# 源码事实报告')
    .replace(/\n\n\*\*源码路径\*\*: `([^\n`]+)`\n\n/, '\n源码路径：$1\n')
    .replace('/uav/dt/license/state', '/uav/license/state')
    .replace('/uav/dt/license/tunnel/rx', '/uav/license/tunnel/rx')
    .replace('`300`', '`33007`')
    .replace('`81920`', '`64 * 1024`')
    .replace('`30000`', '`5000`')
    .replace('\n```\nprint("\\nready")', '\n```python\nprint("\\nready")')
    .replace(/^(\|\s*[^|\n]+\|\s*[^|\n]+\|)\s*[^|\n]+\|$/gm, '$1');
  writeFileSync(source, sourceContent);
  const prompt = `请读取 ${source}，从源码提取 kTopicLicenseState、kTopicLicenseTunnelRx、kMavTunnelCmdLicense、kTunnelVersion、kTunnelMaxTotalLen、kTunnelSessionTimeoutMs 六个常量的真实定义和值。请创建 Markdown 报告 ${target}，包含标题、源码路径和六个常量的表格，并加入 Python 代码块，代码内容必须是 print("\\nready")。写入后重新读取该报告，确认内容完整。不要修改任何源码，不要创建其他文件。`;
  return { root, source, target, wrong, repaired, prompt };
}

function addCommunicationEvidencePressure(workspace) {
  const licenseDir = path.dirname(workspace.source);
  for (let index = 0; index < 10; index += 1) {
    const name = `license_${String(index).padStart(2, '0')}.cpp`;
    const prefix = `// supplemental communication evidence ${index}\n`;
    writeFileSync(path.join(licenseDir, name), prefix.padEnd(6_200, 'x'));
  }
}

function createLiveEvidenceStarvationReplay() {
  const workspace = createLicenseFactWorkspace();
  const fixtureDir = path.join(rootDir, 'test/fixtures/runtime-replay/20260711-165205');
  const prompt = readFileSync(path.join(fixtureDir, 'request.txt'), 'utf8').trimEnd()
    .replaceAll('{{SOURCE}}', workspace.source)
    .replaceAll('{{TARGET}}', workspace.target);
  const wrong = readFileSync(path.join(fixtureDir, 'provider-response.wrong.md'), 'utf8').trimEnd()
    .replaceAll('{{SOURCE}}', workspace.source);
  const repaired = [
    '# 源码事实报告',
    `源码路径：${workspace.source}`,
    '| Symbol | Value |',
    '| --- | --- |',
    '| kTopicLicenseState | /uav/license/state |',
    '| kTopicLicenseTunnelRx | /uav/license/tunnel/rx |',
    '| kMavTunnelCmdLicense | 33007 |',
    '| kTunnelVersion | 1 |',
    '| kTunnelMaxTotalLen | 64 * 1024 |',
    '| kTunnelSessionTimeoutMs | 5000 |',
    '```python',
    'print("\\nready")',
    '```',
    '',
  ].join('\n');
  addCommunicationEvidencePressure(workspace);
  return { ...workspace, prompt, wrong, repaired };
}

test('markdown deliverable fixture: 20260711-165205 prompt and provider response preserve the live payload hashes', () => {
  const fixtureDir = path.join(rootDir, 'test/fixtures/runtime-replay/20260711-165205');
  const metadata = JSON.parse(readFileSync(path.join(fixtureDir, 'fixture.json'), 'utf8'));
  const source = '/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp';
  const target = '/home/ff/uav/tars/huida_uav/src/oam/src/lifting/zc_maintenance/p0a-canary-20260711-165123/docs/license-transport-facts.md';
  const prompt = readFileSync(path.join(fixtureDir, 'request.txt'), 'utf8').trimEnd()
    .replaceAll('{{SOURCE}}', source)
    .replaceAll('{{TARGET}}', target);
  const response = readFileSync(path.join(fixtureDir, 'provider-response.wrong.md'), 'utf8').trimEnd()
    .replaceAll('{{SOURCE}}', source);
  const sha256 = value => createHash('sha256').update(value).digest('hex');

  assert.equal(prompt.length, metadata.originalPromptLength);
  assert.equal(sha256(prompt), metadata.originalPromptSha256);
  assert.equal(response.length, metadata.providerResponseLength);
  assert.equal(sha256(response), metadata.providerResponseSha256);
});

test('markdown deliverable: corrupted provider output still writes verified local artifact', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  let providerPrompt = '';
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir} 下面的旧实现，通过md文档提供建议`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async (messages) => {
        providerPrompt = messages[0].content;
        return [
          '我看到文件路径不对，让我用工具搜索。',
          '[TOOL:file_search {"glob":"maintenance_*.hpp","path":"/missing"}]',
          '[工具执行结果][file_search:/missing]找到 0 个文件',
        ].join('\n');
      },
    });

    assert.equal(result?.applied, true, result?.failedReason || result?.feedback || 'missing result');
    assert.equal(result?.taskComplete, true);
    assert.equal(existsSync(target), true);
    const content = readFileSync(target, 'utf8');
    assert.match(content, /# 维保提醒需求分析与实现建议/);
    assert.match(content, /Provider 未返回可用的完整报告/);
    assert.match(content, /maintenance_types\.hpp/);
    assert.match(content, /UAV_EVENT 1022/);
    assert.match(providerPrompt, /本文档交付目标/);
    assert.match(providerPrompt, /创建 Markdown 建议文档/);
    assert.match(providerPrompt, /maintenance_state_machine\.hpp/);
    assert.deepEqual(io.changes.map(change => change.path), [
      'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
    ]);
    assert.equal(io.activities.some(item => item.kind === 'read'), true);
    assert.equal(io.activities.some(item => item.kind === 'write'), true);
    assert.equal(io.statuses.at(-1).state, 'started');
    assert.equal(io.statuses.some(status => status.state === 'completed'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: complete provider report is written instead of fallback', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  try {
    const providerMarkdown = [
      '# 维保提醒实现建议',
      '',
      '## 结论',
      '',
      '需求要求围绕维保状态、阈值、持久化、主控事件和复位流程形成闭环。',
      '',
      '## 建议',
      '',
      '- 保持数据采集、阈值判断、状态机、持久化和发布器职责分离。',
      '- 主控只消费事件和快照，不重复计算阈值。',
      '- 为旧版本 JSON 增加默认值和版本迁移。',
      '- 使用 UAV_EVENT 1022 作为提醒事件，并加入重复触发抑制。',
      '- 增加单元测试、重启恢复测试和复位流程测试。',
      '',
      '## 风险',
      '',
      '如果主控绕过状态机直接读取临时字段，会导致状态结算和提醒事件不一致，需要通过接口边界约束。',
    ].join('\n');

    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir} 下面的旧实现，通过md文档提供建议`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => providerMarkdown,
    });

    assert.equal(result?.applied, true);
    const content = readFileSync(target, 'utf8');
    assert.match(content, /# 维保提醒实现建议/);
    assert.doesNotMatch(content, /Provider 未返回可用/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: formal communication references collect project-wide UART and tunnel evidence', async () => {
  const { root, licenseDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-remote-controller-interface-design.md');
  const io = makeCallbacks();
  let providerPrompt = '';
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-remote-controller-interface-design.md',
        absPath: target,
        action: 'create',
        desc: '创建遥控器与主控交互接口 Markdown 文档，参考 license 通讯方式并写明源项目事实矩阵和通信链路',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: [
        `参考 ${licenseDir} 模块通讯方式`,
        `基于 ${requirementDoc} 完成遥控器和主控交互接口设计，通过 md 文档提供`,
      ].join('\n'),
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async (messages) => {
        providerPrompt = messages[0].content;
        return '我还需要调用工具继续查找。<TOOL_file_search>{"glob":"**/*.cpp"}';
      },
    });

    assert.equal(result?.applied, true, result?.failedReason || result?.feedback || 'missing result');
    const content = readFileSync(target, 'utf8');
    assert.match(content, /uart1_tx_main\.cpp/);
    assert.match(content, /uart1_rx_main\.cpp/);
    assert.match(content, /TunnelTransport|kMavTunnelCmdLicense|kTunnelMaxTotalLen/);
    assert.match(content, /HDStringPublisher|HDStringSubscriber|payload_type/);
    assert.match(providerPrompt, /uart1_tx_main\.cpp/);
    assert.match(providerPrompt, /项目级真实通讯链路/);
    assert.equal(io.statuses.at(-1).state, 'started');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: cleans flattened DeepSeek web markdown before writing', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, '01-warranty-remote-controller-interface-design.md');
  const io = makeCallbacks();
  try {
    const providerMarkdown = [
      '无人机维保提醒功能 —— 遥控器与主控交互接口设计文档**文档编号**: ZC-MAINTENANCE-IFACE-001**文档版本**: 1.0**生成时间**: 2026-07-09**文档路径**: src/oam/src/lifting/zc_maintenance/docs/01-warranty-remote-controller-interface-design.md**关联需求**: uav-warranty-reminder-plan_v1.7.md**关联旧实现**: lifting_maintenance_design.md**文档类型**: 接口设计**状态**: 待评审**对应需求版本**: UAV-WARRANTY-REMINDER-PLAN-V1.7**目标路径**: src/oam/src/lifting/zc_maintenance/docs/01-warranty-remote-controller-interface-design.md### 1.1 文档目标本文档定义遥控器与主控之间关于无人机维保提醒功能的交互接口，包括平台 JSON 数据转发、主控统计结果回传、字段定义、时序关系、异常处理和容错机制。2. 需求差异分析基于需求文档与平台接口文档的对比，识别数据流向、统计结果回传、离线补偿和状态同步差异。| 状态说明 | 旧实现二元状态：统计中 / 待维保 | 新需求三元状态：normal / expiring_soon / expired |3. 旧实现职责观察通信架构：text复制下载遥控器 App <--- MAVLink Tunnel ---> 主控。4. 源项目事实矩阵| 源文件 | 原项目事实 | 复用方式 || src/oam/src/license/license_types.hpp:8 | kTopicLicenseTunnelRx="/uav/license/tunnel/rx"，kTopicLicenseTunnelTx="/uav/license/tunnel/tx" | 维保通道复用 topic 命名边界 || src/oam/src/license/license_types.hpp:11 | kMavTunnelCmdLicense=33007，kTunnelVersion=1 | 新维保 tunnel 需要独立 payload_type 或明确复用规则 || src/oam/src/license/license_types.hpp:15 | kTunnelMaxTotalLen=64 * 1024，kTunnelSessionTimeoutMs=5000 | 分片最大长度和超时对齐 || src/oam/src/license/license_tunnel_transport.cpp:12 | kDuplicateRequestDropWindowMs=1000，kMaxActiveSessions=128，kMaxCompletedRequests=256 | 重复请求和会话上限对齐 || src/oam/src/license/license_tunnel_transport.cpp:304 | LicenseTunnelHeader 字段包含 sessionId、seq、total、payloadLen、totalLen、crc32 | 遥控器消息按相同分片和 CRC 规则校验 || src/oam/src/uart1_tx_main.cpp:35 | HDStringPublisher 通过 /uav/dt/oam_msg/tx 发送主控 JSON，topic 路由到遥控器 | 维保结果必须接入真实发送入口而不是目录内自洽 || src/oam/src/uart1_rx_main.cpp:52 | HDStringSubscriber 接收遥控器/平台转发消息，按 payload_type 和 topic 路由给业务模块 | 平台状态同步从真实接收入口进入主控 |5. 实现对策遥控器作为纯转发通道，主控接收平台 JSON 后结合本机增量数据完成计算。6. 主控任务拆分T001 接收平台 JSON，T002 解析字段，T003 管理本地增量，T004 计算维保状态，T005 通过 UAV_EVENT 1022 回传结果。7. 接口协议定义7.1 方向：遥控器到主控7.2 数据结构json复制下载{"type":"warranty_result","status":"expired"}7.3 消息容量需容纳 metrics（3 字段）+ thresholds（6 字段）+ 时间戳。7.4 示例 request：{"type":"platform_status","requestId":"r1","metrics":{"flightSorties":120},"version":1}。示例 response：{"type":"warranty_status","requestId":"r1","level":"expiring_soon","errorCode":0,"version":1}。超时 5000ms 后重试，幂等键使用 requestId + sessionId，错误码包含 payload_invalid、crc_mismatch、timeout。8. 风险与验证建议需要验证 JSON 解析失败、平台数据缺失、重复消息、重启恢复和阈值边界。9. 后续任务清单实现 Tunnel 传输、状态机、持久化、发布器和自动化测试。',
    ].join('\n');

    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/01-warranty-remote-controller-interface-design.md',
        absPath: target,
        action: 'create',
        desc: '编写遥控器与主控交互接口设计 Markdown 文档，覆盖平台 JSON 转发、主控统计结果回传、字段协议、时序和异常处理，并给出文档编号',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir}，分别做成md文档`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => providerMarkdown,
    });

    assert.equal(result?.applied, true);
    const content = readFileSync(target, 'utf8');
    const lines = content.split(/\r?\n/);
    assert.match(content, /^# 无人机维保提醒功能 —— 遥控器与主控交互接口设计文档/m);
    assert.match(content, /- \*\*文档编号\*\*：ZC-MAINTENANCE-IFACE-001/);
    assert.match(content, /- \*\*生成时间\*\*：2026-07-09/);
    assert.match(content, /- \*\*文档路径\*\*：src\/oam\/src\/lifting\/zc_maintenance\/docs\/01-warranty-remote-controller-interface-design\.md/);
    assert.match(content, /- \*\*关联需求\*\*：uav-warranty-reminder-plan_v1\.7\.md/);
    assert.match(content, /- \*\*关联旧实现\*\*：lifting_maintenance_design\.md/);
    assert.match(content, /- \*\*对应需求版本\*\*：UAV-WARRANTY-REMINDER-PLAN-V1\.7/);
    assert.doesNotMatch(content, /## 09/);
    assert.doesNotMatch(content, /^\s*#{1,6}\s*$/m);
    assert.doesNotMatch(content, /^## 3 字段/m);
    assert.doesNotMatch(content, /^## 6 字段/m);
    assert.match(content, /### 1\.1 文档目标/);
    assert.doesNotMatch(content, /###\s+\n\n1\.1/);
    assert.match(content, /旧实现二元状态：统计中 \/ 待维保/);
    assert.doesNotMatch(content, /旧实现二元\n- \*\*状态\*\*/);
    assert.match(content, /UAV_EVENT 1022/);
    assert.doesNotMatch(content, /复制下载/);
    assert.ok(lines[0].length < 120, 'first line should be readable markdown title');
    assert.ok(Math.max(...lines.map(line => line.length)) < 900, 'web-flattened markdown should be split into readable lines');
    assert.doesNotMatch(content, /Provider 未返回可用/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: accepts complete but fully flattened DeepSeek report', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  try {
    const longFlattenedParagraph = Array.from({ length: 34 }, (_, index) => (
      `第${index + 1}项对比说明旧实现由主控本地计算并持久化，新需求以平台状态为权威来源，主控同步平台快照并补偿离线增量，需要明确遥控器、主控、平台之间的职责边界和异常恢复策略`
    )).join('，');
    const providerMarkdown = [
      `维保提醒需求分析与实现建议文档版本：1.0生成日期：2026-07-09目标路径：src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md对应需求版本：uav-warranty-reminder-plan_v1.7.md目录1. - 需求差异分析2. - 旧实现职责观察3. - 实现对策建议1. 需求差异分析${longFlattenedParagraph}2. 旧实现职责观察MaintenanceDataCollector 可以复用本机增量采集，MaintenancePersistence 可以复用 JSON 原子写入，MaintenanceThresholdEngine 和 MaintenanceStateMachine 需要按平台状态重构。3. 实现对策建议主控不再独立判定平台权威状态，而是保存 platform_status、statisticsCutoffAt、metrics、thresholds，并通过离线补偿计算本机未同步增量。4. 主控任务拆分T001 定义同步消息结构，T002 保存平台快照，T003 采集离线补偿，T004 合并状态，T005 通过 UAV_EVENT 1022 回传提醒结果。5. 风险与验证建议需要验证平台数据缺失、重复消息、时区偏移、重启恢复、阈值边界和维保码成功后的状态清理。`,
    ].join('\n');

    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir} 下面的旧实现，通过md文档提供建议`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => providerMarkdown,
    });

    assert.equal(result?.applied, true);
    const content = readFileSync(target, 'utf8');
    assert.doesNotMatch(content, /Provider 未返回可用/);
    assert.match(content, /^# 维保提醒需求分析与实现建议/m);
    assert.match(content, /- \*\*生成日期\*\*：2026-07-09/);
    assert.match(content, /^1\. 需求差异分析$/m);
    assert.doesNotMatch(content, /## 1\. - 需求差异分析/);
    assert.match(content, /## 1\. 需求差异分析/);
    assert.ok(Math.max(...content.split(/\r?\n/).map(line => line.length)) < 900);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: restores glued metadata and Chinese section headings from DeepSeek web text', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  try {
    const providerMarkdown = [
      '无人机维保提醒功能重构建议文档文档版本：1.0创建日期：2026-07-10文档类型：实现对策与主控任务拆分目标路径：src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md一、需求差异分析1.1 核心设计理念差异维度旧实现（lifting/maintenance）新需求（zc_maintenance）数据权威主控本机计算，共享内存存储平台为权威来源状态判定主控基于本机累计数据判定平台计算状态，遥控器和无人机同步触发。1.2 阈值参数差异首次周期与维保后周期阈值不同，需要保留平台状态作为权威输入。二、旧实现职责观察2.1 旧实现设计优点MaintenanceManager 聚合采集、阈值计算、状态机、持久化、推送、重置处理，符合单一职责原则。2.2 旧实现不适用于新需求的原因数据源权威反转，主控从计算者变为同步者。三、实现对策3.1 整体架构建议在 zc_maintenance 目录下新建实现，但必须接入主控调度、MAVLink 协议、平台消息和现有持久化边界。四、主控任务拆分T001 定义平台状态结构，T002 增加同步入口，T003 维护离线补偿，T004 发布 UAV_EVENT 1022，T005 增加单元测试和重启恢复测试。',
    ].join('\n');

    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir} 下面的旧实现，通过md文档提供建议`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => providerMarkdown,
    });

    assert.equal(result?.applied, true);
    const content = readFileSync(target, 'utf8');
    const lines = content.split(/\r?\n/);
    assert.doesNotMatch(content, /Provider 未返回可用/);
    assert.match(content, /^# 无人机维保提醒功能重构建议文档/m);
    assert.match(content, /- \*\*文档版本\*\*：1\.0/);
    assert.match(content, /- \*\*创建日期\*\*：2026-07-10/);
    assert.match(content, /- \*\*文档类型\*\*：实现对策与主控任务拆分/);
    assert.match(content, /- \*\*目标路径\*\*：src\/oam\/src\/lifting\/zc_maintenance\/docs\/warranty-maintenance-advice\.md/);
    assert.match(content, /^## 一、需求差异分析$/m);
    assert.match(content, /^### 1\.1 核心设计理念差异/m);
    assert.match(content, /^## 二、旧实现职责观察$/m);
    assert.match(content, /^## 三、实现对策$/m);
    assert.match(content, /^## 四、主控任务拆分/m);
    assert.equal(lines.some(line => (line.match(/文档版本|创建日期|文档类型|目标路径/g) || []).length >= 2), false);
    assert.equal(lines.some(line => /^[一二三四五六七八九十]{1,3}[、.．]\s*\S/.test(line.trim())), false);
    assert.ok(Math.max(...lines.map(line => line.length)) < 900);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: user-visible states explain provider wait and file verification', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  let notifyChatEntered;
  const chatEntered = new Promise(resolve => {
    notifyChatEntered = resolve;
  });
  const providerMarkdown = [
    '# 维保提醒实现建议',
    '',
    '## 需求差异',
    '',
    '新需求把原本单一吊运维保扩展为作业次数、飞行时长、阈值状态、事件通知、持久化和复位的完整闭环。',
    '',
    '## 旧实现职责观察',
    '',
    '旧实现已经拆分了数据采集、阈值判断、状态机、持久化、发布器和复位处理器，适合作为新能力的边界基础。',
    '',
    '## 实现对策',
    '',
    '- 在类型层扩展统计字段和阈值状态，不让主控重复计算。',
    '- 在状态机中统一合并多维度阈值和抑制重复通知。',
    '- 在持久化层做版本迁移和默认值填充。',
    '- 在发布器中通过 UAV_EVENT 1022 输出主控可消费事件。',
    '- 为复位、重启恢复和边界阈值增加自动化验证。',
  ].join('\n');
  let resolveProvider;
  try {
    const resultPromise = tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir} 下面的旧实现，通过md文档提供建议`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => {
        notifyChatEntered();
        return new Promise(resolve => {
          resolveProvider = resolve;
        });
      },
    });

    await chatEntered;
    assert.equal(io.statuses.some(status => status.title === '请求 DeepSeek 生成 Markdown 报告'), true);
    assert.match(io.statuses.at(-1).detail, /正在等待 DeepSeek 返回完整 Markdown 正文/);
    assert.equal(io.activities.some(item => item.kind === 'web'), true);

    resolveProvider(providerMarkdown);
    const result = await resultPromise;
    assert.equal(result?.applied, true);
    const titles = io.statuses.map(status => status.title);
    assert.deepEqual(titles.filter(title => [
      '收集 Markdown 交付证据',
      '请求 DeepSeek 生成 Markdown 报告',
      'DeepSeek 报告已返回',
      '准备写入 Markdown 文档',
      '提交已验证的 Markdown 候选',
      'Markdown 文档已通过执行器验证，等待中央结算',
    ].includes(title)), [
      '收集 Markdown 交付证据',
      '请求 DeepSeek 生成 Markdown 报告',
      'DeepSeek 报告已返回',
      '准备写入 Markdown 文档',
      '提交已验证的 Markdown 候选',
      'Markdown 文档已通过执行器验证，等待中央结算',
    ]);
    assert.match(io.statuses.find(status => status.title === 'DeepSeek 报告已返回').detail, /DeepSeek 返回 \d+ 字符/);
    assert.match(io.statuses.at(-1).detail, /写前验证、唯一写入、读回/);
    assert.equal(io.statuses.at(-1).state, 'started');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: fallback body follows the requested document objective', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, '01-warranty-remote-controller-interface-design.md');
  const io = makeCallbacks();
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/01-warranty-remote-controller-interface-design.md',
        absPath: target,
        action: 'create',
        desc: '编写遥控器与主控交互接口设计 Markdown 文档，覆盖平台 JSON 转发、主控统计结果回传、字段协议、时序和异常处理，并给出文档编号',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `请分析 ${requirementDoc} 和 ${maintenanceDir}，分别做成md文档`,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => '[TOOL:read_file {"path":"/tmp/missing"}]',
    });

    assert.equal(result?.applied, true);
    const content = readFileSync(target, 'utf8');
    assert.match(content, /# 01 遥控器与主控交互接口设计/);
    assert.match(content, /遥控器职责/);
    assert.match(content, /主控输出/);
    assert.match(content, /本文档目标/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: structured task intent wins over stale continuation rules', async () => {
  const { root, maintenanceDir, docsDir, requirementDoc } = createMaintenanceWorkspace();
  const target = path.join(docsDir, 'warranty-maintenance-advice.md');
  const io = makeCallbacks();
  try {
    const userPrompt = [
      `当前用户消息：请分析 ${requirementDoc} 和 ${maintenanceDir}，通过md文档提供建议`,
      '上一轮 Agent 状态：',
      '- 旧规则：不要创建任何 Markdown 文档。',
      '- 旧摘要：任务未完成。',
    ].join('\n');

    const result = await tryExecuteMarkdownDeliverableTask({
      task: {
        id: 't1',
        file: 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md',
        absPath: target,
        action: 'create',
        desc: '创建 Markdown 建议文档，先分析需求文档、旧实现和主控职责，再写入完整的新旧需求对比、实现对策和主控任务清单，并返回文档路径',
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => {
        throw new Error('bridge input unavailable');
      },
    });

    assert.equal(result?.applied, true);
    assert.equal(existsSync(target), true);
    assert.match(readFileSync(target, 'utf8'), /Provider 未返回可用的完整报告/);
    assert.equal(io.statuses.at(-1).state, 'started');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: 20260711-131537 wrong facts trigger one bounded repair then six claims pass', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  const responses = [workspace.wrong, workspace.repaired];
  const prompts = [];
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'facts', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: io.callbacks,
      chat: async messages => {
        prompts.push(messages[0].content);
        return responses.shift();
      },
    });

    assert.equal(result?.applied, true);
    assert.equal(result?.taskComplete, true);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /唯一一次有界修复/);
    assert.match(prompts[1], /kMavTunnelCmdLicense: 实际 300，期望 33007/);
    assert.equal(result?.verificationResults?.length, 2);
    assert.equal(result?.verificationResults?.[0].ok, false);
    assert.equal(result?.verificationResults?.[1].ok, true);
    assert.equal(result?.artifactClaims?.length, 6);
    assert.equal(result?.artifactClaims?.every(claim => claim.status === 'verified'), true);
    assert.equal(result?.evidenceRefs?.some(ref => ref.kind === 'artifact-readback' && ref.contentHash), true);
    const settledContent = readFileSync(workspace.target, 'utf8');
    assert.match(settledContent, new RegExp(workspace.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(settledContent, /```python\nprint\("\\nready"\)\n```/);
    assert.equal(io.statuses.at(-1).state, 'started');
    assert.equal(io.statuses.some(status => status.state === 'completed'), false);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: revocation while bounded repair is in flight leaves no unverified draft', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  let writeAuthorized = true;
  let providerCalls = 0;
  let writeGuardCalls = 0;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'repair-revoke', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: {
        ...io.callbacks,
        onResolveFileWriteConstraint: async () => {
          writeGuardCalls += 1;
          return writeAuthorized ? ALLOW_FILE_WRITE : DENY_FILE_WRITE;
        },
      },
      chat: async () => {
        providerCalls += 1;
        if (providerCalls === 2) writeAuthorized = false;
        return providerCalls === 1 ? workspace.wrong : workspace.repaired;
      },
    });

    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /write blocked by guard/);
    assert.equal(providerCalls, 2);
    assert.equal(writeGuardCalls, 1, 'only the final verified candidate reaches the physical write guard');
    assert.equal(result?.verificationResults?.length, 1);
    assert.equal(result?.verificationResults?.[0].ok, false);
    assert.equal(io.changes.length, 0);
    assert.equal(existsSync(workspace.target), false, 'the rejected first candidate must never touch disk');
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: 20260711-165205 required claim source cannot be starved by heuristic evidence', async () => {
  const workspace = createLiveEvidenceStarvationReplay();
  const io = makeCallbacks();
  let providerCalls = 0;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'live-evidence-priority', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建严格的六常量 Markdown 源码事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: io.callbacks,
      chat: async () => {
        providerCalls += 1;
        return workspace.wrong;
      },
    });

    assert.equal(result?.applied, true, result?.failedReason);
    assert.equal(result?.taskComplete, true);
    assert.equal(providerCalls, 0, 'a fully executable exact contract is host-owned');
    const sourceEvidence = result?.evidenceRefs?.find(ref => ref.kind === 'read' && ref.sourcePath === workspace.source);
    assert.equal(sourceEvidence?.captureSequence, 1, 'the contract-required source must be the first captured file evidence');
    assert.equal(result?.verificationResults?.length, 1);
    assert.equal(result?.verificationResults?.[0]?.ok, true);
    assert.equal(io.changes.length, 1, 'the verified artifact is committed once');
    assert.equal(readFileSync(workspace.target, 'utf8'), workspace.repaired);
    assert.match(readFileSync(workspace.target, 'utf8'), /\| kTunnelMaxTotalLen \| 64 \* 1024 \|/);
    assert.doesNotMatch(readFileSync(workspace.target, 'utf8'), /\| kTunnelMaxTotalLen \| 65536 \|/);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: English executable exact contract is host-owned and byte-exact', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-english-exact-'));
  const source = path.join(root, 'src/config.hpp');
  const target = path.join(root, 'docs/config.md');
  mkdirSync(path.dirname(source), { recursive: true });
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(source, [
    'constexpr int kRequestTimeoutMs = 5000;',
    'constexpr int kMaxRetries = 3;',
  ].join('\n'));
  const prompt = [
    `Read ${source} and extract the real definitions and values of kRequestTimeoutMs, kMaxRetries.`,
    `Create only one Markdown report ${target}.`,
    'The report must strictly follow this structure:',
    '1. The title must exactly be: # Source Facts Report',
    `2. The next line must exactly be: Source path: ${source}`,
    '3. Include only one Markdown table; the header must be Symbol and Value; the table must have 2 rows.',
    '4. Include only one Python code block; the language marker must be python; code block content must exactly be: print("ready")',
    'No additional content, headings, rows, or blocks may be added; read it back after writing.',
  ].join('\n');
  const expected = [
    '# Source Facts Report',
    `Source path: ${source}`,
    '| Symbol | Value |',
    '| --- | --- |',
    '| kRequestTimeoutMs | 5000 |',
    '| kMaxRetries | 3 |',
    '```python',
    'print("ready")',
    '```',
    '',
  ].join('\n');
  let providerCalls = 0;
  try {
    const io = makeCallbacks();
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'english-exact', file: target, absPath: target, action: 'create', desc: prompt },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: prompt,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => { providerCalls += 1; return '# must-not-run'; },
    });
    assert.equal(result?.applied, true, result?.failedReason);
    assert.equal(providerCalls, 0);
    assert.equal(io.changes.length, 1);
    assert.equal(readFileSync(target, 'utf8'), expected);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: unsafe exact table values fail closed before provider, guard, or disk', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-exact-unsafe-cell-'));
  const source = path.join(root, 'src/facts.hpp');
  const target = path.join(root, 'docs/facts.md');
  mkdirSync(path.dirname(source), { recursive: true });
  writeFileSync(source, 'inline constexpr const char* kPipe = "left|right";\n');
  const prompt = [
    `请读取 ${source}，从源码提取 kPipe 的真实定义和值。`,
    `只创建 Markdown 报告 ${target}。`,
    '报告必须严格满足以下结构：',
    '1. 标题必须逐字为：# 源码事实报告',
    `2. 紧接一行必须逐字为：源码路径：${source}`,
    '3. 仅包含一个 Markdown 表格，表头必须是 Symbol 和 Value，数据行恰好一行。',
    '不得增加其他标题、表格数据行、代码块或说明段落。',
  ].join('\n');
  let providerCalls = 0;
  let guardCalls = 0;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'unsafe-exact-cell', file: target, absPath: target, action: 'create', desc: prompt },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: prompt,
      workspaceRoot: { fsPath: root },
      callbacks: {
        ...makeCallbacks().callbacks,
        onResolveFileWriteConstraint: async () => { guardCalls += 1; return ALLOW_FILE_WRITE; },
      },
      chat: async () => { providerCalls += 1; return '# should-not-run'; },
    });

    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /无法安全放入 Markdown 表格/);
    assert.equal(providerCalls, 0);
    assert.equal(guardCalls, 0);
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: precommit source drift blocks the candidate without touching the target', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  let providerCalls = 0;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'precommit-source-drift', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: io.callbacks,
      chat: async () => {
        providerCalls += 1;
        writeFileSync(workspace.source, `${readFileSync(workspace.source, 'utf8')}\n// concurrent drift\n`);
        return workspace.repaired;
      },
    });

    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /源码在生成后发生变化/);
    assert.equal(providerCalls, 1, 'source drift is not repairable by another provider response');
    assert.equal(io.changes.length, 0);
    assert.equal(existsSync(workspace.target), false);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: source drift during asynchronous write authorization never touches an existing target', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  const sentinel = '# existing user artifact\n';
  writeFileSync(workspace.target, sentinel);
  const beforeMtime = statSync(workspace.target).mtimeMs;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'guard-source-drift', file: workspace.target, absPath: workspace.target, action: 'modify', desc: '更新六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: {
        ...io.callbacks,
        onResolveFileWriteConstraint: async () => {
          writeFileSync(workspace.source, `${readFileSync(workspace.source, 'utf8')}\n// drift during guard\n`);
          return ALLOW_FILE_WRITE;
        },
      },
      chat: async () => workspace.repaired,
    });

    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /源码在生成后发生变化/);
    assert.equal(readFileSync(workspace.target, 'utf8'), sentinel);
    assert.equal(statSync(workspace.target).mtimeMs, beforeMtime);
    assert.equal(io.changes.length, 0);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: target creation during write authorization is detected and never deleted', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  const sentinel = '# concurrently created artifact\n';
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'guard-target-drift', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: {
        ...io.callbacks,
        onResolveFileWriteConstraint: async () => {
          writeFileSync(workspace.target, sentinel);
          return ALLOW_FILE_WRITE;
        },
      },
      chat: async () => workspace.repaired,
    });

    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /target changed while write authority was pending/);
    assert.equal(readFileSync(workspace.target, 'utf8'), sentinel);
    assert.equal(io.changes.length, 0);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: target created during provider generation is rejected against the task-start baseline', async () => {
  const workspace = createLicenseFactWorkspace();
  const sentinel = '# user created this while provider was running\n';
  try {
    const io = makeCallbacks();
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'provider-target-drift', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: io.callbacks,
      chat: async () => {
        writeFileSync(workspace.target, sentinel);
        return workspace.repaired;
      },
    });
    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /target changed after task authorization/);
    assert.equal(readFileSync(workspace.target, 'utf8'), sentinel);
    assert.equal(io.changes.length, 0);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: guard-time parent symlink swap cannot create an outside file', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-parent-swap-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'devseek-md-parent-swap-outside-'));
  const source = path.join(root, 'facts.hpp');
  const docs = path.join(root, 'docs');
  const target = path.join(docs, 'facts.md');
  writeFileSync(source, 'constexpr int kValue = 7;\n');
  const prompt = [
    `请读取 ${source}，提取 kValue 的真实定义和值。`,
    `只创建 Markdown 报告 ${target}。`,
    '报告必须严格满足以下结构：',
    '标题必须逐字为：# 源码事实报告',
    `紧接一行必须逐字为：源码路径：${source}`,
    '仅包含一个 Markdown 表格，表头必须是 Symbol 和 Value，数据行恰好一行。',
    '不得增加其他标题、表格数据行、代码块或说明段落。',
  ].join('\n');
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'parent-swap', file: target, absPath: target, action: 'create', desc: prompt },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: prompt,
      workspaceRoot: { fsPath: root },
      callbacks: {
        ...makeCallbacks().callbacks,
        async onResolveFileWriteConstraint() {
          symlinkSync(outside, docs, 'dir');
          return ALLOW_FILE_WRITE;
        },
      },
      chat: async () => '# must-not-run',
    });
    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /escapes workspace at commit boundary/);
    assert.equal(existsSync(path.join(outside, 'facts.md')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('markdown deliverable: explicit claim source remains first when project communication evidence is requested', async () => {
  const workspace = createLiveEvidenceStarvationReplay();
  const io = makeCallbacks();
  io.callbacks.onResolveFileWriteConstraint = async () => DENY_FILE_WRITE;
  let providerCalls = 0;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'communication-evidence-priority', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建严格的六常量 Markdown 源码事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: `${workspace.prompt}\n同时参考并对齐现有 tunnel 通信链路，但只交付上述事实报告。`,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: io.callbacks,
      chat: async () => {
        providerCalls += 1;
        return workspace.repaired;
      },
    });

    assert.equal(result?.applied, false);
    assert.equal(result?.failedReason, 'Markdown deliverable write blocked by guard');
    assert.equal(providerCalls, 0);
    assert.equal(existsSync(workspace.target), false);
    const sourceEvidence = result?.evidenceRefs?.find(ref => ref.kind === 'read' && ref.sourcePath === workspace.source);
    assert.equal(sourceEvidence?.captureSequence, 1);
    const supplementalEvidence = result?.evidenceRefs?.find(ref => ref.sourcePath?.endsWith('/license_00.cpp'));
    assert.ok(supplementalEvidence?.captureSequence > sourceEvidence.captureSequence);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: a missing required source fails before any provider call or write', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  let chatCalls = 0;
  try {
    rmSync(workspace.source, { force: true });
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'missing-claim-source', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六常量 Markdown 源码事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: io.callbacks,
      chat: async () => { chatCalls += 1; return workspace.repaired; },
    });

    assert.equal(chatCalls, 0);
    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /^missing-source-evidence:/);
    assert.equal(existsSync(workspace.target), false);
    assert.equal(io.activities.some(activity => activity.kind === 'web'), false);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: definitions beyond the raw prompt projection are supplied as host-derived facts', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  let providerPrompt = '';
  try {
    const originalSource = readFileSync(workspace.source, 'utf8');
    writeFileSync(workspace.source, `// ${'padding'.repeat(1_100)}\n${originalSource}`);
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'late-claim-definitions', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六常量 Markdown 源码事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: io.callbacks,
      chat: async messages => { providerPrompt = messages[0].content; return workspace.repaired; },
    });

    assert.equal(result?.applied, true, result?.failedReason);
    assert.match(providerPrompt, /必需源码事实（最高优先级）: src\/oam\/src\/license\/license_types\.hpp（原文未投影）/);
    assert.match(providerPrompt, /"symbol": "kTopicLicenseTunnelRx"[\s\S]*?"artifactValue": "\/uav\/license\/tunnel\/rx"/);
    assert.match(providerPrompt, /"symbol": "kTunnelMaxTotalLen"[\s\S]*?"normalizedValue": 65536/);
    const sourceEvidence = result?.evidenceRefs?.find(ref => ref.sourcePath === workspace.source);
    assert.ok(sourceEvidence?.content?.length > 6_000);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: more than twelve contract-required sources bypass optional evidence limits', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-many-claim-sources-'));
  const target = path.join(root, 'docs/many-facts.md');
  const io = makeCallbacks();
  io.callbacks.onResolveFileWriteConstraint = async () => DENY_FILE_WRITE;
  let providerPrompt = '';
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    const sourcePaths = Array.from({ length: 13 }, (_, index) => {
      const sourcePath = path.join(root, 'src', `fact_${String(index + 1).padStart(2, '0')}.hpp`);
      mkdirSync(path.dirname(sourcePath), { recursive: true });
      writeFileSync(sourcePath, `constexpr int kClaim${String(index + 1).padStart(2, '0')} = ${index + 1};\n`);
      return sourcePath;
    });
    const prompt = [
      ...sourcePaths.map((sourcePath, index) => (
        `请读取 ${sourcePath}，提取 kClaim${String(index + 1).padStart(2, '0')} 的真实值。`
      )),
      `请创建 Markdown 报告 ${target}。`,
    ].join('\n');
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'many-claim-sources', file: target, absPath: target, action: 'create', desc: prompt },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: prompt,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async messages => {
        providerPrompt = messages[0].content;
        return [
          '# 多源码事实报告',
          '',
          '| Symbol | Value |',
          '| --- | --- |',
          ...sourcePaths.map((_, index) => `| kClaim${String(index + 1).padStart(2, '0')} | ${index + 1} |`),
        ].join('\n');
      },
    });

    assert.equal(result?.failedReason, 'Markdown deliverable write blocked by guard');
    const capturedSources = result?.evidenceRefs?.filter(ref => sourcePaths.includes(ref.sourcePath)) || [];
    const initialCaptures = capturedSources.filter(ref => ref.captureSequence <= sourcePaths.length);
    assert.equal(initialCaptures.length, 13);
    assert.deepEqual(initialCaptures.map(ref => ref.captureSequence), Array.from({ length: 13 }, (_, index) => index + 1));
    assert.equal(capturedSources.filter(ref => ref.operationId?.startsWith('source-precommit-readback-')).length, 13);
    assert.match(providerPrompt, /"symbol": "kClaim13"[\s\S]*?"artifactValue": "13"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: second claim mismatch is sticky and task_complete remains blocked', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  let calls = 0;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'facts', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: io.callbacks,
      chat: async () => { calls += 1; return workspace.wrong; },
    });

    assert.equal(calls, 2);
    assert.equal(result?.applied, false);
    assert.notEqual(result?.taskComplete, true);
    assert.match(result?.failedReason || '', /^artifact-grounding:/);
    assert.equal(result?.verificationResults?.length, 2);
    assert.equal(result?.verificationResults?.every(item => !item.ok), true);
    assert.equal(io.statuses.at(-1).state, 'failed');
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: final delivery callback failure rolls back while preserving candidate audit trail', async () => {
  const workspace = createLicenseFactWorkspace();
  const io = makeCallbacks();
  const responses = [workspace.wrong, workspace.repaired];
  let appliedCallbacks = 0;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'facts', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: {
        ...io.callbacks,
        onAppliedChange() {
          appliedCallbacks += 1;
          throw new Error('simulated final delivery failure');
        },
      },
      chat: async () => responses.shift(),
    });

    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /final delivery failure/);
    assert.equal(appliedCallbacks, 1);
    assert.equal(result?.verificationResults?.length, 2);
    assert.equal(result?.verificationResults?.[0].ok, false);
    assert.equal(result?.verificationResults?.[1].ok, true);
    assert.equal(result?.artifactClaims?.every(claim => claim.status === 'verified'), true);
    assert.equal(result?.evidenceRefs?.some(ref => ref.operationId === 'artifact-readback-commit'), true);
    assert.equal(existsSync(workspace.target), false, 'failed delivery must roll back the new target');
    assert.equal(io.statuses.at(-1).state, 'failed');
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: rollback never follows a callback-time parent symlink or deletes outside content', async () => {
  const workspace = createLicenseFactWorkspace();
  const outside = mkdtempSync(path.join(tmpdir(), 'devseek-md-rollback-outside-'));
  const docs = path.dirname(workspace.target);
  const movedDocs = `${docs}-committed`;
  let originalCommittedPath = '';
  let committedContent = '';
  try {
    const io = makeCallbacks();
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'callback-parent-swap', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: {
        ...io.callbacks,
        onAppliedChange(change) {
          committedContent = change.newContent;
          renameSync(docs, movedDocs);
          symlinkSync(outside, docs, 'dir');
          const outsideTarget = path.join(outside, path.basename(workspace.target));
          writeFileSync(outsideTarget, change.newContent);
          originalCommittedPath = path.join(movedDocs, path.basename(workspace.target));
          throw new Error('simulated callback failure after parent swap');
        },
      },
      chat: async () => workspace.repaired,
    });

    const outsideTarget = path.join(outside, path.basename(workspace.target));
    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /rollback-aborted/);
    assert.equal(readFileSync(outsideTarget, 'utf8'), committedContent, 'outside file must be preserved');
    assert.equal(readFileSync(originalCommittedPath, 'utf8'), committedContent, 'commit remains reachable only through its original directory inode');
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('markdown deliverable: final UI status failure cannot rewrite a verified commit as failed', async () => {
  const workspace = createLicenseFactWorkspace();
  let changes = 0;
  let committedContent = '';
  try {
    const io = makeCallbacks();
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'status-transport-failure', file: workspace.target, absPath: workspace.target, action: 'create', desc: '创建六个常量的 Markdown 事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: workspace.prompt,
      workspaceRoot: { fsPath: workspace.root },
      callbacks: {
        ...io.callbacks,
        onAgentStatus(status) {
          if (/等待中央结算/.test(status.title || '')) throw new Error('simulated status transport failure');
        },
        onAppliedChange(change) { changes += 1; committedContent = change.newContent; },
      },
      chat: async () => workspace.repaired,
    });

    assert.equal(result?.applied, true, result?.failedReason);
    assert.equal(changes, 1);
    assert.equal(readFileSync(workspace.target, 'utf8'), committedContent);
  } finally {
    rmSync(workspace.root, { recursive: true, force: true });
  }
});

test('markdown deliverable: failed write equality never records an artifact-readback EvidenceRef', () => {
  const source = readFileSync(path.join(rootDir, 'src/agent/markdown-deliverable-task.ts'), 'utf8');
  const equalityGuard = source.indexOf('if (freshContent !== finalContent)');
  const artifactReadback = source.indexOf("kind: 'artifact-readback'", equalityGuard);
  const guardEnd = source.indexOf('const artifactEvidence = evidenceStore.recordFileRead', equalityGuard);
  assert.ok(equalityGuard >= 0 && artifactReadback > equalityGuard);
  assert.equal(artifactReadback > guardEnd, true, 'artifact evidence must be created only after equality failure returned');
});

test('markdown deliverable: direct executor rejects a symlink escape before provider or write callbacks', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-symlink-'));
  const outside = mkdtempSync(path.join(tmpdir(), 'devseek-md-outside-'));
  const linkedDocs = path.join(root, 'docs');
  const target = path.join(linkedDocs, 'report.md');
  symlinkSync(outside, linkedDocs, 'dir');
  let providerCalls = 0;
  let writeGuardCalls = 0;
  try {
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'symlink', file: 'docs/report.md', absPath: target, action: 'create', desc: '创建 Markdown 报告 docs/report.md' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: '请创建 Markdown 报告 docs/report.md。',
      workspaceRoot: { fsPath: root },
      callbacks: {
        ...makeCallbacks().callbacks,
        async onResolveFileWriteConstraint() { writeGuardCalls += 1; return ALLOW_FILE_WRITE; },
      },
      chat: async () => { providerCalls += 1; return '# report'; },
    });
    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /escapes workspace/);
    assert.equal(providerCalls, 0);
    assert.equal(writeGuardCalls, 0);
    assert.equal(existsSync(path.join(outside, 'report.md')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('markdown deliverable: cancellation after provider return prevents the first write', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-abort-'));
  const target = path.join(root, 'report.md');
  const controller = new AbortController();
  try {
    const io = makeCallbacks();
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'abort', file: 'report.md', absPath: target, action: 'create', desc: '创建 Markdown 报告 report.md' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: '请创建 Markdown 报告 report.md。',
      workspaceRoot: { fsPath: root },
      callbacks: { ...io.callbacks, signal: controller.signal },
      chat: async () => {
        controller.abort();
        return '# 完整报告\n\n## 内容\n\n'.padEnd(260, '证');
      },
    });
    assert.equal(result?.applied, false);
    assert.match(result?.failedReason || '', /aborted before write/);
    assert.equal(existsSync(target), false);
    assert.equal(io.changes.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: a valid short exact fact report is not padded to the generic 240-character minimum', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-short-fact-'));
  const source = path.join(root, 'config.hpp');
  const target = path.join(root, 'report.md');
  writeFileSync(source, 'constexpr uint32_t timeoutMs = 5000;\n');
  const prompt = `读取 ${source}，提取 timeoutMs 的真实值。创建 Markdown 报告 ${target}，包含标题、源码路径和一个常量的表格，写入后重新读取。`;
  const markdown = `# 源码事实报告\n源码路径：${source}\n| Symbol | Value |\n| --- | --- |\n| timeoutMs | 5000 |\n`;
  assert.ok(markdown.length < 240);
  try {
    const io = makeCallbacks();
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'short-fact', file: target, absPath: target, action: 'create', desc: '创建 Markdown 源码事实报告' },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: prompt,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => markdown,
    });
    assert.equal(result?.applied, true, result?.failedReason);
    assert.equal(result?.verificationResults?.at(-1)?.ok, true);
    const written = readFileSync(target, 'utf8');
    assert.ok(written.length < 240);
    assert.match(written, /\| timeoutMs \| 5000 \|/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: direct modify task with only an update md path remains grounded', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-update-fact-'));
  const source = path.join(root, 'config.hpp');
  const target = path.join(root, 'report.md');
  writeFileSync(source, 'constexpr uint32_t timeoutMs = 5000;\n');
  writeFileSync(target, '# stale unverified report\n');
  const prompt = `读取 ${source}，提取 timeoutMs 的真实值；更新 ${target}，包含标题、源码路径和一行表格，写入后重新读取。`;
  const markdown = `# 源码事实报告\n源码路径：${source}\n| Symbol | Value |\n| --- | --- |\n| timeoutMs | 5000 |\n`;
  try {
    const io = makeCallbacks();
    const result = await tryExecuteMarkdownDeliverableTask({
      task: { id: 'update-fact', file: target, absPath: target, action: 'modify', desc: `更新 ${target}` },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: prompt,
      workspaceRoot: { fsPath: root },
      callbacks: io.callbacks,
      chat: async () => markdown,
    });

    assert.equal(result?.applied, true, result?.failedReason);
    assert.equal(result?.writtenFiles?.[0]?.action, 'modify');
    assert.equal(result?.verificationResults?.at(-1)?.ok, true);
    assert.equal(readFileSync(target, 'utf8'), markdown);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: negated document mutations never enter the writer', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-negated-write-'));
  const target = path.join(root, 'report.md');
  const original = '# existing report\n';
  writeFileSync(target, original);
  let providerCalls = 0;
  try {
    for (const prompt of [
      `不修改 ${target}。`,
      `勿修改 ${target}。`,
      `不得提供 Markdown 报告 ${target}。`,
      `不允许生成 Markdown 报告 ${target}。`,
    ]) {
      const io = makeCallbacks();
      const result = await tryExecuteMarkdownDeliverableTask({
        task: { id: 'negated-write', file: target, absPath: target, action: 'modify', desc: prompt },
        taskIndex: 1,
        taskTotal: 1,
        userPrompt: prompt,
        workspaceRoot: { fsPath: root },
        callbacks: io.callbacks,
        chat: async () => {
          providerCalls += 1;
          return '# forbidden\n';
        },
      });
      assert.equal(result, undefined, prompt);
      assert.equal(readFileSync(target, 'utf8'), original, prompt);
    }
    assert.equal(providerCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown deliverable: planner drift cannot authorize a prohibited or sibling target', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-md-planner-drift-'));
  const allowedTarget = path.join(root, 'a.md');
  const deniedTarget = path.join(root, 'b.md');
  let providerCalls = 0;
  try {
    for (const prompt of [
      `不要创建 Markdown 报告 ${deniedTarget}。`,
      `请创建 Markdown 报告 ${allowedTarget}，不要修改 ${deniedTarget}。`,
    ]) {
      const io = makeCallbacks();
      const result = await tryExecuteMarkdownDeliverableTask({
        task: {
          id: 'planner-drift',
          file: deniedTarget,
          absPath: deniedTarget,
          action: 'create',
          desc: `创建 Markdown 报告 ${deniedTarget}`,
        },
        taskIndex: 1,
        taskTotal: 1,
        userPrompt: prompt,
        workspaceRoot: { fsPath: root },
        callbacks: io.callbacks,
        chat: async () => {
          providerCalls += 1;
          return '# forbidden provider output\n';
        },
      });
      assert.equal(result?.applied, false, prompt);
      assert.match(result?.failedReason || '', /markdown-artifact-(?:write-prohibited|target-not-requested)/, prompt);
      assert.equal(existsSync(deniedTarget), false, prompt);
      assert.deepEqual(io.changes, [], prompt);
    }
    assert.equal(providerCalls, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
