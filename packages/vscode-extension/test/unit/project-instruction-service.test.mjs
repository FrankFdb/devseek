/**
 * Unit tests for app/project-instruction-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/project-instruction-service.bundle.cjs');

execSync(
  `npx esbuild src/app/project-instruction-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ProjectInstructionService, wrapProjectInstructionsAsContext } = req(bundlePath);

function withTempWorkspace(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-instructions-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(root, relPath, content) {
  const absPath = path.join(root, relPath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

test('ProjectInstructionService: discovers DevSeek, Codex, Copilot, and Claude instructions', () => {
  withTempWorkspace((workspace) => {
    write(workspace, 'AGENTS.md', 'Use repo-wide agent rules.');
    write(workspace, '.devseek/rules.md', 'Use DevSeek rules.');
    write(workspace, '.github/copilot-instructions.md', 'Use Copilot rules.');
    write(workspace, 'CLAUDE.md', 'Use Claude rules.');

    const result = new ProjectInstructionService().discover({ workspaceRoots: [workspace] });

    assert.deepEqual(result.sources.map(source => source.relPath), [
      'AGENTS.md',
      '.devseek/rules.md',
      '.github/copilot-instructions.md',
      'CLAUDE.md',
    ]);
    assert.match(result.content, /\[来源: AGENTS\.md\]/);
    assert.match(result.content, /\[来源: \.devseek\/rules\.md\]/);
    assert.equal(result.budget.omittedSources.length, 0);
  });
});

test('ProjectInstructionService: scoped instructions closer to target path are included after root rules', () => {
  withTempWorkspace((workspace) => {
    const target = write(workspace, 'packages/app/src/main.ts', 'console.log("ok");');
    write(workspace, 'AGENTS.md', 'Root rule.');
    write(workspace, 'packages/app/AGENTS.md', 'Package rule.');
    write(workspace, 'packages/app/src/CLAUDE.md', 'Source rule.');

    const result = new ProjectInstructionService().discover({
      workspaceRoots: [workspace],
      targetPaths: [target],
    });

    assert.deepEqual(result.sources.map(source => source.relPath), [
      'AGENTS.md',
      'packages/app/AGENTS.md',
      'packages/app/src/CLAUDE.md',
    ]);
    assert.ok(
      result.content.indexOf('Root rule.') < result.content.indexOf('Package rule.'),
      'nearer scoped rules are appended after root rules',
    );
  });
});

test('ProjectInstructionService: skips scoped AGENTS.md that contains misplaced source implementation', () => {
  withTempWorkspace((workspace) => {
    const target = write(workspace, 'code/shape_manager/main.cpp', 'int main() { return 0; }\n');
    write(workspace, 'AGENTS.md', 'Use repo-wide rules. Do not run broad searches.');
    write(workspace, 'code/shape_manager/AGENTS.md', [
      '#include "Renderer.h"',
      '',
      'void ConsoleRenderer::drawPixel(int x, int y, char c) {',
      '    std::cout << c;',
      '}',
    ].join('\n'));

    const result = new ProjectInstructionService().discover({
      workspaceRoots: [workspace],
      targetPaths: [target],
    });

    assert.deepEqual(result.sources.map(source => source.relPath), ['AGENTS.md']);
    assert.match(result.content, /Use repo-wide rules/);
    assert.doesNotMatch(result.content, /ConsoleRenderer::drawPixel/);
  });
});

test('ProjectInstructionService: reports missing instructions and recommends init draft without writing', () => {
  withTempWorkspace((workspace) => {
    const result = new ProjectInstructionService().discover({ workspaceRoots: [workspace] });
    const missing = result.diagnostics.find(item => item.kind === 'missing-instructions');

    assert.deepEqual(result.sources, []);
    assert.equal(missing.severity, 'info');
    assert.equal(missing.recommendedInitTargetRelPath, '.devseek/rules.md');
    assert.equal(existsSync(path.join(workspace, '.devseek/rules.md')), false);
  });
});

test('ProjectInstructionService: reports scoped command conflicts with nearest rule as winner', () => {
  withTempWorkspace((workspace) => {
    const target = write(workspace, 'packages/app/src/main.ts', 'console.log("ok");');
    write(workspace, 'AGENTS.md', [
      '# Root rules',
      '- Always run `npm test` before finishing.',
    ].join('\n'));
    write(workspace, 'packages/app/AGENTS.md', [
      '# Package rules',
      '- Do not run `npm test` for this package.',
      '- Run `npm run test:app` instead.',
    ].join('\n'));

    const result = new ProjectInstructionService().discover({
      workspaceRoots: [workspace],
      targetPaths: [target],
    });
    const conflict = result.diagnostics.find(item => item.kind === 'scoped-conflict');

    assert.equal(conflict.severity, 'warning');
    assert.equal(conflict.ruleKey, 'command:npm test');
    assert.deepEqual(conflict.sources, ['AGENTS.md', 'packages/app/AGENTS.md']);
    assert.equal(conflict.winningRelPath, 'packages/app/AGENTS.md');
  });
});

test('ProjectInstructionService: reports per-source truncation and total budget omission', () => {
  withTempWorkspace((workspace) => {
    write(workspace, 'AGENTS.md', 'a'.repeat(40));
    write(workspace, '.devseek/rules.md', 'b'.repeat(40));

    const result = new ProjectInstructionService().discover({
      workspaceRoots: [workspace],
      maxCharsPerSource: 10,
      maxTotalChars: 80,
    });

    assert.ok(result.budget.truncatedSources.includes('AGENTS.md'));
    assert.ok(result.budget.omittedSources.length >= 1);
  });
});

test('wrapProjectInstructionsAsContext: wraps merged instruction content once', () => {
  const wrapped = wrapProjectInstructionsAsContext('[来源: AGENTS.md]\nRule');
  assert.match(wrapped, /^\[项目指令/);
  assert.match(wrapped, /\[\/项目指令\]$/);
});

console.log('\nProject instruction service tests passed.\n');
