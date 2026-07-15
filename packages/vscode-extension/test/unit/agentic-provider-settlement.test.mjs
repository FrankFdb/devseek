/**
 * Unit tests for agentic provider-failure settlement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-provider-settlement.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-provider-settlement.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { settleProviderFailureFromCompletedEvidence } = req(bundlePath);

function filePrompt() {
  return [
    'UI-R1A1B-CLEAN2-20260715-4a148c',
    '请在当前工作区创建 ui-r1a1b-clean2-4a148c.txt。',
    '文件内容必须精确包含一行 UI_R1A1B_CLEAN2_OK。',
    '完成写入和读回验证后结束任务，不要修改其他用户文件。',
  ].join(' ');
}

test('provider failure settlement completes only after local file-check evidence satisfies the task', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-'));
  try {
    const file = path.join(root, 'ui-r1a1b-clean2-4a148c.txt');
    writeFileSync(file, 'UI_R1A1B_CLEAN2_OK\n');
    const writtenFiles = [{ path: file, basename: 'ui-r1a1b-clean2-4a148c.txt', linesAdded: 1, linesRemoved: 0, action: 'create' }];
    const terminalEvidence = [{
      command: "test -f 'ui-r1a1b-clean2-4a148c.txt' && wc -c 'ui-r1a1b-clean2-4a148c.txt' && sed -n '1,80p' 'ui-r1a1b-clean2-4a148c.txt'",
      kind: 'other',
      ok: true,
      exitCode: 0,
    }];

    const result = settleProviderFailureFromCompletedEvidence({
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      userPrompt: filePrompt(),
      todos: [{ title: '创建自然 UI 测试文件' }, { title: '读回并验证精确内容' }],
      writtenFiles,
      terminalEvidence,
      readEvidencePaths: [],
      workspaceRoot: root,
    });

    assert.equal(result.completed, true);
    assert.match(result.summary, /处理 1 个文件/);
    assert.match(result.summary, /验证证据已通过/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider failure settlement refuses missing or failed validation evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-blocked-'));
  try {
    const file = path.join(root, 'ui-r1a1b-clean2-4a148c.txt');
    writeFileSync(file, 'UI_R1A1B_CLEAN2_OK\n');
    const base = {
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      userPrompt: filePrompt(),
      todos: [{ title: '创建自然 UI 测试文件' }, { title: '读回并验证精确内容' }],
      writtenFiles: [{ path: file, basename: 'ui-r1a1b-clean2-4a148c.txt', linesAdded: 1, linesRemoved: 0, action: 'create' }],
      readEvidencePaths: [],
      workspaceRoot: root,
    };

    assert.equal(settleProviderFailureFromCompletedEvidence({ ...base, terminalEvidence: [] }).completed, false);
    assert.equal(settleProviderFailureFromCompletedEvidence({
      ...base,
      terminalEvidence: [{ command: 'g++ broken.cpp', kind: 'compile', ok: false, exitCode: 1 }],
    }).completed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
