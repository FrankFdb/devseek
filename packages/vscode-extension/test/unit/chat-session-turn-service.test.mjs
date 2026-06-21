/**
 * Contract tests for Phase 10 chat session turn boundary.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function bundle(entry, name) {
  const out = path.join(rootDir, `test/unit/${name}.bundle.cjs`);
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${out} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
  return createRequire(import.meta.url)(out);
}

const { ChatSessionTurnService } = bundle('src/app/chat-session-turn-service.ts', 'chat-session-turn-service');

function createDeps(overrides = {}) {
  const calls = [];
  const state = {
    history: [
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
      { role: 'assistant', content: 'd' },
    ],
    activeSessionId: 'old-session',
    lastConversationFiles: ['stale.ts'],
    lastAnalysisText: 'stale analysis',
    lastAgentChangedPaths: ['stale.ts'],
  };
  const deps = {
    getHistory: () => state.history,
    setHistory: (history) => { state.history = history; calls.push(['setHistory', history]); },
    getActiveSessionId: () => state.activeSessionId,
    setActiveSessionId: (sessionId) => { state.activeSessionId = sessionId; calls.push(['setActiveSessionId', sessionId]); },
    generateSessionId: () => 'new-session',
    saveCurrentSession: () => calls.push(['saveCurrentSession']),
    compactAndSaveHistory: async (history, sessionId) => { calls.push(['compactAndSaveHistory', history.length, sessionId]); },
    setSessionServiceActiveId: (sessionId) => calls.push(['setSessionServiceActiveId', sessionId]),
    saveSessionMeta: (meta) => calls.push(['saveSessionMeta', meta]),
    clearSessionRecentFiles: () => calls.push(['clearSessionRecentFiles']),
    saveCurrentSessionFiles: () => calls.push(['saveCurrentSessionFiles']),
    setLastConversationFiles: (files) => { state.lastConversationFiles = files; calls.push(['setLastConversationFiles', files]); },
    setLastAnalysisText: (text) => { state.lastAnalysisText = text; calls.push(['setLastAnalysisText', text]); },
    setLastAgentChangedPaths: (paths) => { state.lastAgentChangedPaths = paths; calls.push(['setLastAgentChangedPaths', paths]); },
    clearSessionHabits: () => calls.push(['clearSessionHabits']),
    clearLearnerSession: () => calls.push(['clearLearnerSession']),
    emitContextFiles: (files) => calls.push(['emitContextFiles', files]),
    now: () => 123,
    ...overrides,
  };
  return { deps, calls, state };
}

test('ChatSessionTurnService starts a new session and clears inherited context', async () => {
  const { deps, calls, state } = createDeps();
  const service = new ChatSessionTurnService(deps);

  const result = await service.beginTurn({
    newSession: true,
    userDisplay: 'new task title',
    userExplicitlyAttachedFiles: false,
  });

  assert.deepEqual(result, { newSessionStarted: true, contextFilesCleared: true });
  assert.equal(state.activeSessionId, 'new-session');
  assert.deepEqual(state.history, []);
  assert.deepEqual(state.lastConversationFiles, []);
  assert.deepEqual(state.lastAgentChangedPaths, []);
  assert.equal(state.lastAnalysisText, '');
  assert.ok(calls.some(call => call[0] === 'compactAndSaveHistory' && call[1] === 4 && call[2] === 'old-session'));
  assert.ok(calls.some(call => call[0] === 'saveSessionMeta' && call[1].id === 'new-session' && call[1].title === 'new task title'));
  assert.ok(calls.some(call => call[0] === 'emitContextFiles' && call[1].length === 0));
});

test('ChatSessionTurnService clears stale context when a turn has no explicit attachments', async () => {
  const { deps, calls, state } = createDeps();
  const service = new ChatSessionTurnService(deps);

  const result = await service.beginTurn({
    newSession: false,
    userDisplay: 'continue task',
    userExplicitlyAttachedFiles: false,
  });

  assert.deepEqual(result, { newSessionStarted: false, contextFilesCleared: true });
  assert.equal(state.activeSessionId, 'old-session');
  assert.deepEqual(state.history.map(item => item.content), ['a', 'b', 'c', 'd']);
  assert.deepEqual(state.lastConversationFiles, []);
  assert.ok(calls.some(call => call[0] === 'emitContextFiles' && call[1].length === 0));
  assert.ok(!calls.some(call => call[0] === 'setActiveSessionId'));
});

test('ChatSessionTurnService preserves context when files are explicitly attached', async () => {
  const { deps, calls, state } = createDeps();
  const service = new ChatSessionTurnService(deps);

  const result = await service.beginTurn({
    newSession: false,
    userDisplay: 'continue with file',
    userExplicitlyAttachedFiles: true,
  });

  assert.deepEqual(result, { newSessionStarted: false, contextFilesCleared: false });
  assert.deepEqual(state.lastConversationFiles, ['stale.ts']);
  assert.equal(calls.length, 0);
});
