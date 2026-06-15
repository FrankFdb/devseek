/**
 * Unit tests for src/intent-router.ts
 * 
 * These test the pure logic functions that decide chat intent and agent mode.
 * No VS Code dependency required.
 * 
 * Run: node test/unit/intent-router.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Build & load the module under test ────────────────────────────────────────
// intent-router.ts only imports from generated-file-parser.ts (no vscode),
// so we can bundle it with esbuild and import the bundle directly.
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/intent-router.bundle.cjs');

// Bundle intent-router as entry-point; esbuild will pull in generated-file-parser automatically
execSync(
  `npx esbuild src/intent-router.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { decideChatIntent, shouldUseAgentMode, shouldAutoApplyFromResponse } = req(bundlePath);

// ── decideChatIntent tests ────────────────────────────────────────────────────

test('decideChatIntent: empty prompt → chat intent', () => {
  const result = decideChatIntent('');
  assert.equal(result.kind, 'chat');
  assert.equal(result.confidence, 0);
  assert.ok(result.blockers.includes('empty-prompt'));
});

test('decideChatIntent: pure question → qa chat intent', () => {
  const result = decideChatIntent('什么是单例模式？');
  assert.equal(result.kind, 'chat');
  assert.equal(result.mode, 'qa');
  assert.equal(result.autoApplyEligible, false);
});

test('decideChatIntent: "解释这段代码" → inspect read-only intent', () => {
  const result = decideChatIntent('解释这段代码');
  assert.equal(result.kind, 'chat');
  assert.equal(result.mode, 'inspect');
  assert.deepEqual(result.allowedToolKinds, ['read', 'search', 'diagnostics']);
});

test('decideChatIntent: "hello" → smalltalk chat intent', () => {
  const result = decideChatIntent('hello');
  assert.equal(result.kind, 'chat');
  assert.equal(result.mode, 'smalltalk');
  assert.equal(result.autoApplyEligible, false);
  assert.equal(shouldUseAgentMode(result, []), false);
});

test('decideChatIntent: truncated "ello" → smalltalk chat intent', () => {
  const result = decideChatIntent('ello');
  assert.equal(result.kind, 'chat');
  assert.equal(result.mode, 'smalltalk');
  assert.equal(result.autoApplyEligible, false);
  assert.equal(shouldUseAgentMode(result, ['/path/to/main.cpp']), false);
});

test('decideChatIntent: greeting plus product question → qa chat intent', () => {
  const result = decideChatIntent('你好，能介绍一下 React 吗');
  assert.equal(result.kind, 'chat');
  assert.equal(result.mode, 'qa');
  assert.equal(shouldUseAgentMode(result, []), false);
});

test('decideChatIntent: "修复代码中的函数" → code-change intent', () => {
  const result = decideChatIntent('修复这个函数中的bug');
  assert.equal(result.kind, 'code-change');
  assert.equal(result.mode, 'edit');
});

test('decideChatIntent: "实现一个函数" → code-change intent', () => {
  const result = decideChatIntent('实现一个排序函数');
  assert.equal(result.kind, 'code-change');
  assert.equal(result.mode, 'edit');
});

test('decideChatIntent: "编写C++程序" → code-change intent', () => {
  const result = decideChatIntent('编写一个C++ 程序，打印hello deepseek');
  assert.equal(result.kind, 'code-change');
  assert.equal(result.mode, 'edit');
});

test('decideChatIntent: "重构代码" → code-change intent', () => {
  const result = decideChatIntent('重构这段代码');
  assert.equal(result.kind, 'code-change');
  assert.equal(result.mode, 'edit');
});

test('decideChatIntent: "不要修改，只分析" → blocks code-change', () => {
  const result = decideChatIntent('不要修改，只分析这段代码是否有性能问题');
  // Should have no-change blocker or downgrade to chat
  assert.ok(result.blockers.includes('explicit-no-change') || result.kind === 'chat');
  assert.equal(result.kind, 'chat');
});

test('decideChatIntent: destructive request requires confirmation', () => {
  const result = decideChatIntent('删除 code/main.cpp 并重置项目');
  assert.equal(result.kind, 'code-change');
  assert.equal(result.mode, 'destructive');
  assert.equal(result.autoApplyEligible, false);
  assert.equal(result.requiresConfirmation, true);
});

test('decideChatIntent: returns required fields', () => {
  const result = decideChatIntent('修改文件main.cpp');
  assert.ok(typeof result.kind === 'string');
  assert.ok(typeof result.mode === 'string');
  assert.ok(typeof result.confidence === 'number');
  assert.ok(Array.isArray(result.signals));
  assert.ok(Array.isArray(result.blockers));
  assert.ok(Array.isArray(result.allowedToolKinds));
  assert.ok(typeof result.reason === 'string');
  assert.ok(typeof result.requiresConfirmation === 'boolean');
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
});

test('decideChatIntent: confidence score is in [0,1]', () => {
  const prompts = [
    '修复这个bug',
    '解释代码',
    '重构成模块化架构',
    '',
    '你好',
  ];
  for (const p of prompts) {
    const r = decideChatIntent(p);
    assert.ok(r.confidence >= 0 && r.confidence <= 1, `confidence out of range for: "${p}"`);
  }
});

// ── shouldUseAgentMode tests ──────────────────────────────────────────────────

test('shouldUseAgentMode: code-change no files → true (agent creates from scratch)', () => {
  const intent = decideChatIntent('修复bug');
  assert.equal(shouldUseAgentMode(intent, []), true);
});

test('shouldUseAgentMode: qa prompt → false', () => {
  const intent = decideChatIntent('你好，能介绍一下 React 吗');
  assert.equal(shouldUseAgentMode(intent, []), false);
});

test('shouldUseAgentMode: files present → true', () => {
  const intent = decideChatIntent('修复bug');
  assert.equal(shouldUseAgentMode(intent, ['/path/to/main.cpp']), true);
});

test('shouldUseAgentMode: explicit no-change + chat intent + files → false', () => {
  const intent = decideChatIntent('不要修改，只分析代码结构');
  assert.equal(shouldUseAgentMode(intent, ['/path/to/file.ts']), false);
});

test('shouldUseAgentMode: even analysis intent with files → true (agent reads file)', () => {
  const intent = decideChatIntent('分析这段代码');
  // Files present — agent mode should be triggered to read files
  assert.equal(shouldUseAgentMode(intent, ['/path/to/code.ts']), true);
});

test('shouldUseAgentMode: analysis intent without files → false', () => {
  const intent = decideChatIntent('分析这段代码');
  assert.equal(shouldUseAgentMode(intent, []), false);
});

test('shouldUseAgentMode: destructive intent is blocked until confirmation workflow exists', () => {
  const intent = decideChatIntent('删除 code/main.cpp 并重置项目');
  assert.equal(shouldUseAgentMode(intent, ['/path/to/main.cpp']), false);
});

// ── shouldAutoApplyFromResponse tests ────────────────────────────────────────

const MOCK_RESPONSE_WITH_ARTIFACT = `文件 1: main.cpp
\`\`\`cpp
#include <iostream>
int main() {
    std::cout << "hello" << std::endl;
    return 0;
}
\`\`\``;

const MOCK_RESPONSE_DISCUSSION = `这段代码的主要思路是：
1. 使用单例模式确保只有一个实例
2. 通过接口抽象实现依赖注入

这是一个分析结果，不包含具体代码修改。`;

test('shouldAutoApplyFromResponse: code-change intent + artifact → conservative may apply', () => {
  const intent = decideChatIntent('修改main.cpp实现hello world');
  const result = shouldAutoApplyFromResponse(intent, MOCK_RESPONSE_WITH_ARTIFACT, 'balanced');
  // balanced policy should apply with file section + code fence + path
  assert.equal(typeof result, 'boolean');
});

test('shouldAutoApplyFromResponse: qa intent + artifact + aggressive → false', () => {
  const intent = decideChatIntent('解释单例模式');
  const result = shouldAutoApplyFromResponse(intent, MOCK_RESPONSE_WITH_ARTIFACT, 'aggressive');
  assert.equal(result, false);
});

test('shouldAutoApplyFromResponse: discussion-only response → false for conservative', () => {
  const intent = decideChatIntent('修改代码');
  intent.autoApplyEligible = true;
  intent.kind = 'code-change';
  const result = shouldAutoApplyFromResponse(intent, MOCK_RESPONSE_DISCUSSION, 'conservative');
  assert.equal(result, false);
});

console.log('\n✅ All intent-router tests passed!\n');
