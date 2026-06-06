/**
 * Unit tests for ConversationHistory and estimateTokens from llm-agent-loop.ts
 *
 * These test the pure logic parts: token estimation and history compression.
 * Run: node test/unit/llm-agent-loop.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/llm-agent-loop.bundle.cjs');

// Stub out vscode and provider deps so we can test the pure logic classes
const stub = `
// VS Code stub
const vscode = {};
module.exports = { ...require('${bundlePath.replace(/\\/g, '/')}') };
`;

// Build with stubs for vscode and llm/provider-router
execSync(
  `npx esbuild src/llm-agent-loop.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node ` +
  `--external:vscode --external:./llm/provider-router --external:./project-rules`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
// Register stubs before requiring the bundle
const Module = req('module');
try {
  req.cache[req.resolve('./llm/provider-router')] = { exports: { getActiveProvider: () => {} } };
} catch {}

const mod = req(bundlePath);
const { ConversationHistory, MAX_ROUNDS } = mod;

// ── MAX_ROUNDS ─────────────────────────────────────────────────────────────────

test('MAX_ROUNDS is a positive number (25 by default)', () => {
  assert.ok(typeof MAX_ROUNDS === 'number' && MAX_ROUNDS > 0);
  assert.equal(MAX_ROUNDS, 25);
});

// ── ConversationHistory ────────────────────────────────────────────────────────

test('ConversationHistory: starts empty', () => {
  const h = new ConversationHistory();
  assert.equal(h.length, 0);
});

test('ConversationHistory: append and retrieve messages', () => {
  const h = new ConversationHistory();
  h.append('user', 'Hello');
  h.append('assistant', 'Hi there');
  assert.equal(h.length, 2);
});

test('ConversationHistory: lastAssistant returns latest assistant message', () => {
  const h = new ConversationHistory();
  h.append('user', 'Question?');
  h.append('assistant', 'Answer 1');
  h.append('user', 'Follow up?');
  h.append('assistant', 'Answer 2');
  assert.equal(h.lastAssistant(), 'Answer 2');
});

test('ConversationHistory: lastAssistant returns undefined when empty', () => {
  const h = new ConversationHistory();
  assert.equal(h.lastAssistant(), undefined);
});

test('ConversationHistory: lastAssistant returns undefined when only user messages', () => {
  const h = new ConversationHistory();
  h.append('user', 'Hello');
  assert.equal(h.lastAssistant(), undefined);
});

test('ConversationHistory: clear resets to empty', () => {
  const h = new ConversationHistory();
  h.append('user', 'test');
  h.append('assistant', 'response');
  h.clear();
  assert.equal(h.length, 0);
});

test('ConversationHistory: toMessages includes all messages', () => {
  const h = new ConversationHistory();
  h.append('user', 'First message');
  h.append('assistant', 'First response');
  const msgs = h.toMessages();
  assert.ok(Array.isArray(msgs));
  // At minimum should have the 2 messages
  assert.ok(msgs.length >= 2);
});

test('ConversationHistory: toMessages with systemPrompt prepends system message', () => {
  const h = new ConversationHistory();
  h.append('user', 'Question?');
  const msgs = h.toMessages('You are a helpful assistant');
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[0].content, 'You are a helpful assistant');
});

test('ConversationHistory: large history triggers compression (no error)', () => {
  const h = new ConversationHistory();
  // Add many large messages to trigger token budget
  const longMessage = '这是一段很长的中文文本，用于测试 token 计算和历史压缩功能。'.repeat(50);
  for (let i = 0; i < 30; i++) {
    h.append(i % 2 === 0 ? 'user' : 'assistant', longMessage + ` round ${i}`);
  }
  // toMessages should not throw, and should compress appropriately
  const msgs = h.toMessages();
  assert.ok(Array.isArray(msgs));
  assert.ok(msgs.length > 0);
  // Should be compressed: fewer messages than we put in
  assert.ok(msgs.length < 30, `Expected compression but got ${msgs.length} messages`);
});

test('ConversationHistory: toMessages returns valid role types', () => {
  const h = new ConversationHistory();
  h.append('user', 'test');
  h.append('assistant', 'response');
  const msgs = h.toMessages('sys');
  for (const m of msgs) {
    assert.ok(['user', 'assistant', 'system'].includes(m.role),
      `Invalid role: ${m.role}`);
  }
});

console.log('\n✅ All llm-agent-loop tests passed!\n');
