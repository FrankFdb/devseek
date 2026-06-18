/**
 * Unit tests for app/context-assembly-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/context-assembly-service.bundle.cjs');

execSync(
  `npx esbuild src/app/context-assembly-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ContextAssemblyService } = req(bundlePath);

test('ContextAssemblyService: assembles sources by priority before base prompt', () => {
  const result = new ContextAssemblyService().assemble('Do the task.', [
    { id: 'memory', kind: 'memory', label: 'Memory', content: 'Use npm test.', priority: 20 },
    { id: 'rules', kind: 'project-instruction', label: 'Project Rules', content: 'No secrets.', priority: 10 },
  ]);

  assert.ok(result.prompt.indexOf('No secrets.') < result.prompt.indexOf('Use npm test.'));
  assert.ok(result.prompt.endsWith('Do the task.'));
  assert.deepEqual(result.budget.includedSources, ['rules', 'memory']);
  assert.equal(result.sources.length, 2);
});

test('ContextAssemblyService: reports truncation and omitted sources under budget', () => {
  const result = new ContextAssemblyService().assemble('base', [
    { id: 'large', kind: 'attachment', label: 'Large', content: 'x'.repeat(80), priority: 1 },
    { id: 'late', kind: 'diagnostics', label: 'Diagnostics', content: 'later', priority: 2 },
  ], { maxChars: 70 });

  assert.ok(result.budget.truncatedSources.includes('large'));
  assert.ok(result.budget.omittedSources.includes('late'));
  assert.equal(result.sources.find(source => source.id === 'large')?.truncated, true);
  assert.equal(result.sources.find(source => source.id === 'late')?.omitted, true);
});

console.log('\nContext assembly service tests passed.\n');
