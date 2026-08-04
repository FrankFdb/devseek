import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-agentic-execution-context-'));
const bundlePath = path.join(tempRoot, 'agentic-execution-context.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/agentic-execution-context.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
], { cwd: rootDir, stdio: 'pipe' });

const req = createRequire(import.meta.url);
const { createAgenticInitialPromptContext } = req(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('initial prompt context keeps a plain user request minimal', () => {
  const projection = createAgenticInitialPromptContext('SYSTEM', 'current request', '', '');

  assert.deepEqual(projection.messages, [{ role: 'user', content: 'SYSTEM\n\ncurrent request' }]);
  assert.equal(projection.totalChars, projection.messages[0].content.length);
});

test('initial prompt context places same-session facts before the current request', () => {
  const projection = createAgenticInitialPromptContext(
    'SYSTEM',
    'current request',
    ' prior verified facts ',
    '',
  );
  const content = projection.messages[0].content;

  assert.ok(content.indexOf('prior verified facts') < content.indexOf('current request'));
  assert.match(content, /【同一会话上下文】/u);
  assert.match(content, /【当前用户消息】/u);
  assert.equal(projection.totalChars, content.length);
});

test('initial prompt context appends trimmed host recovery facts after the current request', () => {
  const projection = createAgenticInitialPromptContext(
    'SYSTEM',
    'current request',
    'prior verified facts',
    ' durable recovery facts ',
  );
  const content = projection.messages[0].content;

  assert.ok(content.indexOf('current request') < content.indexOf('durable recovery facts'));
  assert.doesNotMatch(content, / durable recovery facts /u);
  assert.equal(projection.totalChars, content.length);
});
