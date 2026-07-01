/**
 * ARCH-16 duplicate-judgment governance tests.
 *
 * These are architecture guards, not behavior tests. They keep high-risk
 * decision rules from quietly spreading into another phase of the agent loop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../../');

function readExtensionFile(relPath) {
  return readFileSync(path.join(extensionRoot, relPath), 'utf8');
}

function extensionFileExists(relPath) {
  return existsSync(path.join(extensionRoot, relPath));
}

function collectFiles(relDir, predicate) {
  const baseDir = path.join(extensionRoot, relDir);
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const absPath = path.join(dir, name);
      const relPath = path.relative(extensionRoot, absPath).replace(/\\/g, '/');
      if (relPath.includes('/dist/') || relPath.includes('/node_modules/')) continue;
      if (relPath === 'media/marked.umd.js' || relPath === 'media/mermaid.min.js') continue;
      const stat = statSync(absPath);
      if (stat.isDirectory()) {
        walk(absPath);
      } else if (predicate(relPath)) {
        out.push(relPath);
      }
    }
  };
  walk(baseDir);
  return out.sort();
}

const productionFiles = [
  ...collectFiles('src', rel => /\.(ts|js)$/.test(rel)),
  ...collectFiles('media', rel => /\.js$/.test(rel)),
].sort();

const governanceInventoryFiles = new Set([
  'src/app/judgment-owners.ts',
]);

function decisionFilesContaining(pattern) {
  return productionFiles.filter(relPath => !governanceInventoryFiles.has(relPath)).filter((relPath) => {
    const text = readExtensionFile(relPath);
    return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
  });
}

test('ARCH-16 owner registry covers every duplicate-judgment domain', () => {
  const registry = readExtensionFile('src/app/judgment-owners.ts');
  const required = [
    ['tool-protocol', 'src/agent/tool-registry.ts'],
    ['response-integrity', 'src/llm/providers/web-reliability.ts'],
    ['execution-outcome', 'src/execution-outcome-classifier.ts'],
    ['validation-orchestration', 'src/app/verification-planner.ts'],
    ['task-state', 'src/agent/task-todo-ledger.ts'],
    ['context-scope', 'src/app/context-relevance.ts'],
    ['agent-display', 'media/webview-agent-activity.js'],
    ['file-workspace', 'src/workspace/file-context-service.ts'],
    ['build-layout', 'src/cpp-build-layout.ts'],
  ];

  for (const [id, ownerModule] of required) {
    assert.ok(registry.includes(`id: '${id}'`), `${id} must have an owner record`);
    assert.ok(registry.includes(`ownerModule: '${ownerModule}'`), `${id} owner must be ${ownerModule}`);
    assert.ok(extensionFileExists(ownerModule), `${id} owner module must exist`);
  }

  assert.ok(registry.includes('contractTests'), 'owner records must name contract tests');
  assert.ok(registry.includes('guardedTerms'), 'owner records must name guarded terms');
});

test('ARCH-16 app boundary exports the duplicate-judgment owner registry', () => {
  const appIndex = readExtensionFile('src/app/index.ts');
  assert.ok(appIndex.includes("export * from './judgment-owners';"));
});

test('ARCH-16 tool alias search_content is owned by ToolRegistry and generated manifest only', () => {
  const hits = decisionFilesContaining('search_content');
  assert.deepEqual(hits, [
    'media/webview-agent-tool-manifest.js',
    'src/agent/tool-registry.ts',
  ]);
  assert.ok(readExtensionFile('src/agent/tool-registry.ts').includes("search_content: 'grep_search'"));
});

test('ARCH-16 webview tool manifest is generated from ToolRegistry', () => {
  const packageJson = readExtensionFile('package.json');
  const packageVsix = readFileSync(path.resolve(extensionRoot, '../../scripts/package-vsix.mjs'), 'utf8');
  const manifest = readExtensionFile('media/webview-agent-tool-manifest.js');
  const sanitizer = readExtensionFile('media/webview-agent-sanitizer.js');
  const runtime = readExtensionFile('media/webview-runtime.json');

  assert.ok(packageJson.includes('generate-webview-tool-manifest.mjs'), 'compile must refresh generated webview tool manifest');
  assert.ok(packageVsix.includes('generateWebviewToolManifest'), 'VSIX packaging must refresh generated webview tool manifest');
  assert.ok(runtime.indexOf('webview-agent-tool-manifest.js') < runtime.indexOf('webview-agent-sanitizer.js'));
  assert.ok(manifest.includes('Source of truth: packages/vscode-extension/src/agent/tool-registry.ts'));
  assert.ok(manifest.includes('"search_content"'));
  assert.ok(sanitizer.includes('DevSeekAgentToolManifest'), 'sanitizer must read generated tool manifest');
  assert.ok(sanitizer.includes('makeWebviewToolNamePattern'), 'sanitizer regexes must derive tool names from generated manifest');
  assert.ok(!sanitizer.includes('read_file: true'), 'sanitizer must not keep a hand-written tool-name map');
  assert.ok(!sanitizer.includes('search_content'), 'sanitizer must not keep hand-written tool aliases');
  assert.ok(extensionFileExists('test/fixtures/deepseek-tool-transcripts.mjs'), 'DeepSeek transcript replay fixtures must exist');
  assert.ok(extensionFileExists('test/unit/tool-protocol-contract.test.mjs'), 'tool protocol replay contract test must exist');
});

test('ARCH-16 backend cannot reintroduce generic execution-complete UI titles', () => {
  const hits = productionFiles
    .filter(relPath => !governanceInventoryFiles.has(relPath))
    .filter(relPath => relPath.startsWith('src/'))
    .filter(relPath => readExtensionFile(relPath).includes('执行完成'));
  assert.deepEqual(hits, [], 'backend status events must use semantic validation titles, not generic UI text');
});

test('ARCH-16 legacy .devseek-build paths stay limited to compatibility and exclusion code', () => {
  const hits = decisionFilesContaining('.devseek-build');
  assert.deepEqual(hits, ['src/cpp-build-layout.ts']);
  assert.ok(readExtensionFile('src/cpp-build-layout.ts').includes('LEGACY_CPP_BUILD_DIR_NAMES'));
  assert.ok(!readExtensionFile('src/execution-planner.ts').includes('.devseek-build'));
  assert.ok(!readExtensionFile('src/local-execution.ts').includes('.devseek-build'));
  assert.ok(!readExtensionFile('src/validation-planner.ts').includes('.devseek-build'));
});

test('ARCH-16 runtime build planners do not produce legacy .devseek-build paths', () => {
  const hits = [
    'src/execution-planner.ts',
    'src/local-execution.ts',
    'src/tools/terminal.ts',
  ].filter(relPath => readExtensionFile(relPath).includes('.devseek-build'));
  assert.deepEqual(hits, []);
});

test('ARCH-16 unfriendly generated-response placeholder text stays removed from production UI', () => {
  const hits = decisionFilesContaining('可在下方尝试预览/应用');
  assert.deepEqual(hits, []);
});
