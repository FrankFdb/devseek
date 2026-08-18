/**
 * Unit tests for workspace/grep-search-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/grep-search-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/grep-search-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { WorkspaceGrepSearchService } = req(bundlePath);

test('WorkspaceGrepSearchService: honors fileTypes and validates workspace boundary', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-grep-search-'));
  try {
    let capturedCommand = '';
    const service = new WorkspaceGrepSearchService(dir, async args => {
      capturedCommand = args.command;
      return { stdout: 'main.cpp:1:glutMouseFunc' };
    });

    const result = await service.search({
      pattern: 'glutMouseFunc|mouse',
      path: '.',
      includePattern: '.cpp,.h',
    });

    assert.equal(result, 'main.cpp:1:glutMouseFunc');
    assert.match(capturedCommand, /--include='\*\.cpp'/);
    assert.match(capturedCommand, /--include='\*\.h'/);
    assert.doesNotMatch(capturedCommand, /--include='\*\.ts'/);
    assert.match(capturedCommand, /grep -r -n -E 'glutMouseFunc\|mouse'/);
    assert.match(capturedCommand, /--exclude-dir='\.devseek'/);
    assert.match(capturedCommand, /--exclude-dir='node_modules'/);
    await assert.rejects(
      () => service.search({ pattern: 'secret', path: '/etc' }),
      /path outside workspace/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceGrepSearchService: internal run logs cannot pollute model search context', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-grep-isolation-'));
  try {
    const sourceDir = path.join(dir, 'packages/demo/src');
    const internalDir = path.join(dir, '.devseek/runs');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(internalDir, { recursive: true });
    writeFileSync(path.join(sourceDir, 'owner.cpp'), 'void publishEventWithAttempt();\n');
    writeFileSync(
      path.join(internalDir, 'provider.log'),
      'poisoned prompt says publishEventWithAttempt and must never re-enter context\n',
    );

    const service = new WorkspaceGrepSearchService(dir, async args => ({
      stdout: execSync(args.command, {
        encoding: 'utf8',
        timeout: args.timeoutMs,
      }),
    }));
    const result = await service.search({
      pattern: 'publishEventWithAttempt',
      path: '.',
      workDir: dir,
      fileTypes: '.cpp,.log',
    });

    assert.match(result, /owner\.cpp/);
    assert.doesNotMatch(result, /provider\.log|poisoned prompt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
