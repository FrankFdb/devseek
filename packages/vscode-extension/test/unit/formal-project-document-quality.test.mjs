/**
 * Unit tests for formal-project Markdown quality gates.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/formal-project-document-quality.bundle.cjs');

execSync(
  `npx esbuild src/agent/formal-project-document-quality.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { assessFormalProjectDocumentQuality, normalizeFormalProjectMarkdown } = req(bundlePath);

const prompt = [
  '参考 /repo/src/oam/src/license 模块的通讯方式。',
  '基于 /repo/src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md 和接口文档，',
  '完成遥控器和主控的交互接口设计，主控逻辑实现设计，并添加代码实现和自闭环验证。',
].join('\n');

test('formal project quality: scoped source-backed Markdown audit is not a formal project document', () => {
  const auditPrompt = [
    '请基于 /tmp/workspace/docs/r3-iteration/deepseek-login-ready-state-matrix.md 和 /tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts 创建 Markdown 审计报告。',
    '请把报告保存到 /tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md。',
    '报告主题是 R3-LIVE-DEEPSEEK-LOGIN-READY-STATE plugin-opened DeepSeek login readiness audit。',
    '本次只允许创建这一份 Markdown 文件；不要修改任何源码，不要运行编译或测试命令。',
    '报告正文请使用与本测试 case 相同的中文撰写；技术标识符、协议名、文件路径和验收锚点保持原文。',
  ].join('\n');
  const doc = [
    '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告',
    '',
    '## 源项目事实矩阵',
    '',
    '| 事实项 | 证据来源 | 证据值 |',
    '|--------|----------|--------|',
    '| Leaf | `deepseek-login-ready-state-matrix.md:1` | `R3-LIVE-DEEPSEEK-LOGIN-READY-STATE` |',
    '| Owner | `deepseek-login-ready-state-contract.ts:2` | `BridgeHealthCheck` |',
    '',
    '## 结论',
    '',
    '`plugin-opened DeepSeek page` 和 `chatInput evidence` 只用于本轮静态审计。',
  ].join('\n');

  const quality = assessFormalProjectDocumentQuality(doc, auditPrompt);

  assert.equal(quality.required, false);
  assert.equal(quality.ok, true);
  assert.deepEqual(quality.reasons, []);
});

test('formal project quality: generic reference document is rejected', () => {
  const doc = [
    '# 无人机维保提醒接口设计',
    '',
    '## 参考架构',
    '',
    '- 参考 license 模块的独立线程、分片传输和发布订阅通信。',
    '- 主控和遥控器通过 JSON 交互。',
    '',
    '## 集成点',
    '',
    '- 修改 LiftingManager 接入维保逻辑。',
  ].join('\n');

  const quality = assessFormalProjectDocumentQuality(doc, prompt);

  assert.equal(quality.required, true);
  assert.equal(quality.ok, false);
  assert.deepEqual(quality.reasons, [
    'missing-source-fact-matrix',
    'missing-concrete-protocol-facts',
    'missing-remote-controller-interface-doc',
    'missing-existing-code-modification-plan',
    'missing-project-wide-communication-chain',
  ]);
});

test('formal project quality: normalizes single-backtick code blocks', () => {
  const doc = [
    '# 接口示例',
    '',
    '`json',
    '{"type":"status"}',
    '`',
    '',
    '`',
    '平台 --HTTP--> 遥控器 --MAVLink--> 主控',
    '`',
  ].join('\n');

  const normalized = normalizeFormalProjectMarkdown(doc);

  assert.equal(normalized.changed, true);
  assert.equal(normalized.repairedFenceCount, 4);
  assert.match(normalized.text, /```json\n\{"type":"status"\}\n```/);
  assert.match(normalized.text, /```\n平台 --HTTP--> 遥控器 --MAVLink--> 主控\n```/);
});

test('formal project quality: unresolved protocol facts and missing UART chain are rejected', () => {
  const doc = [
    '# 维保提醒正式项目设计',
    '',
    '## 源项目事实矩阵',
    '',
    '| 文件 | 事实 | 复用方式 |',
    '|------|------|----------|',
    '| `src/oam/src/license/license_types.hpp:8` | `kTopicLicenseTunnelRx="/uav/license/tunnel/rx"`，`kTopicLicenseTunnelTx="/uav/license/tunnel/tx"` | 复用 topic 边界 |',
    '| `src/oam/src/license/license_types.hpp:11` | `kMavTunnelCmdLicense=33007` | 参考命令号分配 |',
    '| `src/oam/src/license/license_types.hpp:15` | `kTunnelVersion=1`，`kTunnelMaxTotalLen=64 * 1024`，`kTunnelSessionTimeoutMs=5000` | 复用超时和大小 |',
    '| `src/oam/src/license/license_tunnel_transport.cpp:304` | `sessionId/seq/total/payloadLen/totalLen/crc32` | 复用分片字段 |',
    '',
    '## 通讯链路',
    '',
    '仅说明 TunnelTransport、MAVLINK_MSG_TUNNEL、HDStringPublisher、HDStringSubscriber、topic、payload_type、crc32、sessionId 和 route。',
    '',
    '## 遥控器接口',
    '',
    '命令号待分配，建议范围 41000-41099。',
    '',
    '示例 request：',
    '```json',
    '{"type":"platform_status","requestId":"r1"}',
    '```',
    '示例 response：',
    '```json',
    '{"type":"warranty_status","requestId":"r1","errorCode":0}',
    '```',
    '超时 5000ms 后重试，幂等键 requestId，错误码 errorCode。',
    '',
    '## 原有代码修改清单',
    '| 目标文件 | 函数/类 | 改动内容 | 原因 | 风险 | 验证方式 |',
    '|---|---|---|---|---|---|',
    '| `src/oam/src/lifting/lifting_manager.hpp:16` | `LiftingManager` | 增加管理器 | 生命周期接入 | 初始化顺序 | 单测 |',
    '| `src/oam/src/lifting/pump_adjust_main.cpp:146` | `init` | 注入发布器 | 通道统一 | topic 冲突 | 回归 |',
  ].join('\n');

  const quality = assessFormalProjectDocumentQuality(doc, prompt);

  assert.equal(quality.required, true);
  assert.equal(quality.ok, false);
  assert.equal(quality.hasResolvedProjectFacts, false);
  assert.equal(quality.hasUartOrEquivalentCommunicationEntry, false);
  assert.match(quality.reasons.join(','), /unresolved-project-facts/);
  assert.match(quality.reasons.join(','), /missing-project-wide-communication-chain/);
});

test('formal project quality: source facts, interface schema, and modification plan pass', () => {
  const doc = [
    '# 维保提醒正式项目设计与实现说明',
    '',
    '## 源项目事实矩阵',
    '',
    '| 文件 | 事实 | 复用方式 |',
    '|------|------|----------|',
    '| `src/oam/src/license/license_types.hpp:8` | `kTopicLicenseTunnelRx="/uav/license/tunnel/rx"`，`kTopicLicenseTunnelTx="/uav/license/tunnel/tx"` | 维保通道复用 topic 命名和收发边界 |',
    '| `src/oam/src/license/license_types.hpp:11` | `kMavTunnelCmdLicense=33007` | 新维保 tunnel 需独立 payload_type 或明确复用规则 |',
    '| `src/oam/src/license/license_types.hpp:15` | `kTunnelVersion=1`，`kTunnelMaxTotalLen=64 * 1024`，`kTunnelSessionTimeoutMs=5000` | 维保分片版本、最大长度和超时策略按此对齐 |',
    '| `src/oam/src/license/license_tunnel_transport.cpp:12` | `kDuplicateRequestDropWindowMs=1000`，`kMaxActiveSessions=128`，`kMaxCompletedRequests=256` | 维保请求重复抑制和会话上限按同等规则设计 |',
    '| `src/oam/src/license/license_tunnel_transport.cpp:304` | `LicenseTunnelHeader` 字段含 `sessionId/seq/total/payloadLen/totalLen/crc32` | 维保 JSON 按同一分片/CRC 模型验证 |',
    '| `src/oam/src/uart1_tx_main.cpp:35` | `HDStringPublisher` 把主控 JSON 通过 `/uav/dt/oam_msg/tx` 发送到遥控器侧链路 | 维保结果必须接入这个真实发送入口，而不是只在 zc_maintenance 目录内自洽 |',
    '| `src/oam/src/uart1_rx_main.cpp:52` | `HDStringSubscriber` 接收遥控器/平台转发消息，并按 topic 路由给业务模块 | 维保平台状态同步从接收入口进入主控 |',
    '',
    '## 遥控器与主控接口文档',
    '',
    '| 方向 | 承载通道 | 消息类型 | request JSON schema 字段 | response JSON schema 字段 |',
    '|------|----------|----------|--------------------------|---------------------------|',
    '| 遥控器 -> 主控 | MAVLINK_MSG_TUNNEL, payload_type warranty | `platform_status` | `requestId`、`deviceSn`、`statisticsCutoffAt`、`metrics.flightSorties`、`thresholds.expiringSoonDays` | `accepted`、`errorCode` |',
    '| 主控 -> 遥控器 | topic `/uav/dt/oam_msg/tx` | `warranty_status` | `requestId` | `status`、`level`、`triggerReason`、`nextCheckAtMs`、`version` |',
    '',
    '示例 request：',
    '',
    '```json',
    '{"type":"platform_status","requestId":"r1","metrics":{"flightSorties":120},"version":1}',
    '```',
    '',
    '示例 response：',
    '',
    '```json',
    '{"type":"warranty_status","requestId":"r1","level":"expiring_soon","errorCode":0,"version":1}',
    '```',
    '',
    '超时 5000ms 后重试，幂等键使用 requestId + sessionId，错误码包括 payload_invalid、crc_mismatch、timeout。',
    '',
    '## 原有代码修改清单',
    '',
    '| 目标文件 | 函数/类 | 改动内容 | 原因 | 风险 | 验证方式 |',
    '|----------|---------|----------|------|------|----------|',
    '| `src/oam/src/lifting/lifting_manager.hpp:16` | `LiftingManager` | 增加 WarrantyManager 成员和 init 注入 | 接入主控生命周期 | 初始化顺序 | 单测 + 启动日志 |',
    '| `src/oam/src/lifting/pump_adjust_main.cpp:146` | `rc_maintenance_publisher` | 复用 `/uav/dt/oam_msg/tx` 发布器 | 遥控器通道统一 | topic 冲突 | 回归 topic 发布 |',
    '| `src/oam/src/lifting/pump_adjust_main.cpp:4329` | `init` | 调用维保模块 init | 接入调度 | 空指针风险 | 自检验证 |',
    '| `src/oam/src/lifting/zc_maintenance/warranty_manager.hpp` | `WarrantyManager` | 新增状态合并和复位 | 维保主逻辑 | 状态迁移 | 边界测试 |',
  ].join('\n');

  const quality = assessFormalProjectDocumentQuality(doc, prompt);

  assert.equal(quality.required, true);
  assert.equal(quality.ok, true);
  assert.deepEqual(quality.reasons, []);
  assert.equal(quality.hasConcreteProtocolFacts, true);
  assert.equal(quality.hasRemoteControllerInterfaceDoc, true);
  assert.equal(quality.hasInterfaceRequestExample, true);
  assert.equal(quality.hasInterfaceResponseExample, true);
  assert.equal(quality.hasInterfaceFencedJsonExample, true);
  assert.equal(quality.hasExistingCodeModificationPlan, true);
  assert.equal(quality.hasProjectWideCommunicationChain, true);
});

console.log('\nFormal project document quality tests passed.\n');
