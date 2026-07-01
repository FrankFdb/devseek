/**
 * Contract tests for DeepSeek web pseudo-tool transcripts.
 *
 * The same replay fixtures must be recognized by the Agent parser and hidden by
 * the WebView sanitizer. This protects ARCH-16 Phase 1 from split-brain fixes:
 * backend executes a tool while the UI leaks it, or the UI hides text that the
 * backend failed to execute.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import { DEEPSEEK_TOOL_TRANSCRIPT_FIXTURES } from '../fixtures/deepseek-tool-transcripts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundleDir = mkdtempSync(path.join(tmpdir(), 'devseek-tool-protocol-'));
const bundlePath = path.join(bundleDir, 'fake-tool-parser.bundle.cjs');
process.on('exit', () => {
  rmSync(bundleDir, { recursive: true, force: true });
});

execSync(
  `npx esbuild src/agent/fake-tool-parser.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  containsFakeToolCallProtocol,
  parseFakeToolCalls,
  stripToolCallBlocks: stripParserToolCallBlocks,
} = req(bundlePath);

function loadWebviewSanitizer() {
  const context = { console };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  for (const relPath of [
    'media/webview-agent-tool-manifest.js',
    'media/webview-agent-sanitizer.js',
  ]) {
    vm.runInContext(readFileSync(path.join(rootDir, relPath), 'utf8'), context, { filename: relPath });
  }
  return {
    containsAgentInternalTranscript: context.containsAgentInternalTranscript,
    stripToolCallBlocks: context.stripToolCallBlocks,
  };
}

const webviewSanitizer = loadWebviewSanitizer();

for (const fixture of DEEPSEEK_TOOL_TRANSCRIPT_FIXTURES) {
  test(`tool protocol contract: ${fixture.name}`, () => {
    const tools = parseFakeToolCalls(fixture.text);
    assert.deepEqual(tools.map(tool => tool.name), fixture.expectedToolNames);
    assert.equal(containsFakeToolCallProtocol(fixture.text), true);
    assert.equal(stripParserToolCallBlocks(fixture.text), fixture.expectedVisibleText);

    assert.equal(typeof webviewSanitizer.containsAgentInternalTranscript, 'function');
    assert.equal(typeof webviewSanitizer.stripToolCallBlocks, 'function');
    assert.equal(webviewSanitizer.containsAgentInternalTranscript(fixture.text), true);
    assert.equal(webviewSanitizer.stripToolCallBlocks(fixture.text), fixture.expectedVisibleText);
  });
}
