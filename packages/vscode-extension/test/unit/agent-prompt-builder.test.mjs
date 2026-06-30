/**
 * Unit tests for agent/agent-prompt-builder.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-prompt-builder.bundle.cjs');

execSync(
  `npx esbuild src/agent/agent-prompt-builder.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildLocalRespondTaskMessage,
  buildToolsSuffix,
} = req(bundlePath);

test('AgentPromptBuilder: tool suffix advertises range reads and withholds premature completion', () => {
  const firstOfTwo = buildToolsSuffix(1, 2, undefined, '/tmp/project');
  assert.match(firstOfTwo, /startLine":300,"endLine":520/);
  assert.match(firstOfTwo, /workdir":"\/tmp\/project"/);
  assert.doesNotMatch(firstOfTwo, /task_complete/);

  const last = buildToolsSuffix(2, 2);
  assert.match(last, /task_complete/);
  assert.match(last, /SOLID、DRY、KISS/);
});

test('AgentPromptBuilder: local recovery message stays read-only without task facts', () => {
  const message = buildLocalRespondTaskMessage(
    { targetKind: 'unknown', action: 'analyze', description: 'recover' },
    '改为鼠标点击选择图形'.repeat(20),
  );

  assert.match(message, /没有找到足够的可信任务事实/);
  assert.match(message, /原始请求摘要：/);
});
