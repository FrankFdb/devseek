import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CanonicalProviderEventService,
  CanonicalToolDispatchService,
} from '../../../shared/dist/index.js';
import { loadUserSimulationCase } from '../../../../scripts/lib/devseek-user-simulation-fixture.mjs';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-vscode-provider-events-'));
const bundlePath = path.join(bundleRoot, 'provider-events.cjs');

execFileSync('npx', [
  'esbuild',
  'src/llm/provider-events.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
  '--external:vscode',
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const {
  bindProviderNormalizationBoundary,
  llmEventsToToolCallEnvelopes,
  normalizeProviderMessage,
} = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

test('I13-VSC-01 user journey: VS Code rejects invalid wiring and preserves workspace dispatch context', () => {
  const scenario = loadUserSimulationCase('I13', 'I13-VSC-01');
  const [envelope] = llmEventsToToolCallEnvelopes([{
    type: 'tool-call',
    provider: scenario.input.provider,
    workflowId: scenario.case_id,
    call: scenario.input.malformed_call,
  }]);

  assert.equal(envelope.decision, 'rejected');
  assert.equal(envelope.reason, 'malformed-tool-arguments');
  assert.equal(envelope.call.name, 'write_file');
  assert.equal(envelope.call.executable, false);
  assert.deepEqual(envelope.result.evidence, []);
  assert.throws(
    () => bindProviderNormalizationBoundary(new CanonicalProviderEventService(), undefined),
    /incomplete-normalization-ports/,
  );
  const boundary = bindProviderNormalizationBoundary(
    new CanonicalProviderEventService(),
    new CanonicalToolDispatchService(),
    { workspaceRoot: scenario.input.workspace_root },
  );
  const [native] = llmEventsToToolCallEnvelopes([{
    type: 'tool-call',
    provider: 'openai-compat',
    call: {
      function: {
        name: 'run_terminal',
        arguments: JSON.stringify({ command: scenario.input.inside_validation_command }),
      },
    },
  }], boundary);
  const fake = normalizeProviderMessage({
    type: 'message',
    provider: 'deepseek-api',
    content: `[TOOL:run_terminal ${JSON.stringify({ command: scenario.input.inside_validation_command })}]`,
  }, boundary).tools[0];
  const [outside] = llmEventsToToolCallEnvelopes([{
    type: 'tool-call',
    provider: 'openai-compat',
    call: {
      function: {
        name: 'run_terminal',
        arguments: JSON.stringify({ command: scenario.input.outside_validation_command }),
      },
    },
  }], boundary);

  assert.equal(native.call.risk, 'medium');
  assert.equal(fake.risk, 'medium');
  assert.equal(outside.call.risk, 'high');
});
