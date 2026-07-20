/**
 * Unit tests for agent/tool-call-normalizer.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/tool-call-normalizer.bundle.cjs');

execSync(
  `npx esbuild src/agent/tool-call-normalizer.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  TOOL_CALL_NORMALIZATION_PROTOCOL_VERSION,
  normalizeToolCall,
  normalizeToolCallEnvelope,
  toolCallToFakeTool,
} = req(bundlePath);

function comparable(call) {
  return {
    name: call.name,
    input: call.input,
    registered: call.registered,
    kind: call.kind,
    risk: call.risk,
    executable: call.executable,
  };
}

test('ToolCallNormalizer: fake and native tool calls normalize to the same contract', () => {
  const fake = normalizeToolCall({ name: 'read_file', input: { path: 'src/index.ts' } });
  const native = normalizeToolCall({
    id: 'call_1',
    function: {
      name: 'read_file',
      arguments: JSON.stringify({ path: 'src/index.ts' }),
    },
  });

  assert.deepEqual(comparable(fake), comparable(native));
  assert.deepEqual(toolCallToFakeTool(native), { name: 'read_file', input: { path: 'src/index.ts' } });
});

test('ToolCallNormalizer: unknown native tools stay visible but unregistered', () => {
  const call = normalizeToolCall({
    function: {
      name: 'unknown_magic',
      arguments: '{}',
    },
  });

  assert.equal(call.registered, false);
  assert.equal(call.kind, 'plan');
  assert.equal(call.risk, 'high');
  assert.equal(call.executable, false);
  assert.equal(call.rejectionReason, 'unknown-tool');
});

test('ToolCallNormalizer: malformed native JSON is rejected before permission or effects', () => {
  const envelope = normalizeToolCallEnvelope({
    id: 'call_bad_json',
    function: {
      name: 'write_file',
      arguments: '{"path":"src/app.ts",',
    },
  }, 'native');

  assert.equal(envelope.version, TOOL_CALL_NORMALIZATION_PROTOCOL_VERSION);
  assert.equal(envelope.decision, 'rejected');
  assert.equal(envelope.reason, 'malformed-tool-arguments');
  assert.equal(envelope.call.name, 'write_file');
  assert.equal(envelope.call.registered, true);
  assert.equal(envelope.call.executable, false);
  assert.deepEqual(envelope.call.input, {});
  assert.equal(envelope.result.ok, false);
  assert.equal(envelope.result.toolName, 'write_file');
  assert.equal(envelope.result.error, 'malformed-tool-arguments');
  assert.deepEqual(envelope.result.evidence, []);
});

test('ToolCallNormalizer: partial and unknown native tool calls get a rejected envelope', () => {
  const partial = normalizeToolCallEnvelope({
    function: {
      arguments: '{}',
    },
  }, 'native');
  const unknown = normalizeToolCallEnvelope({
    function: {
      name: 'unknown_magic',
      arguments: '{}',
    },
  }, 'native');

  assert.equal(partial.decision, 'rejected');
  assert.equal(partial.reason, 'partial-tool-call');
  assert.equal(partial.call.executable, false);
  assert.equal(partial.call.registered, false);
  assert.equal(unknown.decision, 'rejected');
  assert.equal(unknown.reason, 'unknown-tool');
  assert.equal(unknown.call.executable, false);
  assert.equal(unknown.call.registered, false);
});

test('ToolCallNormalizer: native aliases normalize to canonical tools', () => {
  const call = normalizeToolCall({
    function: {
      name: 'search_content',
      arguments: JSON.stringify({ query: 'glutMouseFunc', directory: 'code/shape_manager' }),
    },
  });

  assert.equal(call.name, 'grep_search');
  assert.equal(call.registered, true);
  assert.equal(call.kind, 'search');
  assert.equal(call.input.pattern, 'glutMouseFunc');
  assert.equal(call.input.path, 'code/shape_manager');
});

console.log('\nTool call normalizer tests passed.\n');
