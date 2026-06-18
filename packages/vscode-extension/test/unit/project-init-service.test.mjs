/**
 * Unit tests for app/project-init-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/project-init-service.bundle.cjs');

execSync(
  `npx esbuild src/app/project-init-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ProjectInitService, isProjectInitRequest, renderProjectInitDraftMarkdown } = req(bundlePath);

function withTempWorkspace(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-init-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('ProjectInitService: generates a rules draft without writing it', () => {
  withTempWorkspace((workspace) => {
    writeFileSync(path.join(workspace, 'package.json'), '{"scripts":{"test":"node --test"}}', 'utf8');
    writeFileSync(path.join(workspace, 'tsconfig.json'), '{}', 'utf8');

    const draft = new ProjectInitService().generateDraft({
      workspaceRoot: workspace,
      projectName: 'demo',
    });

    assert.equal(draft.targetRelPath, '.devseek/rules.md');
    assert.equal(existsSync(draft.targetAbsPath), false, 'generateDraft should not write files');
    assert.deepEqual(draft.detectedFiles.sort(), ['package.json', 'tsconfig.json']);
    assert.ok(draft.detectedStacks.includes('Node.js / TypeScript or JavaScript'));
    assert.ok(draft.detectedStacks.includes('TypeScript'));
    assert.ok(draft.buildCommands.includes('npm run compile'));
    assert.ok(draft.testCommands.includes('npm test'));
    assert.match(draft.content, /Project: demo/);
    assert.match(draft.content, /Definition of Done/);
    assert.match(renderProjectInitDraftMarkdown(draft), /```md/);
  });
});

test('ProjectInitService: detects native and systems project commands', () => {
  withTempWorkspace((workspace) => {
    writeFileSync(path.join(workspace, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.20)', 'utf8');
    writeFileSync(path.join(workspace, 'Cargo.toml'), '[package]\nname = "demo"', 'utf8');
    writeFileSync(path.join(workspace, 'go.mod'), 'module demo', 'utf8');

    const draft = new ProjectInitService().generateDraft({ workspaceRoot: workspace });

    assert.ok(draft.detectedStacks.includes('C/C++ with CMake'));
    assert.ok(draft.detectedStacks.includes('Rust'));
    assert.ok(draft.detectedStacks.includes('Go'));
    assert.ok(draft.buildCommands.includes('cmake -S . -B build'));
    assert.ok(draft.testCommands.includes('cargo test'));
    assert.ok(draft.testCommands.includes('go test ./...'));
  });
});

test('ProjectInitService: detects slash init requests', () => {
  assert.equal(isProjectInitRequest('/init'), true);
  assert.equal(isProjectInitRequest('/init 请生成项目规则'), true);
  assert.equal(isProjectInitRequest('hello'), false);
});

console.log('\nProject init service tests passed.\n');
