/**
 * Unit tests for restored Agentic history.
 *
 * Claude Code/Codex-style contract: a completed coding-agent turn keeps a
 * compact visible summary, while detailed plan/change/validation evidence
 * remains available behind collapsible history. Persisting only a one-line
 * "done" summary loses the information the user needs when reopening history.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-history.bundle.cjs');

execSync(
  `npx esbuild src/agent/agentic-history.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { buildAgenticHistoryText } = req(bundlePath);

test('Agentic history: free loop path must not persist thin one-line summaries', () => {
  const extensionSource = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
  const persistsThinSummary = /agentHistoryText\s*=\s*`\[Agentic\]\s*\$\{prompt\.slice\(0,\s*80\)\}\s*→\s*done/.test(extensionSource);

  assert.equal(
    persistsThinSummary,
    false,
    'free Agentic path should persist a collapsible evidence summary, not a thin "[Agentic] ... done" line',
  );
});

test('Agentic history: builds collapsible restored history with execution evidence', () => {
  const text = buildAgenticHistoryText({
    userPrompt: '创建 docs/manual-phase5-smoke.md，内容为：# Phase 5 smoke\nworkspace edit service manual test',
    roundCount: 1,
    completed: true,
    summary: '已创建文件并完成验证。',
    workspaceRoot: '/workspace/devseek',
    todos: [
      { id: 1, title: '创建/更新文件', status: 'completed' },
      { id: 2, title: '验证文件创建成功', status: 'completed' },
    ],
    writtenFiles: [
      {
        path: '/workspace/devseek/docs/manual-phase5-smoke.md',
        basename: 'manual-phase5-smoke.md',
        linesAdded: 2,
        linesRemoved: 0,
        action: 'create',
      },
    ],
    terminalEvidence: [
      {
        command: 'test -f /workspace/devseek/docs/manual-phase5-smoke.md && cat /workspace/devseek/docs/manual-phase5-smoke.md',
        kind: 'other',
        ok: true,
        exitCode: 0,
      },
    ],
  });

  assert.match(text, /\*\*\[Agentic\] 已完成（1 轮）\*\*/);
  assert.match(text, /<details class="agent-history-details">/);
  assert.match(text, /<summary>任务清单与执行证据<\/summary>/);
  assert.match(text, /创建\/更新文件/);
  assert.match(text, /docs\/manual-phase5-smoke\.md/);
  assert.match(text, /test -f \/workspace\/devseek\/docs\/manual-phase5-smoke\.md/);
  assert.doesNotMatch(text, /→\s*done/);
});
