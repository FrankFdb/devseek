/**
 * Unit tests for app/read-only-inspection-service.ts.
 *
 * Claude Code/Codex-style contract: a simple read-only file check should be
 * handled by deterministic workspace reads, not by a multi-round agent loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/read-only-inspection-service.bundle.cjs');

execSync(
  `npx esbuild src/app/read-only-inspection-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { tryBuildReadOnlyInspectionResult } = req(bundlePath);

test('ReadOnlyInspectionService: exact Phase 5 smoke prompt returns file content directly', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-readonly-inspection-'));
  try {
    const file = path.join(workspaceRoot, 'docs', 'manual-phase5-smoke.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '# Phase 5 smoke\nworkspace edit service manual test\n');

    const result = tryBuildReadOnlyInspectionResult({
      workspaceRoot,
      prompt: '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容。不要修改文件。',
    });

    assert.ok(result);
    assert.equal(result.relativePath, 'docs/manual-phase5-smoke.md');
    assert.equal(result.exists, true);
    assert.equal(result.wantsContent, true);
    assert.match(result.text, /检查结果：`docs\/manual-phase5-smoke\.md` 存在。/);
    assert.match(result.text, /# Phase 5 smoke/);
    assert.match(result.text, /workspace edit service manual test/);
    assert.match(result.text, /未修改任何文件/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ReadOnlyInspectionService: missing file is a completed read-only answer, not an edit task', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-readonly-missing-'));
  try {
    const result = tryBuildReadOnlyInspectionResult({
      workspaceRoot,
      prompt: '确认 docs/missing.md 是否存在。不要修改文件。',
    });

    assert.ok(result);
    assert.equal(result.relativePath, 'docs/missing.md');
    assert.equal(result.exists, false);
    assert.match(result.text, /不存在/);
    assert.match(result.text, /未修改任何文件/);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ReadOnlyInspectionService: complex analysis remains in the agent path', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-readonly-complex-'));
  try {
    const file = path.join(workspaceRoot, 'packages', 'vscode-extension', 'src', 'app', 'workflow-service.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export const ok = true;\n');

    const result = tryBuildReadOnlyInspectionResult({
      workspaceRoot,
      prompt: '审计 packages/vscode-extension/src/app/workflow-service.ts 的设计问题，不要修改代码。',
    });

    assert.equal(result, null);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('ReadOnlyInspectionService: empty workspace root is not resolved to process cwd', () => {
  const result = tryBuildReadOnlyInspectionResult({
    workspaceRoot: '',
    prompt: '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容。不要修改文件。',
  });

  assert.equal(result, null);
});

test('ReadOnlyInspectionService: workspace symlinks cannot read outside the workspace', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-readonly-symlink-ws-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'devseek-readonly-symlink-out-'));
  try {
    mkdirSync(path.join(workspaceRoot, 'docs'), { recursive: true });
    const outsideFile = path.join(outsideRoot, 'secret.md');
    writeFileSync(outsideFile, 'outside workspace\n');
    symlinkSync(outsideFile, path.join(workspaceRoot, 'docs', 'linked.md'));

    const result = tryBuildReadOnlyInspectionResult({
      workspaceRoot,
      prompt: '检查 docs/linked.md 是否存在，并显示文件内容。不要修改文件。',
    });

    assert.equal(result, null);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

console.log('\nRead-only inspection service tests passed.\n');
