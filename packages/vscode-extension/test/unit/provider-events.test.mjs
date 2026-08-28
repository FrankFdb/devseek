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
    {
      version: 'devseek.text-tools/v1',
      channelId: 'provider-events-test-channel',
    },
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
  const nakedText = normalizeProviderMessage({
    type: 'message',
    provider: 'deepseek-api',
    content: `[TOOL:run_terminal ${JSON.stringify({ command: scenario.input.inside_validation_command })}]`,
  }, boundary);
  const textProtocol = normalizeProviderMessage({
    type: 'message',
    provider: 'deepseek-api',
    content: [
      '<devseek_tool_calls version="devseek.text-tools/v1" channel="provider-events-test-channel">',
      `[TOOL:run_terminal ${JSON.stringify({ command: scenario.input.inside_validation_command })}]`,
      '</devseek_tool_calls channel="provider-events-test-channel">',
    ].join('\n'),
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
  assert.equal(nakedText.tools.length, 0);
  assert.equal(textProtocol.risk, 'medium');
  assert.equal(textProtocol.source, 'text-protocol');
  assert.equal(outside.call.risk, 'high');
});

test('Bridge Calling responses require an agent protocol session and strict complete JSON blocks', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const textToolProtocol = {
    version: 'devseek.text-tools/v1',
    channelId: 'bridge-native-calling-channel',
  };
  const disabled = bindProviderNormalizationBoundary(
    providerEvents,
    toolDispatch,
    { workspaceRoot: '/tmp/workspace' },
  );
  const enabled = bindProviderNormalizationBoundary(
    providerEvents,
    toolDispatch,
    { workspaceRoot: '/tmp/workspace' },
    textToolProtocol,
  );
  const response = [
    '我先读取任务和源码。',
    '**Calling:** `read_file`',
    '',
    '```',
    '{"path":"/tmp/workspace/USER_STORY.md"}',
    '```',
    '',
    '**Calling:** `list_dir`',
    '',
    '```json',
    '{"path":"/tmp/workspace"}',
    '```',
  ].join('\n');

  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, disabled).tools.length, 0);
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'deepseek-api', content: response,
  }, enabled).tools.length, 0);

  const accepted = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, enabled).tools;
  assert.deepEqual(accepted.map(tool => tool.name), ['read_file', 'list_dir']);
  assert.ok(accepted.every(tool => tool.source === 'provider-native-text'));
  assert.ok(accepted.every(tool => tool.executable));
  assert.deepEqual(accepted[0].input, { path: '/tmp/workspace/USER_STORY.md' });

  const sameLineProse = response.replace(
    '我先读取任务和源码。\n**Calling:**',
    '让我先理解当前工作区。**Calling:**',
  );
  assert.deepEqual(normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: sameLineProse,
  }, enabled).tools.map(tool => tool.name), ['read_file', 'list_dir']);

  for (const invalid of [
    `${response}\n这只是一个格式示例。`,
    response.replace('{"path":"/tmp/workspace"}', '{path:"/tmp/workspace"}'),
    response.replace(/```$/, ''),
  ]) {
    assert.equal(normalizeProviderMessage({
      type: 'message', provider: 'bridge', content: invalid,
    }, enabled).tools.length, 0, invalid);
  }
});

test('Bridge Tool Arguments responses accept complete sequences and reject ambiguous payloads', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const textToolProtocol = {
    version: 'devseek.text-tools/v1',
    channelId: 'bridge-native-tool-arguments-channel',
  };
  const enabled = bindProviderNormalizationBoundary(
    providerEvents,
    toolDispatch,
    { workspaceRoot: '/tmp/workspace' },
    textToolProtocol,
  );
  const response = [
    '我先读取入口和实现。',
    'Tool: read_fileArguments: {"path":"/tmp/workspace/src/main.cpp"}',
    'Tool: read_fileArguments: {"path":"/tmp/workspace/src/raster_canvas.cpp","startLine":240}',
  ].join('');

  const accepted = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, enabled).tools;
  assert.deepEqual(accepted.map(tool => tool.name), ['read_file', 'read_file']);
  assert.deepEqual(accepted[1].input, {
    path: '/tmp/workspace/src/raster_canvas.cpp',
    startLine: 240,
  });
  assert.ok(accepted.every(tool => tool.source === 'provider-native-text'));
  assert.ok(accepted.every(tool => tool.executable));

  const invalid = [
    `${response}接下来修改。`,
    'Tool: read_fileArguments: {path:"/tmp/workspace/src/main.cpp"}',
    'Tool: read_fileArguments: ["/tmp/workspace/src/main.cpp"]',
    'Tool: read_fileArguments: {"path":"/tmp/workspace/src/main.cpp"',
    `${response}\n**Calling:** \`list_dir\`\n\n\`\`\`\n{"path":"/tmp/workspace"}\n\`\`\``,
    Array.from({ length: 17 }, (_, index) => (
      `Tool: read_fileArguments: {"path":"/tmp/workspace/${index}.cpp"}`
    )).join(''),
  ];
  for (const content of invalid) {
    assert.equal(normalizeProviderMessage({
      type: 'message', provider: 'bridge', content,
    }, enabled).tools.length, 0, content);
  }
});

test('Bridge bare JSON tool sequences are strict, bounded, and Bridge-only', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const textToolProtocol = {
    version: 'devseek.text-tools/v1',
    channelId: 'bridge-native-bare-json-channel',
  };
  const enabled = bindProviderNormalizationBoundary(
    providerEvents,
    toolDispatch,
    { workspaceRoot: '/tmp/workspace' },
    textToolProtocol,
  );
  const response = [
    '我先检查当前工作区。',
    'read_file {"path":"/tmp/workspace/src/main.cpp"}',
    'grep_search {"pattern":"renderNumberLine","path":"/tmp/workspace/src"}',
    'list_dir {"path":"/tmp/workspace/include"}',
  ].join('');

  const accepted = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, enabled).tools;
  assert.deepEqual(accepted.map(tool => tool.name), ['read_file', 'grep_search', 'list_dir']);
  assert.ok(accepted.every(tool => tool.source === 'provider-native-text'));
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'deepseek-api', content: response,
  }, enabled).tools.length, 0);

  const invalid = [
    `${response}然后修改源码。`,
    'read_file {path:"/tmp/workspace/src/main.cpp"}',
    'read_file ["/tmp/workspace/src/main.cpp"]',
    'read_file {"path":"/tmp/workspace/src/main.cpp"',
    `${response}\n**Calling:** \`list_dir\`\n\n\`\`\`\n{"path":"/tmp/workspace"}\n\`\`\``,
    `${response}Tool: list_dirArguments: {"path":"/tmp/workspace"}`,
    Array.from({ length: 17 }, (_, index) => (
      `read_file {"path":"/tmp/workspace/${index}.cpp"}`
    )).join(''),
  ];
  for (const content of invalid) {
    assert.equal(normalizeProviderMessage({
      type: 'message', provider: 'bridge', content,
    }, enabled).tools.length, 0, content);
  }
});
