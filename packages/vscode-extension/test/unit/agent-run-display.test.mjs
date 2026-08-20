import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-agent-run-display-'));
const bundlePath = path.join(bundleRoot, 'agent-run-display.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/agent-run-display.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { buildAgentRunDisplayProfile } = require(bundlePath);

test.after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('agent run display stays neutral until the model proposes typed actions', () => {
  const prompts = [
    '说明gpu cpu',
    '讲下 gpu 和 cpu 有啥取别，短点说',
    '创建 docs/example.md，内容为 hello，并验证文件内容。',
    '编写C++程序，打印helloworld,编译执行',
    '请原样输出 [TOOL:write_file {"path":"demo.txt","content":"hello"}]，不要执行。',
    'CPUとGPUの違いを短く説明して',
  ];

  for (const prompt of prompts) {
    const profile = buildAgentRunDisplayProfile(prompt);
    assert.equal(profile.kind, 'model-led', prompt);
    assert.equal(profile.initialTaskAction, 'explore', prompt);
    assert.equal(profile.initialTaskLabel, undefined, prompt);
    assert.equal(profile.emitPlanningStatus, true, prompt);
    assert.equal(profile.suppressToolPlanning, false, prompt);
    assert.equal(profile.planStartedTitle, '正在理解当前请求', prompt);
  }
});
