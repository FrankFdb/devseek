import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(testDir, '../..');
const bundleRoot = mkdtempSync(path.join(tmpdir(), 'devseek-text-tool-protocol-'));
const bundlePath = path.join(bundleRoot, 'text-tool-protocol.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/text-tool-protocol.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: extensionRoot, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const {
  countCompletedAuthorizedTextToolEnvelopes,
  createTextToolProtocolSession,
  findFirstAuthorizedTextToolEnvelopeStart,
  hasIncompleteAuthorizedTextToolEnvelope,
  inspectIncompleteAuthorizedTextToolProtocol,
  inspectInvalidAuthorizedTextToolProtocol,
  inspectOutOfEnvelopeTextToolProtocol,
  parseAuthorizedTextToolCalls,
  renderTextToolProtocolEnvelope,
  stripAuthorizedTextToolEnvelopes,
} = require(bundlePath);

after(() => rmSync(bundleRoot, { recursive: true, force: true }));

const session = createTextToolProtocolSession('simulation-channel-20260819');
const payload = '[TOOL:create_file {"path":"notes/tool-example.txt","content":"literal"}]';

test('ordinary assistant text never gains execution authority from tool-looking syntax', () => {
  for (const answer of [
    payload,
    `原样展示：\n\`\`\`text\n${payload}\n\`\`\``,
    `This is how create_file syntax looks: ${payload}`,
    `工具の例です。実行しないでください。${payload}`,
  ]) {
    assert.deepEqual(parseAuthorizedTextToolCalls(answer, session), [], answer);
    assert.equal(stripAuthorizedTextToolEnvelopes(answer, session), answer, answer);
  }
});

test('out-of-envelope structured actions are observable only as quarantined protocol', () => {
  const action = [
    '我先读取目标文件。',
    'Action: read_file',
    'Action Input: {"path":"/tmp/workspace/README.md"}',
  ].join('\n');

  assert.deepEqual(parseAuthorizedTextToolCalls(action, session), []);
  assert.deepEqual(inspectOutOfEnvelopeTextToolProtocol(action, session), {
    found: true,
    dialects: ['react-action'],
    observedToolNames: ['read_file'],
  });

  const authorized = renderTextToolProtocolEnvelope(session, payload);
  assert.deepEqual(inspectOutOfEnvelopeTextToolProtocol(authorized, session), {
    found: false,
    dialects: [],
    observedToolNames: [],
  });
});

test('DeepSeek direct JSON tool batches are quarantined and reissued through the current channel', () => {
  const directBatch = [
    'read_file{"path":"/tmp/workspace/lesson_controller.cpp","startLine":1,"endLine":220}',
    'read_file{"path":"/tmp/workspace/raster_canvas.cpp","startLine":300,"endLine":430}',
  ].join('');

  assert.deepEqual(parseAuthorizedTextToolCalls(directBatch, session), []);
  assert.deepEqual(inspectOutOfEnvelopeTextToolProtocol(directBatch, session), {
    found: true,
    dialects: ['direct-json-tool-call'],
    observedToolNames: ['read_file'],
  });
});

test('DeepSeek direct JSON mutations remain quarantined outside an authorized envelope', () => {
  const directMutation = 'replace_in_file{"path":"/tmp/workspace/main.cpp","old_str":"old","new_str":"new"}';

  assert.deepEqual(parseAuthorizedTextToolCalls(directMutation, session), []);
  assert.deepEqual(inspectOutOfEnvelopeTextToolProtocol(directMutation, session), {
    found: true,
    dialects: ['direct-json-tool-call'],
    observedToolNames: ['replace_in_file'],
  });
});

test('provider text content blocks are quarantined and reissued instead of becoming no-tool prose', () => {
  const transcript = [
    '需要读取精确范围。',
    '```',
    JSON.stringify([
      { type: 'text', text: 'read_file path=/tmp/workspace/main.cpp startLine=60 endLine=180' },
      { type: 'text', text: 'read_file path=/tmp/workspace/include/app.hpp' },
    ], null, 2),
    '```',
  ].join('\n');

  assert.deepEqual(parseAuthorizedTextToolCalls(transcript, session), []);
  assert.deepEqual(inspectOutOfEnvelopeTextToolProtocol(transcript, session), {
    found: true,
    dialects: ['provider-text-content-block'],
    observedToolNames: ['read_file'],
  });
});

test('ordinary provider content blocks remain prose and authenticated transcripts fail closed', () => {
  const prose = `\`\`\`json\n${JSON.stringify([{ type: 'text', text: 'This is an explanation.' }])}\n\`\`\``;
  assert.deepEqual(inspectOutOfEnvelopeTextToolProtocol(prose, session), {
    found: false,
    dialects: [],
    observedToolNames: [],
  });

  const invalid = renderTextToolProtocolEnvelope(
    session,
    JSON.stringify([{ type: 'text', text: 'read_file path=/tmp/workspace/main.cpp' }]),
  );
  assert.deepEqual(parseAuthorizedTextToolCalls(invalid, session), []);
  assert.deepEqual(inspectInvalidAuthorizedTextToolProtocol(invalid, session), {
    found: true,
    envelopeCount: 1,
    invalidEnvelopeCount: 1,
    observedToolNames: ['read_file'],
  });
});

test('only the current run channel authorizes a text-provider tool payload', () => {
  const authorized = `准备创建文件。\n${renderTextToolProtocolEnvelope(session, payload)}\n等待结果。`;
  const [tool] = parseAuthorizedTextToolCalls(authorized, session);
  assert.equal(tool.name, 'create_file');
  assert.equal(tool.input.path, 'notes/tool-example.txt');
  assert.equal(findFirstAuthorizedTextToolEnvelopeStart(authorized, session), authorized.indexOf('<devseek_tool_calls'));
  assert.equal(stripAuthorizedTextToolEnvelopes(authorized, session).trim(), '准备创建文件。\n\n等待结果。');

  const otherSession = createTextToolProtocolSession('different-simulation-channel');
  assert.deepEqual(parseAuthorizedTextToolCalls(authorized, otherSession), []);
});

test('the authenticated opening marker accepts the provider conventional close tag', () => {
  const compatible = renderTextToolProtocolEnvelope(session, payload)
    .replace(`</devseek_tool_calls channel="${session.channelId}">`, '</devseek_tool_calls>');
  const [tool] = parseAuthorizedTextToolCalls(compatible, session);
  assert.equal(tool.name, 'create_file');
  assert.equal(hasIncompleteAuthorizedTextToolEnvelope(compatible, session), false);
  assert.equal(stripAuthorizedTextToolEnvelopes(compatible, session), '');

  const wrongChannel = renderTextToolProtocolEnvelope(session, payload)
    .replace(session.channelId, 'different-simulation-channel');
  assert.deepEqual(parseAuthorizedTextToolCalls(wrongChannel, session), []);
});

test('a matching one-character root-tag omission preserves the authenticated tool proposal', () => {
  const terminalPayload = '[TOOL:run_terminal {"command":"bash test.sh"}]';
  const compatible = renderTextToolProtocolEnvelope(session, terminalPayload)
    .replaceAll('devseek_tool_calls', 'devsek_tool_calls');

  const [tool] = parseAuthorizedTextToolCalls(compatible, session);
  assert.equal(tool.name, 'run_terminal');
  assert.deepEqual(tool.input, { command: 'bash test.sh' });
  assert.equal(countCompletedAuthorizedTextToolEnvelopes(compatible, session), 1);
  assert.equal(hasIncompleteAuthorizedTextToolEnvelope(compatible, session), false);
  assert.equal(stripAuthorizedTextToolEnvelopes(compatible, session), '');
  assert.equal(inspectOutOfEnvelopeTextToolProtocol(compatible, session).found, false);

  const wrongChannel = compatible.replace(session.channelId, 'different-simulation-channel');
  const twoOmissions = compatible.replaceAll('devsek_tool_calls', 'devsk_tool_calls');
  const mismatchedClose = compatible.replace('</devsek_tool_calls', '</devseek_tool_calls');
  const wrongVersion = compatible.replace(session.version, 'devseek.text-tools/v0');
  for (const rejected of [wrongChannel, twoOmissions, mismatchedClose, wrongVersion]) {
    assert.deepEqual(parseAuthorizedTextToolCalls(rejected, session), []);
  }
});

test('incomplete recovery is scoped to an authorized envelope, not naked syntax', () => {
  assert.equal(hasIncompleteAuthorizedTextToolEnvelope(payload.slice(0, -2), session), false);
  const incomplete = renderTextToolProtocolEnvelope(session, payload)
    .replace(`</devseek_tool_calls channel="${session.channelId}">`, '');
  assert.equal(hasIncompleteAuthorizedTextToolEnvelope(incomplete, session), true);
  assert.equal(countCompletedAuthorizedTextToolEnvelopes(incomplete, session), 0);
  assert.equal(countCompletedAuthorizedTextToolEnvelopes(
    renderTextToolProtocolEnvelope(session, payload),
    session,
  ), 1);
});

test('incomplete current-channel envelopes preserve tool names without authorizing parameters', () => {
  const incomplete = [
    `<devseek_tool_calls version="${session.version}" channel="${session.channelId}">`,
    '[TOOL:replace_in_file {"path":"src/main.cpp","old_str":"old","new_str":"new"}]',
    '[TOOL:read_file {"path":"src/main.cpp"}]',
    '</devsek_tool_calls>',
  ].join('\n');

  assert.deepEqual(inspectIncompleteAuthorizedTextToolProtocol(incomplete, session), {
    found: true,
    observedToolNames: ['replace_in_file', 'read_file'],
  });
  assert.deepEqual(parseAuthorizedTextToolCalls(incomplete, session), []);
});

test('an unclosed current-channel envelope recovers only one strict local observation batch', () => {
  const open = `<devseek_tool_calls version="${session.version}" channel="${session.channelId}">`;
  const observations = [
    open,
    '[TOOL:read_file {"path":"src/main.cpp"}]',
    '[TOOL:file_search {"glob":"src/**/*.cpp"}]',
  ].join('');
  const tools = parseAuthorizedTextToolCalls(observations, session);
  assert.deepEqual(tools.map(tool => tool.name), ['read_file', 'file_search']);
  assert.deepEqual(tools[0].input, { path: 'src/main.cpp' });

  const rejected = [
    `${observations} trailing prose`,
    `${open}[TOOL:read_file {"path":"src/main.cpp"}[TOOL:file_search {"glob":"src/**/*.cpp"}]`,
    `${open}[TOOL:read_file {"path":"src/main.cpp"}][TOOL:create_file {"path":"x","content":"y"}]`,
    `${open}[TOOL:run_terminal {"command":"pwd"}]`,
    `${open}[TOOL:fetch_webpage {"url":"https://example.com"}]`,
    `${open}[TOOL:task_complete {"summary":"done"}]`,
    `${observations}${open}[TOOL:read_file {"path":"src/other.cpp"}]`,
    `${renderTextToolProtocolEnvelope(session, '[TOOL:read_file {"path":"src/main.cpp"}]')}${open}[TOOL:read_file {"path":"src/other.cpp"}]`,
  ];
  for (const value of rejected) {
    assert.deepEqual(parseAuthorizedTextToolCalls(value, session), [], value);
  }
});

test('complete authorized envelopes without a recognized tool are rejected', () => {
  const malformed = renderTextToolProtocolEnvelope(
    session,
    '<create_file><path>notes/report.md</path>',
  );
  assert.deepEqual(parseAuthorizedTextToolCalls(malformed, session), []);
  assert.deepEqual(inspectInvalidAuthorizedTextToolProtocol(malformed, session), {
    found: true,
    envelopeCount: 1,
    invalidEnvelopeCount: 1,
    observedToolNames: [],
  });

  assert.deepEqual(inspectInvalidAuthorizedTextToolProtocol(
    renderTextToolProtocolEnvelope(session, payload),
    session,
  ), {
    found: false,
    envelopeCount: 1,
    invalidEnvelopeCount: 0,
    observedToolNames: [],
  });
});

test('lossy JSON source mutations are quarantined while strict JSON preserves exact bytes', () => {
  const cppContent = [
    '#include "lesson_controller.hpp"',
    "if (c == '\\\\') {",
    '  result += "\\\\\\\\";',
    '}',
  ].join('\n');
  const lossyPayload = `[TOOL:create_file {"path":"src/lesson_controller.cpp","content":"${cppContent.replace(/\n/g, '\\n')}"}]`;
  const lossyEnvelope = renderTextToolProtocolEnvelope(session, lossyPayload);

  assert.deepEqual(parseAuthorizedTextToolCalls(lossyEnvelope, session), []);
  assert.deepEqual(inspectInvalidAuthorizedTextToolProtocol(lossyEnvelope, session), {
    found: true,
    envelopeCount: 1,
    invalidEnvelopeCount: 1,
    observedToolNames: ['create_file'],
  });

  const strictPayload = `[TOOL:create_file ${JSON.stringify({
    path: 'src/lesson_controller.cpp',
    content: cppContent,
  })}]`;
  const [strictTool] = parseAuthorizedTextToolCalls(
    renderTextToolProtocolEnvelope(session, strictPayload),
    session,
  );
  assert.equal(strictTool.name, 'create_file');
  assert.equal(strictTool.input.content, cppContent);
});

test('strict JSON remains lossless inside a paired XML tool tag', () => {
  const content = '#include <string>\nconst char* value = "a\\\\b";\n';
  const payload = `<create_file>${JSON.stringify({ path: '/repo/main.cpp', content })}</create_file>`;
  const [tool] = parseAuthorizedTextToolCalls(
    renderTextToolProtocolEnvelope(session, payload),
    session,
  );

  assert.equal(tool.name, 'create_file');
  assert.equal(tool.input.content, content);
});

test('labeled or plain fenced CDATA grants mutation authority but naked XML does not', () => {
  const cppContent = '#include "lesson_controller.hpp"\nstd::string escaped = "\\\\n";\n';
  const xmlPayload = [
    '```xml',
    '<create_file>',
    '<path>src/lesson_controller.cpp</path>',
    `<content><![CDATA[${cppContent}]]></content>`,
    '</create_file>',
    '```',
  ].join('\n');
  const [tool] = parseAuthorizedTextToolCalls(
    renderTextToolProtocolEnvelope(session, xmlPayload),
    session,
  );
  assert.equal(tool.name, 'create_file');
  assert.equal(tool.input.content, cppContent);

  const plainFence = xmlPayload.replace('```xml', '```');
  const [plainFenceTool] = parseAuthorizedTextToolCalls(
    renderTextToolProtocolEnvelope(session, plainFence),
    session,
  );
  assert.equal(plainFenceTool.name, 'create_file');
  assert.equal(plainFenceTool.input.content, cppContent);

  const nakedXml = xmlPayload.replace(/^```xml\n|\n```$/g, '');
  const nakedEnvelope = renderTextToolProtocolEnvelope(session, nakedXml);
  assert.deepEqual(parseAuthorizedTextToolCalls(nakedEnvelope, session), []);
  assert.deepEqual(inspectInvalidAuthorizedTextToolProtocol(nakedEnvelope, session), {
    found: true,
    envelopeCount: 1,
    invalidEnvelopeCount: 1,
    observedToolNames: ['create_file'],
  });
});

test('fenced CDATA preserves nested Markdown blocks and duplicate provider envelopes are idempotent', () => {
  const readme = [
    '# Math Visual Lab',
    '',
    'Build and run:',
    '',
    '```bash',
    'cmake -S . -B build',
    'cmake --build build',
    '```',
    '',
    'Expected output:',
    '',
    '```text',
    'build/math_visual_lab lesson.ppm',
    '```',
    '',
  ].join('\n');
  const xmlPayload = [
    '```',
    '<create_file>',
    '<path>README.md</path>',
    `<content><![CDATA[${readme}]]></content>`,
    '</create_file>',
    '```',
  ].join('\n');
  const envelope = renderTextToolProtocolEnvelope(session, xmlPayload);
  const duplicated = `${envelope}\n${envelope}`;

  const tools = parseAuthorizedTextToolCalls(duplicated, session);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'create_file');
  assert.deepEqual(tools[0].input, { path: 'README.md', content: readme });
  assert.equal(inspectInvalidAuthorizedTextToolProtocol(duplicated, session).found, false);

  assert.deepEqual(parseAuthorizedTextToolCalls(xmlPayload, session), []);
  assert.equal(inspectOutOfEnvelopeTextToolProtocol(xmlPayload, session).found, true);

  const wrongSession = createTextToolProtocolSession('nested-markdown-wrong-channel');
  assert.deepEqual(parseAuthorizedTextToolCalls(envelope, wrongSession), []);
});

test('a detached outer fence is recognized when CDATA contains nested Markdown blocks', () => {
  const readme = '# Build\n\n```bash\ncmake --build build\n```\n';
  const xmlPayload = [
    '```xml',
    '<write_file>',
    '<path>README.md</path>',
    `<content><![CDATA[${readme}]]></content>`,
    '</write_file>',
    '```',
  ].join('\n');
  const detached = renderTextToolProtocolEnvelope(session, xmlPayload).replace(
    `\n\`\`\`\n</devseek_tool_calls channel="${session.channelId}">`,
    '\n</devseek_tool_calls>\n```',
  );

  const [tool] = parseAuthorizedTextToolCalls(detached, session);
  assert.equal(tool.name, 'write_file');
  assert.equal(tool.input.content, readme);
  assert.equal(stripAuthorizedTextToolEnvelopes(detached, session), '');
  assert.equal(inspectOutOfEnvelopeTextToolProtocol(detached, session).found, false);
});

test('a fenced single-file patch preserves exact patch bytes', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: src/lesson_controller.cpp',
    '@@',
    ' void run() {',
    '-  old_call();',
    '+  new_call();',
    ' }',
    '*** End Patch',
  ].join('\n');
  const payload = [
    '```xml',
    '<apply_patch>',
    '<path>src/lesson_controller.cpp</path>',
    `<patch><![CDATA[${patch}]]></patch>`,
    '</apply_patch>',
    '```',
  ].join('\n');
  const [tool] = parseAuthorizedTextToolCalls(
    renderTextToolProtocolEnvelope(session, payload),
    session,
  );

  assert.equal(tool.name, 'apply_patch');
  assert.deepEqual(tool.input, { path: 'src/lesson_controller.cpp', patch });
});

test('an adjacent Markdown fence closed after the authenticated envelope is normalized losslessly', () => {
  const xmlPayload = [
    '```xml',
    '<replace_in_file>',
    '<path>src/lesson_controller.cpp</path>',
    '<old_str><![CDATA[return "old\\n";]]></old_str>',
    '<new_str><![CDATA[return "new\\n";]]></new_str>',
    '</replace_in_file>',
    '```',
  ].join('\n');
  const canonical = renderTextToolProtocolEnvelope(session, xmlPayload);
  const detachedFence = canonical.replace(
    `\n\`\`\`\n</devseek_tool_calls channel="${session.channelId}">`,
    '\n</devseek_tool_calls>\n```',
  );

  const [tool] = parseAuthorizedTextToolCalls(detachedFence, session);
  assert.equal(tool.name, 'replace_in_file');
  assert.deepEqual(tool.input, {
    path: 'src/lesson_controller.cpp',
    old_str: 'return "old\\n";',
    new_str: 'return "new\\n";',
  });
  assert.equal(countCompletedAuthorizedTextToolEnvelopes(detachedFence, session), 1);
  assert.equal(stripAuthorizedTextToolEnvelopes(detachedFence, session), '');
  assert.equal(inspectInvalidAuthorizedTextToolProtocol(detachedFence, session).found, false);
  assert.equal(inspectOutOfEnvelopeTextToolProtocol(detachedFence, session).found, false);

  const separatedFence = detachedFence.replace(
    '</devseek_tool_calls>\n```',
    '</devseek_tool_calls>\ntrailing prose\n```',
  );
  assert.deepEqual(parseAuthorizedTextToolCalls(separatedFence, session), []);
  assert.equal(inspectInvalidAuthorizedTextToolProtocol(separatedFence, session).found, true);
});
