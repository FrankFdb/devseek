import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../..');
const bundlePath = path.join(__dirname, 'agent-turn-routing-service.bundle.cjs');

execFileSync('npx', [
  'esbuild',
  'src/app/agent-turn-routing-service.ts',
  '--bundle',
  `--outfile=${bundlePath}`,
  '--format=cjs',
  '--platform=node',
  '--external:vscode',
], { cwd: rootDir, stdio: 'pipe' });

const require = createRequire(import.meta.url);
const { decideAgentTurnRoute } = require(bundlePath);

function createController() {
  const calls = [];
  return {
    calls,
    controller: {
      decide(input) {
        calls.push(input);
        return { marker: 'decision' };
      },
    },
  };
}

test('AgentTurnRoutingService: continuation restores the durable semantic contract once', () => {
  const { calls, controller } = createController();
  const previous = { version: 'devseek.task-semantic-contract/v3' };
  let loadCount = 0;
  const resolution = decideAgentTurnRoute(controller, {
    newSession: false,
    userDisplay: '继续优化，但不要运行测试。',
    prompt: '继续优化，但不要运行测试。',
    files: [],
    agentEnabled: true,
    loadPreviousSemanticContract: () => {
      loadCount += 1;
      return previous;
    },
  });

  assert.equal(loadCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].semanticContext.previous, previous);
  assert.deepEqual(calls[0].semanticContext.revision, { strategy: 'merge' });
  assert.equal(resolution.semanticContext, calls[0].semanticContext);
  assert.deepEqual(resolution.decision, { marker: 'decision' });
});

test('AgentTurnRoutingService: approval shorthand restores the durable semantic contract', () => {
  const { calls, controller } = createController();
  const previous = { version: 'devseek.task-semantic-contract/v3' };
  let loadCount = 0;
  const resolution = decideAgentTurnRoute(controller, {
    newSession: false,
    userDisplay: 'go ahead',
    prompt: 'go ahead',
    files: [],
    agentEnabled: true,
    loadPreviousSemanticContract: () => {
      loadCount += 1;
      return previous;
    },
  });

  assert.equal(loadCount, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].semanticContext.previous, previous);
  assert.deepEqual(calls[0].semanticContext.revision, { strategy: 'merge' });
  assert.equal(resolution.semanticContext, calls[0].semanticContext);
});

test('AgentTurnRoutingService: a new session cannot inherit an earlier contract', () => {
  const { calls, controller } = createController();
  let loadCount = 0;
  const resolution = decideAgentTurnRoute(controller, {
    newSession: true,
    userDisplay: '继续优化。',
    prompt: '继续优化。',
    files: [],
    agentEnabled: true,
    loadPreviousSemanticContract: () => {
      loadCount += 1;
      return { version: 'devseek.task-semantic-contract/v3' };
    },
  });

  assert.equal(loadCount, 0);
  assert.equal(calls[0].semanticContext, undefined);
  assert.equal(resolution.semanticContext, undefined);
});

test('AgentTurnRoutingService: unrelated smalltalk does not inherit task semantics', () => {
  const { calls, controller } = createController();
  let loadCount = 0;
  decideAgentTurnRoute(controller, {
    newSession: false,
    userDisplay: '你好，今天怎么样？',
    prompt: '你好，今天怎么样？',
    files: [],
    agentEnabled: true,
    loadPreviousSemanticContract: () => {
      loadCount += 1;
      return { version: 'devseek.task-semantic-contract/v3' };
    },
  });

  assert.equal(loadCount, 0);
  assert.equal(calls[0].semanticContext, undefined);
});

test('AgentTurnRoutingService: targeted code task does not inherit a prior deliverable contract', () => {
  const { calls, controller } = createController();
  let loadCount = 0;
  decideAgentTurnRoute(controller, {
    newSession: false,
    userDisplay: '请修复 src/math.js 中 add(a, b) 的明显错误。要求 add(2, 3) 返回 5。',
    prompt: '请修复 src/math.js 中 add(a, b) 的明显错误。要求 add(2, 3) 返回 5。',
    files: [],
    agentEnabled: true,
    loadPreviousSemanticContract: () => {
      loadCount += 1;
      return { version: 'devseek.task-semantic-contract/v3' };
    },
  });

  assert.equal(loadCount, 0);
  assert.equal(calls[0].semanticContext, undefined);
});
