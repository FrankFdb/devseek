import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-agentic-summary-'));
const bundlePath = path.join(tempRoot, 'agentic-summary.cjs');

execSync(
  `npx esbuild src/agent/agentic-summary.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { isDeferredAgentActionAnnouncement } = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('recognizes bounded Chinese and English future tool-action announcements', () => {
  assert.equal(isDeferredAgentActionAnnouncement(
    '我将阅读需求文档，然后实现程序。让我先获取项目文件。',
  ), true);
  assert.equal(isDeferredAgentActionAnnouncement(
    'I will implement the request. Let me first inspect the project files.',
  ), true);
});

test('does not reinterpret complete answers or quoted action language', () => {
  assert.equal(isDeferredAgentActionAnnouncement('CPU 和 GPU 的主要区别是并行度与延迟取向。'), false);
  assert.equal(isDeferredAgentActionAnnouncement('“I will read the file” 的中文是“我会读取文件”。'), false);
  assert.equal(isDeferredAgentActionAnnouncement(''), false);
});
