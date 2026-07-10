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
