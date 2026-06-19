/**
 * Unit tests for terminal command risk classification.
 *
 * Claude Code/Codex-style contract: low-risk workspace inspection should stay
 * low-friction, while writes and arbitrary execution keep an explicit boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/terminal-command-policy.bundle.cjs');

execSync(
  `npx esbuild src/app/terminal-command-policy.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { decideTerminalCommandPermission } = req(bundlePath);

const workspaceRoot = '/workspace/devseek';

test('TerminalCommandPolicy: allows workspace read-only ls/test/head commands without confirmation', () => {
  assert.deepEqual(
    decideTerminalCommandPermission({
      command: 'ls -la /workspace/devseek/docs/manual-phase5-smoke.md 2>&1 || echo "文件不存在"',
      workspaceRoot,
    }),
    { risk: 'read-only', requiresConfirmation: false, canRememberDecision: true, reason: 'read-only-workspace-inspection' },
  );
  assert.equal(
    decideTerminalCommandPermission({
      command: 'test -f /workspace/devseek/docs/manual-phase5-smoke.md && echo "文件存在" && cat /workspace/devseek/docs/manual-phase5-smoke.md',
      workspaceRoot,
    }).requiresConfirmation,
    false,
  );
  assert.equal(
    decideTerminalCommandPermission({
      command: 'ls -la /workspace/devseek/docs 2>&1 | head -20',
      workspaceRoot,
    }).requiresConfirmation,
    false,
  );
});

test('TerminalCommandPolicy: confirms read-only commands outside the workspace', () => {
  const decision = decideTerminalCommandPermission({
    command: 'ls -la /etc',
    workspaceRoot,
  });

  assert.equal(decision.requiresConfirmation, true);
  assert.equal(decision.risk, 'unknown');
  assert.match(decision.reason, /outside-workspace/);
});

test('TerminalCommandPolicy: confirms validation commands but allows remembering that class', () => {
  const decision = decideTerminalCommandPermission({
    command: 'npx tsc --noEmit packages/vscode-extension/src/workspace/manual-phase5-smoke.ts',
    workspaceRoot,
  });

  assert.equal(decision.risk, 'validation');
  assert.equal(decision.requiresConfirmation, true);
  assert.equal(decision.canRememberDecision, true);
});

test('TerminalCommandPolicy: confirms shell writes and destructive commands', () => {
  assert.equal(
    decideTerminalCommandPermission({
      command: 'python3 -c "with open(\'/workspace/devseek/docs/manual-phase5-smoke.md\', \'w\') as f: f.write(\'x\')"',
      workspaceRoot,
    }).risk,
    'mutating',
  );
  assert.equal(
    decideTerminalCommandPermission({
      command: 'rm -rf /workspace/devseek/docs',
      workspaceRoot,
    }).risk,
    'destructive',
  );
});

console.log('\nTerminal command policy tests passed.\n');
