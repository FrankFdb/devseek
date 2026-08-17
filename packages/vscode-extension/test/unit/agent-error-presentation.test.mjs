import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-error-presentation.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/agent-error-presentation.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const { presentAgentExecutionError } = req(bundlePath);

test('internal conformance codes remain diagnostics and never become user-facing copy', () => {
  const presentation = presentAgentExecutionError(
    new Error('coding-conformance-projection:unsettled-mutation:failed'),
  );

  assert.match(presentation.title, /证据结算失败/);
  assert.match(presentation.text, /不会把任务标记为完成/);
  assert.doesNotMatch(JSON.stringify(presentation), /coding-conformance-projection|unsettled-mutation/);
});

test('actionable external errors remain visible in compact form', () => {
  const presentation = presentAgentExecutionError(new Error('ENOENT: compiler g++ was not found'));

  assert.equal(presentation.title, 'Agent 执行未完成');
  assert.match(presentation.text, /g\+\+ was not found/);
});
