import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/model-led-intent-boundary.bundle.cjs');
const promptBundlePath = path.join(rootDir, 'test/unit/model-led-agentic-system-prompt.bundle.cjs');
const semanticRouteBundlePath = path.join(rootDir, 'test/unit/model-led-semantic-route.bundle.cjs');

execSync(
  `npx esbuild src/app/chat-controller.ts --bundle `
    + `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/agent/agentic-system-prompt.ts --bundle `
    + `--outfile=${promptBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/app/semantic-route-service.ts --bundle `
    + `--outfile=${semanticRouteBundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return { workspace: { workspaceFolders: [] } };
  return originalLoad.call(this, request, parent, isMain);
};
const { ChatRouteController } = req(bundlePath);
const { buildAgenticSystemPrompt } = req(promptBundlePath);
const { resolveSemanticRouteDecision } = req(semanticRouteBundlePath);
Module._load = originalLoad;

const userInputs = [
  '请把 src/login.ts 修好，然后跑测试。',
  '请吧 src/login.ts 修号，然候跑侧试。',
  '先分析 src/login.ts，不要改源代码。',
  '先分西 src/login.ts，不要该原代码。',
  '请删除 dist/cache。',
  '请删出 dist/cache。',
  '请把这些改动提交并推送。',
  '请吧这些改动题交并推送。',
  'Should I delete dist/cache?',
  'What does this TypeScript error mean?',
  'pls chek src/api.ts n tell me why its slow, dont edit',
  '修下 auth 但是先别写我想先看原因',
  '帮俺瞅瞅这个报错咋整，先甭动代码',
  'src/cache.ts 这块咋肥四',
  '把 login.ts 修好 tests green 就行',
  '看下 README 然后告诉我下一布咋办',
  '先列个方案，等我说开整再改',
  'review this diff and flag bugs only',
  'fix 登录 bug but dont touch the API contract',
  '把刚才那个改动撤了，其他别碰',
  '继续，按你刚才的方案做',
  '不是 auth.ts，是 cache.ts，刚才说错了',
  '提交代码但不要 push',
  '发个 PR，标题沿用刚才那个',
  '跑一下测式，挂了就修，修完再跑',
  '处理一下这个',
  'hello',
];

test('ModelLedIntentBoundary: diverse and noisy user inputs reach one main model loop', () => {
  const controller = new ChatRouteController();

  for (const prompt of userInputs) {
    const decision = controller.decide({
      userDisplay: prompt,
      prompt,
      files: [],
      agentEnabled: true,
    });
    assert.equal(decision.workflow.kind, 'model-agent', prompt);
    assert.equal(decision.workflow.useAgent, true, prompt);
    assert.equal(decision.workflow.toolPolicyMode, 'model-led', prompt);
    assert.equal(decision.toolPolicy.mode, 'model-led', prompt);
    assert.ok(decision.toolPolicy.allowedToolKinds.includes('edit'), prompt);
    assert.ok(decision.toolPolicy.allowedToolKinds.includes('terminal'), prompt);
  }
});

test('ModelLedIntentBoundary: explicit product opt-out still bypasses the agent loop', () => {
  const controller = new ChatRouteController();
  const prompt = '修复 src/login.ts';
  const decision = controller.decide({
    userDisplay: prompt,
    prompt,
    files: [],
    agentEnabled: true,
    forceNoAgent: true,
  });

  assert.equal(decision.workflow.kind, 'plain-chat');
  assert.equal(decision.workflow.useAgent, false);
});

test('ModelLedIntentBoundary: the main prompt owns typo recovery and action selection', () => {
  const prompt = buildAgenticSystemPrompt(
    '/workspace',
    [],
  );

  assert.match(prompt, /原始自然语言目标/u);
  assert.match(prompt, /错别字、同音字、口语、省略和中英混输/u);
  assert.match(prompt, /提问、要求澄清、只读调查，还是要求执行动作/u);
  assert.match(prompt, /工具调用只是动作提案/u);
  assert.match(prompt, /简单问答直接回答/u);
  assert.match(prompt, /仅在任务确实包含多个可验证步骤时使用 manage_todo_list/u);
  assert.doesNotMatch(prompt, /第一轮必须先输出/u);
  assert.doesNotMatch(prompt, /当前是简单文件写入/u);
});

test('ModelLedIntentBoundary: direct-answer delivery remains model-owned without local family routing', () => {
  const prompt = buildAgenticSystemPrompt(
    '/workspace',
    [],
  );

  assert.match(prompt, /简单问答直接回答/u);
  assert.match(prompt, /纯问答可以直接回答/u);
  assert.match(prompt, /不要求固定格式、长度或结论关键词/u);
  assert.match(prompt, /需要工作区事实时先读取/u);
  assert.match(prompt, /工具调用只是动作提案/u);
  assert.doesNotMatch(prompt, /结论需包含：证据/u);
});

test('ModelLedIntentBoundary: semantic route selection calls only the local controller', async () => {
  const expected = { intent: { mode: 'qa' }, workflow: { kind: 'model-agent' }, toolPolicy: { mode: 'model-led' } };
  const progress = [];
  let controllerCalls = 0;
  const decision = await resolveSemanticRouteDecision({
    userDisplay: '请吧这个问题解释清除',
    prompt: '请吧这个问题解释清除',
    files: [],
    agentEnabled: true,
    controller: {
      decide(input) {
        controllerCalls += 1;
        assert.equal(input.prompt, '请吧这个问题解释清除');
        return expected;
      },
    },
    recordProgress(stage, extra) { progress.push({ stage, extra }); },
  });

  assert.equal(decision, expected);
  assert.equal(controllerCalls, 1);
  assert.deepEqual(progress, [{
    stage: 'run-chat-model-led-route-selected',
    extra: { localModeHint: 'qa', workflowKind: 'model-agent', toolPolicyMode: 'model-led' },
  }]);
});

test('ModelLedIntentBoundary: ordered steering invalidates stale actions before receipt-backed contract revision', () => {
  const runtimeSource = readFileSync(
    path.join(rootDir, 'src/app/coding-kernel-execution.ts'),
    'utf8',
  );
  const steerSource = readFileSync(
    path.join(rootDir, 'src/agent/user-steer.ts'),
    'utf8',
  );
  const runControlSource = readFileSync(
    path.join(rootDir, '../shared/src/coding-run-control.ts'),
    'utf8',
  );
  const reconcilerSource = readFileSync(
    path.join(rootDir, 'src/app/observed-task-contract-reconciler.ts'),
    'utf8',
  );

  assert.match(steerSource, /role:\s*'user'/u);
  assert.match(runtimeSource, /runControl\.consumeSteering\(\)/u);
  assert.match(runtimeSource, /runControl\.closeSteeringIntake\(\)/u);
  assert.match(runtimeSource, /onSettledModelSemanticContract:\s*settlement\s*=>/u);
  assert.match(runtimeSource, /reconcileObservedTaskContract\(/u);
  assert.match(runtimeSource, /taskContractRevision\.revise\(candidate\)/u);
  assert.match(runControlSource, /invalidatesPendingActions:\s*true/u);
  assert.match(runControlSource, /requiresModelReinterpretation:\s*true/u);
  assert.match(reconcilerSource, /receipt\.status === 'committed'/u);
  assert.doesNotMatch(steerSource, /REAUTHORIZE_RE|REPLACE_SCOPE_RE/u);
});

test('ModelLedIntentBoundary: model interpretation reaches completion only through local action evidence', () => {
  const loopSource = readFileSync(
    path.join(rootDir, 'src/agent/agentic-loop.ts'),
    'utf8',
  );
  const authoritySource = readFileSync(
    path.join(rootDir, 'src/agent/write-authority.ts'),
    'utf8',
  );
  const runtimeSource = readFileSync(
    path.join(rootDir, 'src/app/coding-kernel-execution.ts'),
    'utf8',
  );
  const reconcilerSource = readFileSync(
    path.join(rootDir, 'src/app/observed-task-contract-reconciler.ts'),
    'utf8',
  );
  const settlementSource = readFileSync(
    path.join(rootDir, 'src/agent/model-semantic-settlement.ts'),
    'utf8',
  );

  assert.match(authoritySource, /settleModelSemanticProposal\(receipts\)/u);
  assert.match(authoritySource, /receiptMatchesSemanticBinding/u);
  assert.match(
    authoritySource,
    /get completionSemanticContract\(\)\s*\{\s*return settledModelSemanticContract\s*\?\?\s*turnSemanticContract;/u,
  );
  assert.match(loopSource, /modelSemanticSettlement\.observe\(loopRes\)/u);
  assert.match(settlementSource, /input\.authority\.settleModelSemanticProposal\(toolReceipts\)/u);
  assert.match(settlementSource, /onSettledModelSemanticContract\?\.\(/u);
  assert.ok(
    loopSource.indexOf('executeScheduledToolLoop(')
      < loopSource.indexOf('modelSemanticSettlement.observe(loopRes)'),
    'tool execution must precede semantic settlement',
  );
  assert.match(runtimeSource, /reconcileObservedTaskContract\(/u);
  assert.match(runtimeSource, /kernelRequest\.taskContractRevision\.revise\(candidate\)/u);
  assert.match(reconcilerSource, /receipt\.status === 'committed'/u);
  assert.match(reconcilerSource, /observedDeliverableTargets/u);
  assert.match(reconcilerSource, /current\.scope\.exclude/u);
  assert.doesNotMatch(reconcilerSource, /semanticContract\.mutation\.targets/u);
});
