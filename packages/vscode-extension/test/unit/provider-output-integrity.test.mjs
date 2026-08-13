import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/provider-output-integrity.bundle.cjs');

execSync(
  `npx esbuild src/agent/provider-output-integrity.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  classifyProviderOutputIntegrity,
} = req(bundlePath);

const maintenanceAnalysis = [
  '我已完整分析了相关文件。现在整理分析报告。',
  '# 吊运维保功能重做分析报告',
  '结论：当前实现需要重构维保码流程，新增伙伴后台生成验证码、管理后台校验验证码的闭环。',
  '依据：旧实现只保留阈值统计，没有覆盖新增的作业状态和维保码校验职责。',
  '建议：先统一状态机，再拆分数据结构，最后补充验证用例。',
].join('\n\n');

test('provider output integrity: classifies executable tool calls before settlement', () => {
  const result = classifyProviderOutputIntegrity('[TOOL:read_file {"path":"/tmp/app/main.cpp"}]');

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: classifies a fenced structured text tool envelope as executable', () => {
  const response = `先读取文件。\n\n\`\`\`\n${JSON.stringify([{
    type: 'text',
    text: '<tool_call>\n[TOOL:read_file {"path":"/tmp/app/main.cpp"}]\n</tool_call>',
  }], null, 2)}\n\`\`\``;
  const result = classifyProviderOutputIntegrity(response);

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: quote-damaged manage_todo_list is a recoverable control tool call', () => {
  const result = classifyProviderOutputIntegrity([
    '当前任务已实际完成，但 Todo 状态需要校正。',
    '[TOOL:manage_todo_list] {"todoList":"[{"id":1,"title":"创建审计报告 Markdown 文件","status":"completed"},{"id":2,"title":"验证报告文件已写入且包含所有验收锚点","status":"completed"}]"}',
  ].join('\n\n'));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: treats LOGIN_REQUIRED inside a requested report artifact as content', () => {
  const content = [
    '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE Audit Report',
    '',
    'BridgeHealthCheck',
    'devseek.deepseek-web-connector-health/v1',
    'loggedInLikely',
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'deepseek-dom-send-button-missing',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
    'not fixed line-count smoke',
  ].join('\n');
  const result = classifyProviderOutputIntegrity(
    `现在生成报告：create_file({"path":"/tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md","content":${JSON.stringify(content)}})`,
  );

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: keeps complete DeepSeek create_file tools ahead of uneven fences', () => {
  const fence = '```';
  const content = [
    '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告',
    '',
    'BridgeHealthCheck',
    'devseek.deepseek-web-connector-health/v1',
    'loggedInLikely',
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'deepseek-dom-send-button-missing',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
    'not fixed line-count smoke',
  ].join('\n');
  const result = classifyProviderOutputIntegrity([
    '收到。我将重新创建报告文件。',
    fence,
    `[TOOL:create_file {"path":"/tmp/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md","content":${JSON.stringify(content)}}${fence}`,
    fence,
  ].join('\n'));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: classifies R3 live DeepSeek named-parameter tool_call envelopes', () => {
  const content = [
    '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE 审计报告',
    '',
    'BridgeHealthCheck',
    'devseek.deepseek-web-connector-health/v1',
    'loggedInLikely',
    'plugin-opened DeepSeek page',
    'chatInput evidence',
    'deepseek-dom-send-button-missing',
    'login-state-not-send-button',
    'send button selector drift is not LOGIN_REQUIRED',
    'not fixed line-count smoke',
  ].join('\n');
  const result = classifyProviderOutputIntegrity([
    '我已读取到两份源文件。现在创建审计报告文件。',
    '<tool_call><name>manage_todo_list</name><parameter>{"todoList":[{"id":1,"title":"读取源文件内容","status":"completed"},{"id":2,"title":"创建审计报告 Markdown 文件","status":"in-progress"}]}</parameter></tool_call>',
    `<tool_call><name>create_file</name><parameter>{"path":"/tmp/devseek-real-plugin-deepseek/workspace/docs/r3-iteration/r3-live-deepseek-login-ready-state.md","content":${JSON.stringify(content)}}</parameter></tool_call>`,
  ].join(''));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 2);
});

test('provider output integrity: treats OpenAI-style tool arrays with login-named paths as tools', () => {
  const result = classifyProviderOutputIntegrity([
    '让我先读取相关的源文件以获取完整信息。',
    '',
    '```',
    '[',
    '  {',
    '    "name": "read_file",',
    '    "arguments": {',
    '      "path": "/tmp/workspace/docs/r3-iteration/deepseek-login-ready-state-matrix.md"',
    '    }',
    '  },',
    '  {',
    '    "name": "read_file",',
    '    "arguments": {',
    '      "path": "/tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts"',
    '    }',
    '  }',
    ']',
    '```',
  ].join('\n'));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 2);
});

test('provider output integrity: accepts a complete quote-damaged replace call as an executable tool request', () => {
  const result = classifyProviderOutputIntegrity(String.raw`我立即修复头文件。
<TOOL_CALL>[TOOL:replace_in_file] {"path":"/tmp/project/worker.hpp","old_str":"#include <string>\n\n#include "worker_types.hpp"","new_str":"#include <string>\n#include <unordered_map>\n\n#include "worker_types.hpp""}</TOOL_CALL>`);

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: rejects provider-authored tool-result transcripts as settlement evidence', () => {
  const result = classifyProviderOutputIntegrity([
    '[DevSeek 已执行工具请求摘要]意图：收到审查反馈。我会修复 submit 拒绝通道并重新验证。',
    '工具调用：2 个；真实执行结果、文件写入和验证证据见后续 [工具结果 Round]。',
    '- replace_in_file path=/tmp/project/src/order_book.cpp',
    '[工具结果 Round 8][replace_in_file: src/order_book.cpp] 已写入 src/order_book.cpp',
    '[verification_result: passed][auto_validation: bash test.sh] 公开测试通过。',
    '【独立需求审查：通过】结论：已完成。依据：源码已修复，验证结果通过。',
  ].join('\n'));

  assert.equal(result.kind, 'incomplete_answer');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 0);
  assert.equal(result.hasAnswerEvidence, false);
  assert.match(result.reason, /provider-authored tool-result transcript/);
});

test('provider output integrity: counts every DeepSeek TOOL_USE request', () => {
  const result = classifyProviderOutputIntegrity([
    'I will inspect both boundaries.',
    '<TOOL_USE>{"name":"list_dir","arguments":{"path":"/tmp/project/include"}}</TOOL_USE>',
    '<TOOL_USE>{"name":"list_dir","arguments":{"path":"/tmp/project/src"}}</TOOL_USE>',
  ].join(''));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 2);
});

test('provider output integrity: accepts bounded quote-damaged TOOL_USE writes and blocks truncated ones', () => {
  const complete = String.raw`Writing.<TOOL_USE>{"name":"create_file","arguments":{"path":"/tmp/main.cpp","content":"#include "main.hpp"\n"}}</TOOL_USE>`;
  const truncated = String.raw`Writing.<TOOL_USE>{"name":"create_file","arguments":{"path":"/tmp/main.cpp","content":"#include "main.hpp"`;

  assert.equal(classifyProviderOutputIntegrity(complete).kind, 'tool_call');
  assert.equal(classifyProviderOutputIntegrity(complete).toolCallCount, 1);
  assert.equal(classifyProviderOutputIntegrity(truncated).kind, 'truncated');
});

test('provider output integrity: accepts real malformed read-only DeepSeek calls as executable requests', () => {
  const grepResult = classifyProviderOutputIntegrity(
    '让我搜索 mc_log.h：[调用 grep_search] {"pattern": "mc_log\\.h", "path": "/tmp/project", "isRegexp": false, "maxResults": 10}',
  );
  const terminalResult = classifyProviderOutputIntegrity(
    '让我搜索文件：[调用 run_terminal] {"command": "find /tmp/project -name "mc_log.h" | head -5", "isBackground": false}',
  );

  assert.equal(grepResult.kind, 'tool_call');
  assert.equal(grepResult.toolCallCount, 1);
  assert.equal(terminalResult.kind, 'tool_call');
  assert.equal(terminalResult.toolCallCount, 1);
});

test('provider output integrity: classifies DeepSeek nameless artifact arrays as tool calls', () => {
  const result = classifyProviderOutputIntegrity([
    '现在创建核心代码文件。',
    '```',
    '[',
    '  {"path":"/tmp/app/worker.hpp","content":"#pragma once\\n"},',
    '  {"path":"/tmp/app/worker.cpp","content":"#include \\"worker.hpp\\"\\n"}',
    ']',
    '```',
  ].join('\n'));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 2);
});

test('provider output integrity: classifies fenced single artifact writes as tool calls', () => {
  const result = classifyProviderOutputIntegrity([
    '现在写入唯一交付物。',
    '```json',
    '{"path":"/tmp/app/docs/audit.md","content":"# Audit\\n"}',
    '```',
  ].join('\n'));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: does not execute ambiguous artifact-report JSON', () => {
  const result = classifyProviderOutputIntegrity([
    '# Artifact report',
    '```json',
    '[{"path":"/tmp/app/example.cpp","content":"int example;","description":"documentation example"}]',
    '```',
    '结论：该数组只是文档中的输出格式示例，不是需要执行的工具请求。',
  ].join('\n'));

  assert.equal(result.kind, 'complete_answer');
  assert.equal(result.okForSettlement, true);
  assert.equal(result.toolCallCount, 0);
});

test('provider output integrity: treats documented single-object artifact examples as answer text', () => {
  const result = classifyProviderOutputIntegrity([
    '# Artifact report',
    '```json',
    '{"path":"/tmp/app/example.md","content":"# Example\\n","description":"documentation example"}',
    '```',
    '结论：该对象只是文档中的输出格式示例，不是需要执行的工具请求。',
  ].join('\n'));

  assert.equal(result.kind, 'complete_answer');
  assert.equal(result.okForSettlement, true);
  assert.equal(result.toolCallCount, 0);
});

test('provider output integrity: classifies real generic TOOL envelopes before settlement', () => {
  const result = classifyProviderOutputIntegrity([
    '现在开始调查。',
    '<TOOL>read_file {"path":"/tmp/app/main.cpp"}</TOOL>',
    '<TOOL>grep_search {"pattern":"TunnelTransport","path":"/tmp/app"}</TOOL>',
  ].join(''));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 2);
});

test('provider output integrity: classifies adjacent open generic TOOL frames before settlement', () => {
  const result = classifyProviderOutputIntegrity([
    '现在开始调查。',
    '<TOOL>list_dir {"path":"/tmp/app"}',
    '<TOOL>file_search {"glob":"include/**/*.hpp"}',
    '<TOOL>read_file {"path":"/tmp/app/include/order_book.hpp"}',
  ].join(''));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 3);
});

test('provider output integrity: classifies named JSON tool_call envelopes before settlement', () => {
  const result = classifyProviderOutputIntegrity([
    'I will inspect the implementation first.',
    '<tool_call>{"name":"read_file","arguments":{"path":"/tmp/app/main.cpp"}}</tool_call>',
  ].join('\n'));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: rejects quote-damaged named tool_call writes as truncated', () => {
  const result = classifyProviderOutputIntegrity(String.raw`我将重写实现。
<tool_call name="create_file">{"path":"/tmp/project/src/order_book.cpp","content":"#include "order_book.hpp"\n#include <map>\n"}</tool_call>`);

  assert.equal(result.kind, 'truncated');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 0);
});

test('provider output integrity: rejects incomplete generic TOOL envelopes as truncated', () => {
  const result = classifyProviderOutputIntegrity(
    '现在读取实现。<TOOL>read_file {"path":"/tmp/app/main.cpp"',
  );

  assert.equal(result.kind, 'truncated');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 0);
});

test('provider output integrity: rejects an incomplete generic TOOL tail after a complete call', () => {
  const result = classifyProviderOutputIntegrity([
    '<TOOL>read_file {"path":"/tmp/app/main.cpp"}</TOOL>',
    '<TOOL>grep_search {"pattern":"TunnelTransport"',
  ].join(''));

  assert.equal(result.kind, 'truncated');
  assert.equal(result.okForSettlement, false);
});

test('provider output integrity: accepts complete tool call followed by provider footer', () => {
  const result = classifyProviderOutputIntegrity([
    '让我修复这些问题：',
    '[TOOL:read_file] {"path": "/tmp/app/main.cpp", "startLine": 1, "endLine": 20}',
    '',
    '本回答由 AI 生成，内容仅供参考，请仔细甄别',
  ].join('\n'));

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: classifies malformed DeepSeek function envelopes as executable tool calls', () => {
  const result = classifyProviderOutputIntegrity(
    '<TOOL_CALL>{"id":"2","type":"function","function":{"name":"list_dir","arguments":"{"path":"/home/ff/uav/tars/huida_uav/src/oam/src/license"}"}}</TOOL_CALL>',
  );

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: rejects safety-interstitial interrupted tool blocks as truncated', () => {
  const result = classifyProviderOutputIntegrity([
    '上次 Agent 输出被安全阻断（刚才）。',
    '等待重新生成安全响应。',
    'RESPONSE_CORRUPTED: incomplete-tool-block',
    '[TOOL:write_file {"path":"/tmp/app/docs/interrupted.md","content":"# interrupted',
  ].join('\n'));

  assert.equal(result.kind, 'truncated');
  assert.equal(result.okForSettlement, false);
});

test('provider output integrity: keeps malformed but recoverable write JSON in the tool channel', () => {
  const result = classifyProviderOutputIntegrity(
    '[TOOL:write_file] {"path":"/tmp/app/docs/replay.md","content":"line with "quoted" value"}',
  );

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: rejects short no-tool intent', () => {
  const result = classifyProviderOutputIntegrity('现在让我再查看几个关键文件来完整了解原实现的设计。');

  assert.equal(result.kind, 'short_intent');
  assert.equal(result.okForSettlement, false);
});

test('provider output integrity: rejects short report-generation intent after reads', () => {
  const result = classifyProviderOutputIntegrity('现在我已经完整查看了新需求文档、旧实现代码和旧设计文档。接下来将生成分析报告。');

  assert.equal(result.kind, 'short_intent');
  assert.equal(result.okForSettlement, false);
});

test('provider output integrity: rejects short enough-information transition before analysis', () => {
  const result = classifyProviderOutputIntegrity('现在我已经收集了足够的信息，让我分析新需求与现有实现的差异，并给出实现对策建议。');

  assert.equal(result.kind, 'short_intent');
  assert.equal(result.okForSettlement, false);
});

test('provider output integrity: classifies provider failure surfaces', () => {
  assert.equal(classifyProviderOutputIntegrity('').kind, 'empty');
  assert.equal(classifyProviderOutputIntegrity('LOGIN_REQUIRED').kind, 'login_required');
  assert.equal(classifyProviderOutputIntegrity('{"error":"LOGIN_REQUIRED"}').kind, 'login_required');
  assert.equal(classifyProviderOutputIntegrity('<html><title>Login</title>请先登录</html>').kind, 'login_required');
  assert.equal(classifyProviderOutputIntegrity('请输入验证码完成安全验证').kind, 'login_required');
  assert.equal(classifyProviderOutputIntegrity('<html><body>502 Bad Gateway</body></html>').kind, 'error_page');
  assert.equal(classifyProviderOutputIntegrity('RESPONSE_CORRUPTED: stream closed before completion').kind, 'truncated');
});

test('provider output integrity: does not classify business verification-code analysis as login required', () => {
  const result = classifyProviderOutputIntegrity(maintenanceAnalysis);

  assert.equal(result.kind, 'complete_answer');
  assert.equal(result.okForSettlement, true);
  assert.equal(result.hasAnswerEvidence, true);
});

test('provider output integrity: does not classify business service-busy analysis as provider error page', () => {
  const result = classifyProviderOutputIntegrity(
    '结论：服务繁忙问题需要在业务层增加重试提示和状态记录。依据：当前实现只记录请求失败，没有区分用户侧重试和后台排障。建议：补充状态机事件和可观测日志。',
  );

  assert.equal(result.kind, 'complete_answer');
  assert.equal(result.okForSettlement, true);
});

test('provider output integrity: keeps business verification-code tool response as tool request', () => {
  const result = classifyProviderOutputIntegrity(`${maintenanceAnalysis}\n[TOOL:task_complete {"summary":"完成维保码验证码流程分析。"}]`);

  assert.equal(result.kind, 'tool_call');
  assert.equal(result.okForSettlement, false);
  assert.equal(result.toolCallCount, 1);
});

test('provider output integrity: accepts concrete read-only answer evidence', () => {
  const result = classifyProviderOutputIntegrity(
    '结论：现有实现没有完成新的作业循环统计需求。依据：maintenance_threshold_engine.hpp 仍按旧阈值结构计算。建议：先拆状态机，再补验证。',
  );

  assert.equal(result.kind, 'complete_answer');
  assert.equal(result.okForSettlement, true);
});

console.log('\nProvider output integrity tests passed.\n');
