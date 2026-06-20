/**
 * Unit tests for agent completion evidence.
 *
 * Claude Code/Codex-style contract: task_complete is only a closing signal.
 * A fix/edit request needs concrete edit evidence, and code edits need a
 * successful project-appropriate validation command before DevSeek can mark the
 * task complete.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/completion-evidence.bundle.cjs');

execSync(
  `npx esbuild src/agent/completion-evidence.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  coalesceWrittenFileEvidence,
  getMissingCompletionEvidence,
  isFileContentTerminalEvidenceCommand,
  isReadOnlyTerminalEvidenceCommand,
  requiresCodeArtifactForEvidence,
  requiresFileCheckEvidence,
  requiresFileContentReadEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
} = req(bundlePath);

const prompt = '修复 packages/vscode-extension/src/app/workflow-service.ts 中明显的小问题';

test('completion evidence: explicit fix request requires code edit evidence', () => {
  assert.equal(requiresCodeArtifactForEvidence(prompt), true);
  assert.deepEqual(
    getMissingCompletionEvidence(prompt, [], [], []),
    ['代码修改结果'],
  );
});

test('completion evidence: read-only analysis does not require code edit evidence', () => {
  assert.equal(
    requiresCodeArtifactForEvidence('只分析 packages/vscode-extension/src/app/workflow-service.ts 的问题，不要修改代码'),
    false,
  );
});

test('completion evidence: read-only file inspection needs read evidence, not write evidence', () => {
  const inspectPrompt = '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容。不要修改文件。';
  const hallucinatedWriteTodo = [{ title: '创建/更新文件' }];

  assert.equal(requiresReadEvidence(inspectPrompt), true);
  assert.equal(requiresFileContentReadEvidence(inspectPrompt), true);
  assert.equal(requiresFileChangeEvidence(`${inspectPrompt}\n创建/更新文件`), false);
  assert.deepEqual(
    getMissingCompletionEvidence(inspectPrompt, hallucinatedWriteTodo, [], [], []),
    ['文件内容读取结果'],
  );
  assert.deepEqual(
    getMissingCompletionEvidence(inspectPrompt, hallucinatedWriteTodo, [], [], ['docs/manual-phase5-smoke.md']),
    [],
  );
});

test('completion evidence: content display is not satisfied by existence-only terminal checks', () => {
  const inspectPrompt = '检查 docs/manual-phase5-smoke.md 是否存在，并显示文件内容。不要修改文件。';
  const testEvidence = [{ command: 'test -f docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }];
  const listEvidence = [{ command: 'ls -la docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }];
  const catEvidence = [{ command: 'cat docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }];

  assert.equal(isReadOnlyTerminalEvidenceCommand(testEvidence[0].command), true);
  assert.equal(isFileContentTerminalEvidenceCommand(testEvidence[0].command), false);
  assert.deepEqual(getMissingCompletionEvidence(inspectPrompt, [], [], testEvidence, []), ['文件内容读取结果']);
  assert.deepEqual(getMissingCompletionEvidence(inspectPrompt, [], [], listEvidence, []), ['文件内容读取结果']);
  assert.deepEqual(getMissingCompletionEvidence(inspectPrompt, [], [], catEvidence, []), []);
});

test('completion evidence: existence-only read-only checks can complete with test evidence', () => {
  const inspectPrompt = '检查 docs/manual-phase5-smoke.md 是否存在。不要修改文件。';
  const testEvidence = [{ command: 'test -f docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }];

  assert.equal(requiresReadEvidence(inspectPrompt), true);
  assert.equal(requiresFileContentReadEvidence(inspectPrompt), false);
  assert.deepEqual(getMissingCompletionEvidence(inspectPrompt, [], [], testEvidence, []), []);
});

test('completion evidence: common Chinese implementation wording requires code evidence', () => {
  assert.equal(requiresCodeArtifactForEvidence('写一个排序算法并放到 code 目录'), true);
});

test('completion evidence: markdown file creation requires file evidence but not code validation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-docs-'));
  try {
    const file = path.join(root, 'docs', 'manual-phase5-smoke.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '# Phase 5 smoke\n');
    const docsPrompt = '创建 docs/manual-phase5-smoke.md，内容为 Phase 5 smoke';

    assert.equal(requiresFileChangeEvidence(docsPrompt), true);
    assert.equal(requiresCodeArtifactForEvidence(docsPrompt), false);
    assert.deepEqual(
      getMissingCompletionEvidence(docsPrompt, [], [], []),
      ['文件修改结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        docsPrompt,
        [],
        [{ path: file, basename: 'manual-phase5-smoke.md', linesAdded: 1, linesRemoved: 0, action: 'create' }],
        [],
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: markdown creation verification is satisfied by file-check evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-docs-verify-'));
  try {
    const file = path.join(root, 'docs', 'manual-phase6-quality.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'phase6 quality gate smoke');
    const docsPrompt = '创建 docs/manual-phase6-quality.md，内容为：phase6 quality gate smoke，并验证文件创建成功。';
    const writeEvidence = [{ path: file, basename: 'manual-phase6-quality.md', linesAdded: 1, linesRemoved: 0, action: 'create' }];
    const fileCheckEvidence = [{
      command: "test -f 'docs/manual-phase6-quality.md' && wc -c 'docs/manual-phase6-quality.md' && sed -n '1,80p' 'docs/manual-phase6-quality.md'",
      kind: 'other',
      ok: true,
      exitCode: 0,
    }];

    assert.equal(requiresFileCheckEvidence(docsPrompt), true);
    assert.deepEqual(
      getMissingCompletionEvidence(docsPrompt, [], writeEvidence, []),
      ['文件读取/检查结果'],
    );
    assert.deepEqual(
      getMissingCompletionEvidence(docsPrompt, [], writeEvidence, fileCheckEvidence),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: coalesces repeated writes to the same file for UI and history accounting', () => {
  const merged = coalesceWrittenFileEvidence([
    {
      path: '/repo/packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
      basename: 'manual-phase6-quality-gate.ts',
      linesAdded: 1,
      linesRemoved: 0,
      action: 'create',
    },
    {
      path: '/repo/packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
      basename: 'manual-phase6-quality-gate.ts',
      linesAdded: 1,
      linesRemoved: 1,
      action: 'modify',
    },
  ], '/repo');

  assert.deepEqual(merged, [{
    path: '/repo/packages/vscode-extension/src/workspace/manual-phase6-quality-gate.ts',
    basename: 'manual-phase6-quality-gate.ts',
    linesAdded: 1,
    linesRemoved: 0,
    action: 'create',
  }]);
});

test('completion evidence: generic file todos do not turn markdown creation into code evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-docs-todo-'));
  try {
    const file = path.join(root, 'docs', 'manual-phase5-smoke.md');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '# Phase 5 smoke\nworkspace edit service manual test\n');
    const docsPrompt = '创建 docs/manual-phase5-smoke.md，内容为 # Phase 5 smoke workspace edit service manual test';
    const todos = [
      { title: '创建/更新文件' },
      { title: '编译/运行并验证结果' },
    ];

    assert.equal(
      requiresCodeArtifactForEvidence(`${docsPrompt}\n${todos.map(t => t.title).join('\n')}`),
      false,
    );
    assert.deepEqual(
      getMissingCompletionEvidence(
        docsPrompt,
        todos,
        [{ path: file, basename: 'manual-phase5-smoke.md', linesAdded: 2, linesRemoved: 0, action: 'create' }],
        [{ command: 'test -f docs/manual-phase5-smoke.md', kind: 'other', ok: true, exitCode: 0 }],
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completion evidence: code edit requires successful validation evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-completion-evidence-'));
  try {
    const file = path.join(root, 'packages', 'vscode-extension', 'src', 'app', 'workflow-service.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export const ok = true;\n');

    assert.deepEqual(
      getMissingCompletionEvidence(
        prompt,
        [],
        [{ path: file, basename: 'workflow-service.ts', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
        [],
      ),
      ['成功的编译/测试/语法验证命令结果'],
    );

    assert.deepEqual(
      getMissingCompletionEvidence(
        prompt,
        [],
        [{ path: file, basename: 'workflow-service.ts', linesAdded: 1, linesRemoved: 1, action: 'modify' }],
        [{ command: 'npm run compile', kind: 'compile', ok: true, exitCode: 0 }],
      ),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log('\nCompletion evidence tests passed.\n');
