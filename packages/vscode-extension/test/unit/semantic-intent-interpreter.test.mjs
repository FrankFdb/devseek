/**
 * Unit tests for app/semantic-intent-interpreter.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/semantic-intent-interpreter.bundle.cjs');

execSync(
  `npx esbuild src/app/semantic-intent-interpreter.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);

const fakeVscode = {
  workspace: {
    getConfiguration() {
      return {
        get() { return undefined; },
      };
    },
  },
  window: {},
  Uri: { file(fsPath) { return { fsPath }; } },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const {
  parseSemanticIntentResponse,
  shouldAskProviderForSemanticIntent,
} = req(bundlePath);

test('parseSemanticIntentResponse: accepts strict provider JSON', () => {
  const parsed = parseSemanticIntentResponse(JSON.stringify({
    mode: 'edit',
    task_kind: 'standalone-program',
    confidence: 0.95,
    mutation: 'create-file',
    target_paths: ['hello.cpp'],
    requires_workspace: true,
    requires_terminal: true,
    requires_external_effect: false,
    requires_clarification: false,
    reason: 'user asks to create a small program',
  }));

  assert.equal(parsed.mode, 'edit');
  assert.equal(parsed.taskKind, 'standalone-program');
  assert.equal(parsed.mutation, 'create-file');
  assert.deepEqual(parsed.targetPaths, ['hello.cpp']);
});

test('parseSemanticIntentResponse: extracts fenced JSON without trusting prose', () => {
  const parsed = parseSemanticIntentResponse([
    '说明文字应被忽略。',
    '```json',
    '{"mode":"plan","task_kind":"planning","confidence":0.82,"mutation":"none","requires_workspace":true}',
    '```',
  ].join('\n'));

  assert.equal(parsed.mode, 'plan');
  assert.equal(parsed.taskKind, 'planning');
  assert.equal(parsed.mutation, 'none');
});

test('parseSemanticIntentResponse: rejects invalid semantic payloads', () => {
  assert.equal(parseSemanticIntentResponse('not json'), undefined);
  assert.equal(parseSemanticIntentResponse('{"mode":"edit","confidence":0,"mutation":"create-file"}'), undefined);
  assert.equal(parseSemanticIntentResponse('{"mode":"unknown","confidence":0.9,"mutation":"none"}'), undefined);
});

test('shouldAskProviderForSemanticIntent: keeps local hard skips local', () => {
  assert.equal(shouldAskProviderForSemanticIntent({
    userText: '',
    files: [],
    localMode: 'qa',
    agentEnabled: true,
  }), false);
  assert.equal(shouldAskProviderForSemanticIntent({
    userText: 'hello',
    files: [],
    localMode: 'smalltalk',
    agentEnabled: true,
  }), false);
  assert.equal(shouldAskProviderForSemanticIntent({
    userText: 'create a file',
    files: [],
    localMode: 'edit',
    agentEnabled: false,
  }), false);
  assert.equal(shouldAskProviderForSemanticIntent({
    userText: 'create a file',
    files: [],
    localMode: 'edit',
    agentEnabled: true,
  }), true);
});

console.log('\nSemantic intent interpreter tests passed.\n');
