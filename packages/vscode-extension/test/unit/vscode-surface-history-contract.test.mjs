/**
 * Static contract for direct VS Code chat returns.
 *
 * These branches do not enter the full Agent loop, but they are still visible
 * user turns and must appear correctly after reopening History.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const extensionSource = readFileSync(path.join(rootDir, 'src/extension.ts'), 'utf8');

test('VS Code direct /init response records visible history with displayPrompt', () => {
  const branch = sourceBetween(
    'if (isProjectInitRequest(userDisplay) || isProjectInitRequest(prompt))',
    'const initialRouteDecision = chatRouteController.decide',
  );

  assert.match(branch, /directVisibleResponsePublisher\.publish\(\{[\s\S]*userDisplay,[\s\S]*userMessagePrompt:\s*prompt,[\s\S]*responsePrompt:\s*prompt,[\s\S]*responseText:\s*text/);
  assert.doesNotMatch(branch, /nonBridgeChatHistory\.push\(\{ role: 'user', content: prompt \}\)/);
});

test('VS Code provider status direct response records visible history with displayPrompt', () => {
  const branch = sourceBetween(
    'if (providerStatusResponse) {',
    "if (initialRouteDecision.intent.mode === 'smalltalk')",
  );

  assert.match(branch, /directVisibleResponsePublisher\.publish\(\{[\s\S]*userDisplay,[\s\S]*userMessagePrompt:\s*prompt,[\s\S]*responsePrompt:\s*initialRouteDecision\.intentRoutingText,[\s\S]*responseText:\s*providerStatusResponse/);
  assert.doesNotMatch(branch, /recordTrackedChatHistory\(\{/);
  assert.doesNotMatch(branch, /nonBridgeChatHistory\.push\(\{ role: 'user', content: prompt \}\)/);
});

test('VS Code smalltalk direct response records visible history with displayPrompt', () => {
  const branch = sourceBetween(
    "if (initialRouteDecision.intent.mode === 'smalltalk')",
    'if (!newSession && nonBridgeChatHistory.length === 0',
  );

  assert.match(branch, /const reply = buildSmalltalkReply\(initialRouteDecision\.intentRoutingText\);/);
  assert.match(branch, /directVisibleResponsePublisher\.publish\(\{[\s\S]*userDisplay,[\s\S]*userMessagePrompt:\s*prompt,[\s\S]*responsePrompt:\s*initialRouteDecision\.intentRoutingText,[\s\S]*responseText:\s*reply/);
  assert.doesNotMatch(branch, /nonBridgeChatHistory\.push\(\{ role: 'user', content: prompt \}\)/);
});

function sourceBetween(startNeedle, endNeedle) {
  const start = extensionSource.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing branch start: ${startNeedle}`);
  const end = extensionSource.indexOf(endNeedle, start);
  assert.notEqual(end, -1, `missing branch end: ${endNeedle}`);
  return extensionSource.slice(start, end);
}
