/** Static contracts for VS Code chat routing and visible history. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const extensionSource = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');
const projectInitSource = readFileSync(path.join(rootDir, 'src/app/project-init-service.ts'), 'utf8');

test('VS Code /init preserves display input while submitting a model-led task', () => {
  const branch = sourceBetween(
    'let effectiveFiles = normalizeConversationFiles(files);',
    'await getChatSessionTurnService(webview).beginTurn({',
  );

  assert.match(branch, /prompt = resolveProjectInitPrompt\(userDisplay, prompt\) \?\? prompt/);
  assert.match(projectInitSource, /String\(text \|\| ''\)\.trim\(\) === PROJECT_INIT_COMMAND/);
  assert.match(projectInitSource, /inspect the repository/i);
  assert.doesNotMatch(projectInitSource, /publish\(|writeFile|readFile|readdir/);
});

test('VS Code provider status direct response records visible history with displayPrompt', () => {
  const branch = sourceBetween(
    'if (providerStatusResponse) {',
    '// If this is the first user message of a restored session',
  );

  assert.match(branch, /directVisibleResponsePublisher\.publish\(\{[\s\S]*userDisplay,[\s\S]*userMessagePrompt:\s*prompt,[\s\S]*responsePrompt:\s*initialRouteDecision\.intentRoutingText,[\s\S]*responseText:\s*providerStatusResponse/);
  assert.doesNotMatch(branch, /recordTrackedChatHistory\(\{/);
  assert.doesNotMatch(branch, /nonBridgeChatHistory\.push\(\{ role: 'user', content: prompt \}\)/);
});

test('VS Code provider status checks only the explicit command text', () => {
  const call = sourceBetween(
    'const providerStatusResponse = await resolveProviderStatusResponse({',
    'if (providerStatusResponse) {',
  );

  assert.match(call, /prompt:\s*initialRouteDecision\.intentRoutingText/);
  assert.doesNotMatch(call, /routedIntent|family|mode|keyword/);
});

test('ordinary smalltalk has no local response shortcut', () => {
  assert.doesNotMatch(extensionSource, /buildSmalltalkReply|intent\.mode === 'smalltalk'/);
});

function sourceBetween(startNeedle, endNeedle) {
  const start = extensionSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing branch start: ${startNeedle}`);
  const end = extensionSource.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing branch end: ${endNeedle}`);
  return extensionSource.slice(start, end);
}
