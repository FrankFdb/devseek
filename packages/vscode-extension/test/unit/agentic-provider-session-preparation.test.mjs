import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-provider-session-preparation-'));
const bundlePath = path.join(tempRoot, 'agentic-provider-recovery-coordinator.cjs');

execFileSync('npx', [
  'esbuild',
  'src/agent/agentic-provider-recovery-coordinator.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  `--outfile=${bundlePath}`,
], { cwd: rootDir, stdio: 'pipe' });

const {
  AgenticProviderRecoveryCoordinator,
} = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

test('a requested fresh Provider session is rebuilt from current progress before the next model turn', () => {
  const messages = [
    { role: 'user', content: 'Implement the current C++ task.' },
    { role: 'assistant', content: 'Old Provider chatter that is not execution evidence.' },
    { role: 'user', content: '[工具结果 Round 3]\nwrite_file completed' },
  ];
  let totalChars = messages.reduce((total, message) => total + message.content.length, 0);
  let contextResetCount = 0;
  const state = {
    promptRequiresTools: () => true,
    sawWorkTool: () => true,
    currentTodos: () => [{ id: 1, title: 'Run final validation', status: 'in-progress' }],
    noToolRounds: () => 0,
    setNoToolRounds() {},
    round: () => 4,
    totalChars: () => totalChars,
    setTotalChars(value) { totalChars = value; },
    progressEpoch: () => 7,
    missingEvidence: () => ['current-source-validation'],
    completionBlockers: () => [],
    complete() {},
  };
  const coordinator = new AgenticProviderRecoveryCoordinator({
    workspaceRoot: tempRoot,
    taskFile: 'src/main.cpp',
    taskAction: 'repair',
    callbacks: { onAgentStatus() {} },
    executionContext: {},
    writeAuthority: {},
    requirementReview: {
      completionObligation: () => undefined,
    },
    sourceValidation: {
      currentSourceIsValidated: () => false,
    },
    terminalFailureProgress: {},
    contextInvestigation: {
      reset() { contextResetCount += 1; },
    },
    textToolProtocol: {
      version: 'devseek.text-tools/v1',
      channelId: 'provider-session-test-channel',
    },
    messages,
    evidenceRefs: [],
    readEvidencePaths: new Set(['src/main.cpp']),
    writtenFiles: [{
      path: path.join(tempRoot, 'src/main.cpp'),
      basename: 'main.cpp',
      linesAdded: 12,
      linesRemoved: 2,
      action: 'update',
    }],
    terminalEvidence: [],
    toolExecutionReceipts: [],
    changeReceipts: [],
    verificationReceipts: () => [],
    appendUserFeedback(content) { messages.push({ role: 'user', content }); },
    state,
  });

  coordinator.requestFreshProviderSession();

  assert.equal(contextResetCount, 1);
  assert.equal(coordinator.takeFreshProviderSession(4), true);
  assert.equal(messages.filter(message => (
    typeof message.content === 'string'
      && message.content.startsWith('[DevSeek Provider Recovery Progress]')
  )).length, 1);
  assert.equal(messages.some(message => message.content.includes('Old Provider chatter')), false);
  assert.match(messages.at(-2).content, /progressEpoch: 7/u);
  assert.match(messages.at(-2).content, /currentSourceValidated":false/u);
  assert.match(messages.at(-1).content, /^\[工具结果 Round 3\]/u);
  assert.equal(totalChars, messages.reduce((total, message) => total + message.content.length, 0));
});
