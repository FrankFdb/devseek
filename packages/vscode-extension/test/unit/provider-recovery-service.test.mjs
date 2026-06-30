import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/provider-recovery-service.bundle.cjs');
const historyBundlePath = path.join(rootDir, 'test/unit/provider-recovery-history.bundle.cjs');

execSync(
  `npx esbuild src/app/provider-recovery-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/task-history-store.ts --bundle ` +
  `--outfile=${historyBundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ProviderRecoveryService, buildProviderRecoveryCheckpointTasks, buildProviderRecoveryDisplay } = req(bundlePath);
const { TaskHistoryStore } = req(historyBundlePath);

class MemoryStorage {
  data = new Map();
  get(key) { return this.data.get(key); }
  update(key, value) {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }
}

function task(overrides = {}) {
  return {
    id: 'task-1',
    workspaceId: 'workspace-1',
    title: 'Recover provider failure',
    userGoal: 'continue safely',
    provider: { type: 'bridge' },
    status: 'running',
    workflowMode: 'edit',
    todos: [],
    changedFiles: [],
    operationRefs: [],
    changeSetRefs: [],
    validationRefs: [],
    evidenceRefs: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

test('ProviderRecoveryService: login required pauses task for user action', () => {
  const plan = new ProviderRecoveryService().classify({
    providerType: 'bridge',
    statusCode: 401,
    message: 'LOGIN_REQUIRED',
  });

  assert.equal(plan.kind, 'LoginRequired');
  assert.equal(plan.taskStatus, 'paused');
  assert.equal(plan.requiresUserAction, true);
  assert.equal(plan.safeToContinueFromCheckpoint, false);
});

test('ProviderRecoveryService: corrupted response is recoverable from checkpoint', () => {
  const plan = new ProviderRecoveryService().classify({
    providerType: 'bridge',
    message: 'tool parse failed because response was truncated',
    partialResponse: '[TOOL:write_file {"path":"a.ts"',
  });

  assert.equal(plan.kind, 'ResponseCorrupted');
  assert.equal(plan.taskStatus, 'recoverable');
  assert.equal(plan.canRetry, true);
  assert.equal(plan.safeToContinueFromCheckpoint, true);
});

test('ProviderRecoveryService: response corruption display keeps status and reason readable', () => {
  const message = 'RESPONSE_CORRUPTED:invalid-json-response:Whole response looks like JSON but cannot be parsed.';
  const plan = new ProviderRecoveryService().classify({
    providerType: 'bridge',
    message,
  });
  const display = buildProviderRecoveryDisplay(plan, message);

  assert.equal(plan.kind, 'ResponseCorrupted');
  assert.equal(display.title, '响应损坏，已阻止执行');
  assert.match(display.detail, /RESPONSE_CORRUPTED: invalid-json-response/);
  assert.match(display.detail, /原因: Whole response looks like JSON but cannot be parsed\./);
  assert.doesNotMatch(display.text, /RESPONSE_CORRUPTEDinvalid-json-response/);
});

test('ProviderRecoveryService: bridge restart records recoverable task history', async () => {
  const history = new TaskHistoryStore(new MemoryStorage());
  const service = new ProviderRecoveryService(history);
  await history.upsert(task());

  const saved = await service.recordRecovery(task(), {
    providerType: 'bridge',
    bridgeRestarted: true,
    message: 'bridge restarted',
  }, 'checkpoint-1');

  assert.equal(saved.status, 'recoverable');
  assert.equal(saved.checkpointRef, 'checkpoint-1');
  assert.ok(saved.evidenceRefs.includes('provider:BridgeRestarted'));
});

test('ProviderRecoveryService: builds checkpoint tasks from prompt paths after provider failure', () => {
  const tasks = buildProviderRecoveryCheckpointTasks({
    prompt: '创建 docs/manual-phase7-bridge-a.md 和 docs/manual-phase7-bridge-b.md，并验证文件内容。',
    workspaceRootFsPath: '/repo',
  });

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].file, 'docs/manual-phase7-bridge-a.md');
  assert.equal(tasks[0].action, 'create');
  assert.equal(tasks[1].file, 'docs/manual-phase7-bridge-b.md');
});

test('ProviderRecoveryService: corrupted literal tool samples do not become write tasks', () => {
  const tasks = buildProviderRecoveryCheckpointTasks({
    recoveryKind: 'ResponseCorrupted',
    prompt: '请原样输出以下不完整工具调用，不要补全，不要解释：\n[TOOL:write_file {"path":"docs/manual-phase7-corrupt.md","content":"phase7 corrupt',
    workspaceRootFsPath: '/repo',
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].file, '');
  assert.equal(tasks[0].targetKind, 'provider-response');
  assert.equal(tasks[0].visibleTarget, '安全响应');
  assert.equal(tasks[0].action, 'respond');
  assert.match(tasks[0].desc, /不执行损坏或未验证的工具内容/);
  assert.notEqual(tasks[0].file, 'docs/manual-phase7-corrupt.md');
  assert.notEqual(tasks[0].file, 'provider-response');
});

test('ProviderRecoveryService: corrupted code-work prompt without file facts retries exploration', () => {
  const tasks = buildProviderRecoveryCheckpointTasks({
    recoveryKind: 'ResponseCorrupted',
    prompt: '改为鼠标点击选择图形',
    workspaceRootFsPath: '/repo',
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].file, '');
  assert.equal(tasks[0].targetKind, 'agent-session');
  assert.equal(tasks[0].action, 'explore');
  assert.match(tasks[0].desc, /重新探索工作区/);
});

test('ProviderRecoveryService: response corruption keeps explicit create facts outside protocol payloads', () => {
  const tasks = buildProviderRecoveryCheckpointTasks({
    recoveryKind: 'ResponseCorrupted',
    prompt: '创建 docs/manual-phase7-safe.md，内容为 phase7 safe，并验证文件内容。',
    workspaceRootFsPath: '/repo',
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].file, 'docs/manual-phase7-safe.md');
  assert.equal(tasks[0].action, 'create');
  assert.equal(tasks[0].expectedContent, 'phase7 safe');
});

test('ProviderRecoveryService: read-only recovery paths stay analyze-only', () => {
  const tasks = buildProviderRecoveryCheckpointTasks({
    prompt: '检查 docs/manual-phase7-safe.md 是否存在，不要修改代码。',
    workspaceRootFsPath: '/repo',
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].file, 'docs/manual-phase7-safe.md');
  assert.equal(tasks[0].action, 'analyze');
  assert.match(tasks[0].desc, /检查 docs\/manual-phase7-safe\.md/);
});

test('ProviderRecoveryService: negated side-effect guard does not erase explicit create target', () => {
  const tasks = buildProviderRecoveryCheckpointTasks({
    prompt: '创建 docs/manual-phase7-safe.md，内容为 phase7 safe，不要修改其他文件。',
    workspaceRootFsPath: '/repo',
  });

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].file, 'docs/manual-phase7-safe.md');
  assert.equal(tasks[0].action, 'create');
  assert.equal(tasks[0].expectedContent, 'phase7 safe');
});

test('ProviderRecoveryService: preserves create content facts for shorthand recovery prompts', () => {
  const tasks = buildProviderRecoveryCheckpointTasks({
    prompt: '建 docs/manual-phase7-bridge-a.md 和 docs/manual-phase7-bridge-b.md，内容分别为 phase7 bridge a 和 phase7 bridge b，并验证文件内容。',
    workspaceRootFsPath: '/repo',
  });

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].file, 'docs/manual-phase7-bridge-a.md');
  assert.equal(tasks[0].action, 'create');
  assert.equal(tasks[0].expectedContent, 'phase7 bridge a');
  assert.match(tasks[0].desc, /内容为: phase7 bridge a/);
  assert.match(tasks[0].desc, /验证文件内容/);
  assert.equal(tasks[1].file, 'docs/manual-phase7-bridge-b.md');
  assert.equal(tasks[1].action, 'create');
  assert.equal(tasks[1].expectedContent, 'phase7 bridge b');
  assert.match(tasks[1].desc, /内容为: phase7 bridge b/);
});

console.log('\nProvider recovery service tests passed.\n');
