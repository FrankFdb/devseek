/**
 * Unit tests for workspace/grep-search-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
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
    await assert.rejects(
      () => service.search({ pattern: 'secret', path: '/etc' }),
      /path outside workspace/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
