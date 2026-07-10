/**
 * Unit tests for webview agent activity presentation policy.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const source = readFileSync(path.join(rootDir, 'media/webview-agent-activity.js'), 'utf8');
const webviewSource = readFileSync(path.join(rootDir, 'media/webview.js'), 'utf8');
const context = {
  escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },
};

vm.createContext(context);
vm.runInContext(`${source}
globalThis.__activityPolicy = {
  formatAgentToolActivityStep,
  decideAgentProgressTransition,
  formatAgentActivitySummary,
  shouldStartNewAgentProgressGroup,
};
`, context);

test('WebviewAgentActivity: details retain concrete file operations', () => {
  const policy = context.__activityPolicy;
  const detail = policy.formatAgentToolActivityStep('read', '/workspace/src/main.cpp');
  assert.equal(detail.icon, 'codicon-file-text');
  assert.match(detail.html, /已读取/);
  assert.match(detail.html, /main\.cpp/);
});

test('WebviewAgentActivity: webview renders presenter summaries and keeps details collapsible', () => {
  assert.match(webviewSource, /function applyPresentedAgentProgress/);
  assert.match(webviewSource, /msg\.progressTitle/);
  assert.match(webviewSource, /data-presented-progress/);
  assert.match(webviewSource, /<details class="aut-details" open>/);
  assert.match(webviewSource, /autDets\.removeAttribute\('open'\)/);
  assert.doesNotMatch(webviewSource, /buildAgentProgressDigest/);
  assert.doesNotMatch(source, /inferAgentProgressStageTitle/);
});

test('WebviewAgentActivity: every semantic stage transition starts a durable timeline group', () => {
  const policy = context.__activityPolicy;
  assert.equal(policy.shouldStartNewAgentProgressGroup('context', 'context'), false);
  assert.equal(policy.shouldStartNewAgentProgressGroup('context', 'implementation'), true);
  assert.equal(policy.shouldStartNewAgentProgressGroup('implementation', 'validation'), true);
  assert.equal(policy.shouldStartNewAgentProgressGroup('validation', 'delivery'), true);
  assert.equal(policy.shouldStartNewAgentProgressGroup('validation', 'recovery'), true);
});

test('WebviewAgentActivity: status milestones are preserved while their tool details accumulate', () => {
  const policy = context.__activityPolicy;
  assert.equal(
    policy.decideAgentProgressTransition('context', '正在调查项目', 'status', 'context', '正在读取 main.cpp', 'activity'),
    'keep-summary',
  );
  assert.equal(
    policy.decideAgentProgressTransition('context', '正在调查项目', 'status', 'context', '已确认通信链路', 'status'),
    'new-group',
  );
  assert.equal(
    policy.decideAgentProgressTransition('context', '正在调查项目', 'status', 'validation', '正在验证实现', 'status'),
    'new-group',
  );
  assert.equal(
    policy.decideAgentProgressTransition('context', '正在调查项目', 'status', 'context', '正在调查项目', 'status'),
    'update',
  );
});

test('WebviewAgentActivity: collapsed details summarize concrete work instead of repeating the milestone', () => {
  const policy = context.__activityPolicy;
  assert.equal(policy.formatAgentActivitySummary({ read: 4, search: 2, terminal: 1 }), '读取文件、搜索代码并运行命令');
  assert.equal(policy.formatAgentActivitySummary({ write: 2 }), '修改文件');
  assert.equal(policy.formatAgentActivitySummary({}), '');
});

console.log('\nWebview agent activity tests passed.\n');
