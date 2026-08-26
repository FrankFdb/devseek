/**
 * Unit tests for workspace/file-context-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/file-context-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/file-context-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { FileContextService } = req(bundlePath);

function tempProject() {
  return mkdtempSync(path.join(tmpdir(), 'devseek-file-context-'));
}

function numberedLines(count) {
  return Array.from({ length: count }, (_, index) => `int line_${index + 1} = ${index + 1};`).join('\n');
}

function duplicateSymbolFixture(totalLines = 320) {
  const lines = Array.from({ length: totalLines }, (_, index) => `const filler_${index + 1} = ${index + 1};`);
  lines[19] = 'function render() { return "first"; }';
  lines[259] = 'function render() { return "second"; }';
  return lines.join('\n');
}

test('FileContextService: returns a moderate code file fully with explicit metadata', async () => {
  const dir = tempProject();
  try {
    writeFileSync(path.join(dir, 'main.cpp'), numberedLines(501), 'utf8');
    const service = new FileContextService({ workspaceRoot: dir });

    const result = await service.readFileForAi('main.cpp', { workDir: dir });

    assert.match(result, /version=devseek\.file-context\/v1/);
    assert.match(result, /complete=true/);
    assert.match(result, /truncated=false/);
    assert.match(result, /omittedLines=0/);
    assert.match(result, /sourceIntegrity=full/);
    assert.match(result, /generatedFile=false/);
    assert.match(result, /reason=full-file/);
    assert.match(result, /returnedLines=1-501\/501/);
    assert.match(result, /int line_501 = 501;/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileContextService: rejects absolute and symlink reads outside the workspace', async () => {
  const workspace = tempProject();
  const outside = tempProject();
  try {
    const secret = path.join(outside, 'secret.txt');
    writeFileSync(secret, 'must-not-reach-provider', 'utf8');
    symlinkSync(secret, path.join(workspace, 'linked-secret.txt'));
    const service = new FileContextService({ workspaceRoot: workspace });

    await assert.rejects(
      service.readFileForAi(secret),
      /read_file:target-outside-workspace/,
    );
    await assert.rejects(
      service.readFileForAi('linked-secret.txt', { workDir: workspace }),
      /read_file:target-outside-workspace/,
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('FileContextService: never exposes the internal bridge credential', async () => {
  const workspace = tempProject();
  try {
    const internalDir = path.join(workspace, '.devseek');
    mkdirSync(internalDir, { recursive: true });
    writeFileSync(path.join(internalDir, 'bridge-token'), 'live-secret-token', 'utf8');
    writeFileSync(path.join(internalDir, 'bridge-process.log'), 'diagnostic-only', 'utf8');
    const service = new FileContextService({ workspaceRoot: workspace });

    await assert.rejects(
      service.readFileForAi('.devseek/bridge-token', { workDir: workspace }),
      /read_file:protected-devseek-credential/,
    );
    const diagnostic = await service.readFileForAi('.devseek/bridge-process.log', { workDir: workspace });
    assert.match(diagnostic, /diagnostic-only/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('FileContextService: suggests bounded workspace paths when a guessed file location is missing', async () => {
  const workspace = tempProject();
  try {
    mkdirSync(path.join(workspace, 'include'), { recursive: true });
    mkdirSync(path.join(workspace, 'src', 'detail'), { recursive: true });
    mkdirSync(path.join(workspace, '.devseek'), { recursive: true });
    mkdirSync(path.join(workspace, 'node_modules', 'hidden'), { recursive: true });
    writeFileSync(path.join(workspace, 'include', 'lesson_controller.hpp'), '// public header', 'utf8');
    writeFileSync(path.join(workspace, 'src', 'detail', 'lesson_controller.hpp'), '// detail header', 'utf8');
    writeFileSync(path.join(workspace, '.devseek', 'lesson_controller.hpp'), '// internal', 'utf8');
    writeFileSync(path.join(workspace, 'node_modules', 'hidden', 'lesson_controller.hpp'), '// dependency', 'utf8');
    const service = new FileContextService({ workspaceRoot: workspace });

    await assert.rejects(
      service.readFileForAi('src/lesson_controller.hpp', { workDir: workspace }),
      (error) => {
        assert.match(error.message, /工作区同名候选：include\/lesson_controller\.hpp、src\/detail\/lesson_controller\.hpp/);
        assert.doesNotMatch(error.message, /\.devseek|node_modules/);
        return true;
      },
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('FileContextService: limits missing-path suggestions deterministically', async () => {
  const workspace = tempProject();
  try {
    for (let index = 0; index < 7; index += 1) {
      const candidateDir = path.join(workspace, `candidate-${index}`);
      mkdirSync(candidateDir, { recursive: true });
      writeFileSync(path.join(candidateDir, 'shared.hpp'), `// candidate ${index}`, 'utf8');
    }
    const service = new FileContextService({ workspaceRoot: workspace });

    await assert.rejects(
      service.readFileForAi('missing/shared.hpp', { workDir: workspace }),
      (error) => {
        assert.match(error.message, /candidate-0\/shared\.hpp/);
        assert.match(error.message, /candidate-4\/shared\.hpp/);
        assert.doesNotMatch(error.message, /candidate-[56]\/shared\.hpp/);
        return true;
      },
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('FileContextService: previews oversized files and tells the model how to continue', async () => {
  const dir = tempProject();
  try {
    writeFileSync(path.join(dir, 'large.cpp'), numberedLines(2501), 'utf8');
    const service = new FileContextService({ workspaceRoot: dir });

    const result = await service.readFileForAi('large.cpp', { workDir: dir });

    assert.match(result, /complete=false/);
    assert.match(result, /truncated=true/);
    assert.match(result, /omittedLines=2261/);
    assert.match(result, /sourceIntegrity=preview/);
    assert.match(result, /reason=file-too-large-preview/);
    assert.match(result, /returnedLines=1-240\/2501/);
    assert.match(result, /next=use read_file with startLine\/endLine/);
    assert.doesNotMatch(result, /int line_241 = 241;/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileContextService: supports targeted range reads for large files', async () => {
  const dir = tempProject();
  try {
    writeFileSync(path.join(dir, 'large.cpp'), numberedLines(2501), 'utf8');
    const service = new FileContextService({ workspaceRoot: dir });

    const result = await service.readFileForAi('large.cpp', { workDir: dir, startLine: 300, endLine: 320 });

    assert.match(result, /complete=false/);
    assert.match(result, /truncated=true/);
    assert.match(result, /omittedLines=2480/);
    assert.match(result, /sourceIntegrity=range/);
    assert.match(result, /reason=requested-range/);
    assert.match(result, /returnedLines=300-320\/2501/);
    assert.match(result, /int line_300 = 300;/);
    assert.match(result, /int line_320 = 320;/);
    assert.doesNotMatch(result, /int line_299 = 299;/);
    assert.doesNotMatch(result, /int line_321 = 321;/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileContextService: marks generated large files as incomplete generated previews', async () => {
  const dir = tempProject();
  try {
    const distDir = path.join(dir, 'dist');
    writeFileSync(path.join(dir, 'README.md'), 'source project\n', 'utf8');
    mkdirSync(distDir, { recursive: true });
    const generated = [
      '// AUTO-GENERATED FILE - DO NOT EDIT',
      ...Array.from({ length: 319 }, (_, index) => `function bundle_${index + 1}() { return ${index + 1}; }`),
    ].join('\n');
    writeFileSync(path.join(distDir, 'bundle.js'), generated, 'utf8');
    const service = new FileContextService({ workspaceRoot: dir, maxFullLines: 200 });

    const result = await service.readFileForAi('dist/bundle.js', { workDir: dir });

    assert.match(result, /generatedFile=true/);
    assert.match(result, /generatedReason=.*path-boundary/);
    assert.match(result, /generatedReason=.*content-marker/);
    assert.match(result, /complete=false/);
    assert.match(result, /sourceIntegrity=generated-preview/);
    assert.match(result, /omittedLines=80/);
    assert.match(result, /returnedLines=1-240\/320/);
    assert.match(result, /next=use read_file with startLine\/endLine/);
    assert.doesNotMatch(result, /function bundle_240\(\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileContextService: emits line-scoped symbol outline for same-name symbols outside the returned range', async () => {
  const dir = tempProject();
  try {
    writeFileSync(path.join(dir, 'large.js'), duplicateSymbolFixture(), 'utf8');
    const service = new FileContextService({ workspaceRoot: dir, maxFullLines: 200 });

    const result = await service.readFileForAi('large.js', { workDir: dir });

    assert.match(result, /symbolOutlineCount=2/);
    assert.match(result, /symbolOutline=function render line=20 duplicateIndex=1 inReturnedRange=true/);
    assert.match(result, /symbolOutline=function render line=260 duplicateIndex=2 inReturnedRange=false/);
    assert.match(result, /sameNameSymbolGroups=render:2/);
    assert.match(result, /function render\(\) \{ return "first"; \}/);
    assert.doesNotMatch(result, /function render\(\) \{ return "second"; \}/);
    assert.match(result, /complete=false/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
