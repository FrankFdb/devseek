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

  assert.equal(result.budget.version, 'devseek.context-budget/v1');
  assert.equal(result.budget.decision, 'replan');
  assert.equal(result.budget.replanRequired, true);
  assert.ok(result.budget.truncatedSources.includes('large'));
  assert.ok(result.budget.omittedSources.includes('late'));
  assert.ok(result.budget.omissionReport.some(item => item.id === 'large' && item.reason === 'preview-truncated-for-budget'));
  assert.ok(result.budget.omissionReport.some(item => item.id === 'late' && item.reason === 'context-budget-exhausted'));
  assert.ok(result.budget.usageBudget.omittedChars > 0);
  assert.equal(result.sources.find(source => source.id === 'large')?.truncated, true);
  assert.equal(result.sources.find(source => source.id === 'late')?.omitted, true);
});

test('ContextAssemblyService: critical evidence blocks instead of being truncated or omitted', () => {
  const result = new ContextAssemblyService().assemble('base', [
    {
      id: 'terminal-failure',
      kind: 'diagnostics',
      label: 'Terminal Failure',
      content: 'CRITICAL_TERMINAL_EVIDENCE '.repeat(8),
      priority: 100,
      critical: true,
    },
  ], { maxChars: 80 });

  const source = result.sources.find(item => item.id === 'terminal-failure');
  assert.equal(result.budget.decision, 'blocked');
  assert.equal(result.budget.replanRequired, true);
  assert.deepEqual(result.budget.blockedSources, ['terminal-failure']);
  assert.equal(source?.critical, true);
  assert.equal(source?.truncated, false);
  assert.equal(source?.omitted, true);
  assert.equal(source?.sourceIntegrity, 'omitted');
  assert.equal(source?.omissionReason, 'critical-evidence-exceeds-budget');
  assert.doesNotMatch(result.prompt, /CRITICAL_TERMINAL_EVIDENCE/);
});

test('ContextAssemblyService: critical evidence is included before lower-priority previews', () => {
  const result = new ContextAssemblyService().assemble('base', [
    { id: 'preview', kind: 'attachment', label: 'Preview', content: 'p'.repeat(200), priority: 1 },
    {
      id: 'critical-read',
      kind: 'diagnostics',
      label: 'Critical Read',
      content: 'MUST_KEEP_SOURCE_EVIDENCE',
      priority: 100,
      critical: true,
    },
  ], { maxChars: 130 });

  assert.ok(result.prompt.includes('MUST_KEEP_SOURCE_EVIDENCE'));
  assert.equal(result.budget.includedSources[0], 'critical-read');
  assert.equal(result.sources.find(source => source.id === 'critical-read')?.sourceIntegrity, 'full');
  assert.equal(result.sources.find(source => source.id === 'preview')?.sourceIntegrity, 'preview');
  assert.equal(result.budget.decision, 'replan');
  assert.equal(result.budget.usageBudget.criticalIncludedChars, 'MUST_KEEP_SOURCE_EVIDENCE'.length);
});

console.log('\nContext assembly service tests passed.\n');
