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
  createTextToolProtocolSession,
  findFirstAuthorizedTextToolEnvelopeStart,
  hasIncompleteAuthorizedTextToolEnvelope,
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
  });

  const authorized = renderTextToolProtocolEnvelope(session, payload);
  assert.deepEqual(inspectOutOfEnvelopeTextToolProtocol(authorized, session), {
    found: false,
    dialects: [],
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

test('incomplete recovery is scoped to an authorized envelope, not naked syntax', () => {
  assert.equal(hasIncompleteAuthorizedTextToolEnvelope(payload.slice(0, -2), session), false);
  const incomplete = renderTextToolProtocolEnvelope(session, payload)
    .replace(`</devseek_tool_calls channel="${session.channelId}">`, '');
  assert.equal(hasIncompleteAuthorizedTextToolEnvelope(incomplete, session), true);
});
