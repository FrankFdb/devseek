/**
 * VS Code surface history contract.
 *
 * User-visible history must persist the user's display prompt, while hidden
 * routing/provider prompts remain transport-only details.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/chat-history-tracker.bundle.cjs');

execSync(
  `npx esbuild src/app/chat-history-tracker.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { recordTrackedChatHistory } = req(bundlePath);

function createRecorderState() {
  const calls = [];
  const state = {
    history: [],
    sessions: [{ id: 'session-1', title: 'old', createdAt: 1, updatedAt: 1 }],
  };
  const deps = {
    activeSessionId: 'session-1',
    getHistory: () => state.history,
    setHistory: (history) => {
      state.history = history;
      calls.push(['setHistory', history]);
    },
    compactAndSaveHistory: async (history, sessionId) => {
      calls.push(['compactAndSaveHistory', history.length, sessionId]);
    },
    getFreshSummary: () => undefined,
    getSessions: () => state.sessions,
    saveSessionMeta: (meta) => {
      state.sessions = state.sessions.map(session => session.id === meta.id ? meta : session);
      calls.push(['saveSessionMeta', meta]);
    },
    saveCurrentSession: () => calls.push(['saveCurrentSession']),
  };
  return { calls, state, deps };
}

test('chat history tracker persists displayPrompt instead of hidden routing prompt', () => {
  const { state, deps } = createRecorderState();
  const hiddenPrompt = [
    'SYSTEM: hidden provider instructions',
    'TOOL CONTRACT: do not show this to the user',
    'User asked: 写一个 hello 程序',
  ].join('\n');

  recordTrackedChatHistory({
    ...deps,
    opts: {
      prompt: hiddenPrompt,
      displayPrompt: '写一个 hello 程序',
      trackHistory: true,
    },
    response: '已创建 hello.cpp，并完成 g++ 编译运行验证。',
  });

  assert.equal(state.history.length, 2);
  assert.deepEqual(state.history[0], { role: 'user', content: '写一个 hello 程序' });
  assert.equal(state.history[1].role, 'assistant');
  assert.match(state.history[1].content, /hello\.cpp/);
  assert.doesNotMatch(JSON.stringify(state.history), /SYSTEM: hidden provider instructions/);
  assert.doesNotMatch(JSON.stringify(state.history), /TOOL CONTRACT/);
});

test('chat history tracker leaves history unchanged when tracking is disabled', () => {
  const { calls, state, deps } = createRecorderState();

  recordTrackedChatHistory({
    ...deps,
    opts: {
      prompt: 'transport-only prompt',
      displayPrompt: 'visible prompt',
      trackHistory: false,
    },
    response: 'ignored',
  });

  assert.deepEqual(state.history, []);
  assert.deepEqual(calls, []);
});
