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
  getAgentProgressStageKey,
  inferAgentProgressStageTitle,
  buildAgentProgressDigest,
};
`, context);

test('WebviewAgentActivity: read/search/list share one context evidence stage key', () => {
  const policy = context.__activityPolicy;

  assert.equal(policy.getAgentProgressStageKey('read', '/workspace/src/main.cpp', ''), 'context-evidence');
  assert.equal(policy.getAgentProgressStageKey('search', 'TunnelTransport', ''), 'context-evidence');
  assert.equal(policy.getAgentProgressStageKey('list', '/workspace/src/oam', ''), 'context-evidence');
});

test('WebviewAgentActivity: progress digest summarizes engineering work instead of file repetition', () => {
  const policy = context.__activityPolicy;
  const digest = policy.buildAgentProgressDigest(
    { read: 5, search: 2, list: 1, terminal: 0, write: 0 },
    'read',
    '/workspace/src/oam/src/license/proc_license_main.cpp',
    '',
    'started',
  );

  assert.equal(digest.title, '正在收集项目证据');
  assert.match(digest.detail, /读取 5 个文件/);
  assert.match(digest.detail, /搜索 2 次/);
  assert.match(digest.detail, /查看 1 个目录/);
});

console.log('\nWebview agent activity tests passed.\n');
