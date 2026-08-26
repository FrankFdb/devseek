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
    '我将阅读用户故事并实现 Math Visual Lab 的第一版。让我先了解需求。',
  ), true);
  assert.equal(isDeferredAgentActionAnnouncement(
    'I will implement the request. Let me first inspect the project files.',
  ), true);
  assert.equal(isDeferredAgentActionAnnouncement(
    '现在我需要查看完整的 render() 函数。',
  ), true);
});

test('does not reinterpret complete answers or quoted action language', () => {
  assert.equal(isDeferredAgentActionAnnouncement('CPU 和 GPU 的主要区别是并行度与延迟取向。'), false);
  assert.equal(isDeferredAgentActionAnnouncement('“I will read the file” 的中文是“我会读取文件”。'), false);
  assert.equal(isDeferredAgentActionAnnouncement('“我将读取文件”是一种未来时表达。'), false);
  assert.equal(isDeferredAgentActionAnnouncement(''), false);
});

test('classifies visible deferred prose without executing long fenced presentation data', () => {
  const fencedPayload = [
    '```json',
    '[',
    ...Array.from({ length: 12 }, (_, index) => (
      `  {"id":"read_${index}","name":"read_file","args":{"path":"/workspace/source-${index}.cpp"}},`
    )),
    ']',
    '```',
  ].join('\n');
  const response = [
    '我已经找到绘制边界问题。让我修复这个问题并验证缩放布局。',
    '现在我需要查看完整渲染函数：',
    fencedPayload,
  ].join('\n\n');

  assert.ok(response.length > 600);
  assert.equal(isDeferredAgentActionAnnouncement(response), true);
  assert.equal(isDeferredAgentActionAnnouncement([
    '```text',
    '我将读取文件并修改实现。',
    '```',
  ].join('\n')), false);
});
