/**
 * Unit tests for workspace/file-context-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('FileContextService: returns a moderate code file fully with explicit metadata', async () => {
  const dir = tempProject();
  try {
    writeFileSync(path.join(dir, 'main.cpp'), numberedLines(501), 'utf8');
    const service = new FileContextService({ workspaceRoot: dir });

    const result = await service.readFileForAi('main.cpp', { workDir: dir });

    assert.match(result, /truncated=false/);
    assert.match(result, /reason=full-file/);
    assert.match(result, /returnedLines=1-501\/501/);
    assert.match(result, /int line_501 = 501;/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('FileContextService: previews oversized files and tells the model how to continue', async () => {
  const dir = tempProject();
  try {
    writeFileSync(path.join(dir, 'large.cpp'), numberedLines(2501), 'utf8');
    const service = new FileContextService({ workspaceRoot: dir });

    const result = await service.readFileForAi('large.cpp', { workDir: dir });

    assert.match(result, /truncated=true/);
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

    assert.match(result, /truncated=true/);
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
