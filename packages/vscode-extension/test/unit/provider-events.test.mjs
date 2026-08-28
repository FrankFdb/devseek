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
    `\`\`\`\n{"tool":"read_file","arguments":{"path":"/tmp/workspace/a.cpp"}}\n\`\`\`\n${response}`,
  ]) {
    assert.equal(normalizeProviderMessage({
      type: 'message', provider: 'bridge', content: invalid,
    }, enabled).tools.length, 0, invalid);
  }
});

test('Bridge bracketed Chinese calls are strict, bounded, and Bridge-only proposals', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const textToolProtocol = {
    version: 'devseek.text-tools/v1',
    channelId: 'bridge-native-bracketed-call-channel',
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
    '我先读取任务和核心实现。',
    '[调用 read_file] {"path":"/tmp/workspace/USER_STORY.md"}',
    '[调用 file_search] {"glob":"**/*.cpp"}',
    '[调用 grep_search] {"pattern":"renderNumberLine","path":"/tmp/workspace/src"}',
  ].join('');

  const accepted = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, enabled).tools;
  assert.deepEqual(accepted.map(tool => tool.name), ['read_file', 'file_search', 'grep_search']);
  assert.deepEqual(accepted[0].input, { path: '/tmp/workspace/USER_STORY.md' });
  assert.ok(accepted.every(tool => tool.source === 'provider-native-text'));
  assert.ok(accepted.every(tool => tool.executable));
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, disabled).tools.length, 0);
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'deepseek-api', content: response,
  }, enabled).tools.length, 0);

  const invalid = [
    `${response}接下来修改。`,
    '[调用 read_file] {path:"/tmp/workspace/main.cpp"}',
    '[调用 read_file] ["/tmp/workspace/main.cpp"]',
    '[调用 read_file] {"path":"/tmp/workspace/main.cpp"',
    `${response}\nAction: list_dirAction Input: {"path":"/tmp/workspace"}`,
    `${response}\n**Calling:** \`list_dir\`\n\n\`\`\`\n{"path":"/tmp/workspace"}\n\`\`\``,
    `\`\`\`\n{"tool":"list_dir","arguments":{"path":"/tmp/workspace"}}\n\`\`\`\n${response}`,
    Array.from({ length: 17 }, (_, index) => (
      `[调用 read_file] {"path":"/tmp/workspace/${index}.cpp"}`
    )).join(''),
  ];
  for (const content of invalid) {
    assert.equal(normalizeProviderMessage({
      type: 'message', provider: 'bridge', content,
    }, enabled).tools.length, 0, content);
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

test('Bridge ReAct responses are strict, bounded, Bridge-only proposals under canonical dispatch', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const textToolProtocol = {
    version: 'devseek.text-tools/v1',
    channelId: 'bridge-native-react-channel',
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
    '我需要继续查看实现细节。',
    'Action: read_fileAction Input: {"path":"/tmp/workspace/src/raster_canvas.cpp","startLine":144,"endLine":160}',
    'Action: grep_search\nAction Input: {"pattern":"renderNumberLine","path":"/tmp/workspace/src"}',
  ].join('');

  const accepted = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, enabled).tools;
  assert.deepEqual(accepted.map(tool => tool.name), ['read_file', 'grep_search']);
  assert.deepEqual(accepted[0].input, {
    path: '/tmp/workspace/src/raster_canvas.cpp',
    startLine: 144,
    endLine: 160,
  });
  assert.deepEqual(accepted[1].input, {
    pattern: 'renderNumberLine',
    path: '/tmp/workspace/src',
  });
  assert.ok(accepted.every(tool => tool.source === 'provider-native-text'));
  assert.ok(accepted.every(tool => tool.executable));
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, disabled).tools.length, 0);
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'deepseek-api', content: response,
  }, enabled).tools.length, 0);

  const [unknown] = normalizeProviderMessage({
    type: 'message',
    provider: 'bridge',
    content: 'Action: provider_private_toolAction Input: {}',
  }, enabled).tools;
  assert.equal(unknown.source, 'provider-native-text');
  assert.equal(unknown.executable, false);

  const invalid = [
    `${response}接下来修改。`,
    'Action: read_fileAction Input: {path:"/tmp/workspace/src/main.cpp"}',
    'Action: read_fileAction Input: ["/tmp/workspace/src/main.cpp"]',
    'Action: read_fileAction Input: {"path":"/tmp/workspace/src/main.cpp"',
    `${response}\n**Calling:** \`list_dir\`\n\n\`\`\`\n{"path":"/tmp/workspace"}\n\`\`\``,
    `${response}Tool: list_dirArguments: {"path":"/tmp/workspace"}`,
    `${response}list_dir {"path":"/tmp/workspace"}`,
    Array.from({ length: 17 }, (_, index) => (
      `Action: read_fileAction Input: {"path":"/tmp/workspace/${index}.cpp"}`
    )).join(''),
  ];
  for (const content of invalid) {
    assert.equal(normalizeProviderMessage({
      type: 'message', provider: 'bridge', content,
    }, enabled).tools.length, 0, content);
  }
});

test('Bridge fenced JSON object tools are strict, bounded, Bridge-only proposals', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const textToolProtocol = {
    version: 'devseek.text-tools/v1',
    channelId: 'bridge-native-fenced-json-object-channel',
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
  const toolBlock = (tool, args, language = '') => [
    `\`\`\`${language}`,
    JSON.stringify({ tool, arguments: args }, null, 2),
    '\`\`\`',
  ].join('\n');
  const response = [
    '我先读取任务和核心实现。',
    toolBlock('read_file', { path: '/tmp/workspace/USER_STORY.md' }),
    toolBlock('grep_search', { pattern: 'renderNumberLine', path: '/tmp/workspace/src' }, 'json'),
  ].join('\n\n');

  const accepted = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, enabled).tools;
  assert.deepEqual(accepted.map(tool => tool.name), ['read_file', 'grep_search']);
  assert.deepEqual(accepted[0].input, { path: '/tmp/workspace/USER_STORY.md' });
  assert.ok(accepted.every(tool => tool.source === 'provider-native-text'));
  assert.ok(accepted.every(tool => tool.executable));
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, disabled).tools.length, 0);
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'deepseek-api', content: response,
  }, enabled).tools.length, 0);

  const invalid = [
    `${response}\n继续修改。`,
    '```\n{"tool":"read_file","arguments":{path:"/tmp/workspace/main.cpp"}}\n```',
    '```\n{"tool":"read_file","arguments":[]}\n```',
    '```\n{"tool":"read_file","arguments":{"path":"/tmp/workspace/main.cpp"}\n```',
    '```\n{"name":"read_file","arguments":{"path":"/tmp/workspace/main.cpp"}}\n```',
    '```\n{"tool":"read_file","arguments":{},"executable":true}\n```',
    `${response}\nAction: list_dirAction Input: {"path":"/tmp/workspace"}`,
    `${response}\nlist_dir {"path":"/tmp/workspace"}`,
    Array.from({ length: 17 }, (_, index) => toolBlock(
      'read_file', { path: `/tmp/workspace/${index}.cpp` }, index % 2 ? 'json' : '',
    )).join('\n'),
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

test('Bridge fenced JSON tool arrays are complete, strict, bounded, and Bridge-only', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const textToolProtocol = {
    version: 'devseek.text-tools/v1',
    channelId: 'bridge-native-json-array-channel',
  };
  const boundary = bindProviderNormalizationBoundary(
    providerEvents,
    toolDispatch,
    { workspaceRoot: '/tmp/workspace' },
    textToolProtocol,
  );
  const response = [
    '我先读取任务和源码。',
    '```',
    '[',
    '  {"name":"read_file","arguments":{"path":"/tmp/workspace/USER_STORY.md"}},',
    '  {"name":"file_search","arguments":{"glob":"src/**/*.{cpp,hpp,h}"}}',
    ']',
    '```',
  ].join('\n');

  const accepted = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: response,
  }, boundary).tools;
  assert.deepEqual(accepted.map(tool => tool.name), ['read_file', 'file_search']);
  assert.deepEqual(accepted[0].input, { path: '/tmp/workspace/USER_STORY.md' });
  assert.ok(accepted.every(tool => tool.source === 'provider-native-text'));
  assert.ok(accepted.every(tool => tool.executable));
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'deepseek-api', content: response,
  }, boundary).tools.length, 0);

  const invalid = [
    `${response}\n然后修改源码。`,
    response.replace('```\n[', '```json\n[').replace('"arguments"', '"input"'),
    response.replace('{"path":"/tmp/workspace/USER_STORY.md"}', '["/tmp/workspace/USER_STORY.md"]'),
    response.replace('"arguments":', '"unexpected":true,"arguments":'),
    response.replace(/\n```$/, ''),
    response.replace(']\n```', '],\n```'),
    [
      '```json',
      JSON.stringify(Array.from({ length: 17 }, (_, index) => ({
        name: 'read_file',
        arguments: { path: `/tmp/workspace/${index}.cpp` },
      }))),
      '```',
    ].join('\n'),
  ];
  for (const content of invalid) {
    assert.equal(normalizeProviderMessage({
      type: 'message', provider: 'bridge', content,
    }, boundary).tools.length, 0, content);
  }
});

test('Bridge recovers a strict unclosed observation envelope without widening effect authority', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const textToolProtocol = {
    version: 'devseek.text-tools/v1',
    channelId: 'bridge-unclosed-observation-channel',
  };
  const boundary = bindProviderNormalizationBoundary(
    providerEvents,
    toolDispatch,
    { workspaceRoot: '/tmp/workspace' },
    textToolProtocol,
  );
  const open = '<devseek_tool_calls version="devseek.text-tools/v1" channel="bridge-unclosed-observation-channel">';
  const observations = `${open}[TOOL:read_file {"path":"/tmp/workspace/src/main.cpp"}]`
    + '[TOOL:file_search {"glob":"src/**/*.cpp"}]';
  const accepted = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content: observations,
  }, boundary).tools;

  assert.deepEqual(accepted.map(tool => tool.name), ['read_file', 'file_search']);
  assert.ok(accepted.every(tool => tool.source === 'text-protocol'));
  assert.ok(accepted.every(tool => tool.executable));
  assert.equal(normalizeProviderMessage({
    type: 'message',
    provider: 'bridge',
    content: `${open}[TOOL:create_file {"path":"/tmp/workspace/x","content":"y"}]`,
  }, boundary).tools.length, 0);
});

test('Bridge accepts one strict read_file shorthand as a locally arbitrated observation', () => {
  const providerEvents = new CanonicalProviderEventService();
  const toolDispatch = new CanonicalToolDispatchService();
  const boundary = bindProviderNormalizationBoundary(
    providerEvents,
    toolDispatch,
    { workspaceRoot: '/tmp/workspace' },
    { version: 'devseek.text-tools/v1', channelId: 'bridge-read-shorthand-channel' },
  );
  const content = '让我先读取关键源码：read_file path=/tmp/workspace/src/main.cpp lines=140-220';
  const [tool] = normalizeProviderMessage({
    type: 'message', provider: 'bridge', content,
  }, boundary).tools;

  assert.equal(tool.name, 'read_file');
  assert.deepEqual(tool.input, {
    path: '/tmp/workspace/src/main.cpp',
    startLine: 140,
    endLine: 220,
  });
  assert.equal(tool.source, 'provider-native-text');
  assert.equal(tool.executable, true);

  for (const invalid of [
    `${content} 然后修改`,
    'read_file path=/tmp/workspace/src/main.cpp lines=220-140',
    `read_file path=/tmp/workspace/src/main.cpp lines=${'9'.repeat(400)}-${'9'.repeat(400)}`,
    'create_file path=/tmp/workspace/src/main.cpp',
    'read_file path=`/tmp/workspace/src/main.cpp` lines=140-220',
  ]) {
    assert.equal(normalizeProviderMessage({
      type: 'message', provider: 'bridge', content: invalid,
    }, boundary).tools.length, 0, invalid);
  }
  assert.equal(normalizeProviderMessage({
    type: 'message', provider: 'deepseek-api', content,
  }, boundary).tools.length, 0);
});
