/** User-language corpus for the model-led routing boundary. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const controllerBundle = path.join(rootDir, 'test/unit/intent-behavior-matrix.controller.bundle.cjs');
const permissionBundle = path.join(rootDir, 'test/unit/intent-behavior-matrix.permission.bundle.cjs');

for (const [entry, outfile] of [
  ['src/app/chat-controller.ts', controllerBundle],
  ['src/app/permission-service.ts', permissionBundle],
]) {
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${outfile} --format=cjs --platform=node --external:vscode`,
    { cwd: rootDir, stdio: 'pipe' },
  );
}

const req = createRequire(import.meta.url);
const { ChatRouteController } = req(controllerBundle);
const { decideToolPermission } = req(permissionBundle);
const controller = new ChatRouteController();

const userCases = [
  ['greeting-en', 'hello'],
  ['greeting-zh', '你好'],
  ['direct-qa', '说明gpu cpu'],
  ['elliptical-followup', '再详细说明他们的差异'],
  ['typo-homophone', '帮我见个 notes/ready.txt，里头只放 READY'],
  ['typo-coding', '请吧登路页奔溃修好，测是也跑一下'],
  ['colloquial-en', 'can u chek auth then fix watever is breaking login'],
  ['mixed-language', '先 inspect src/math.js，然后 give me a fix plan only'],
  ['japanese', 'src/cache.ts を確認して、問題があれば修正してください'],
  ['spanish', 'src/cache.ts no funciona, arreglalo y run tests'],
  ['read-only', '只分析 src/cache.ts，不要修改文件，也不要运行命令'],
  ['conditional', '先看看 src/auth.ts，没问题的话不要改，有问题再修复并验证'],
  ['exact-file', '创建 result.txt，内容为 MODEL_FIRST_OK'],
  ['multi-file', '修改 src/a.ts 和 src/b.ts，然后运行测试'],
  ['validation', '只运行 npm test，把结果告诉我，失败也不要修'],
  ['destructive', '删除 build/cache.json'],
  ['external', '发布 2.0.0 到 npm'],
  ['identifier-test', 'MODEL_LATEST_OK'],
  ['identifier-release', '解释 ReleaseManager.publish() 的职责'],
  ['literal-tool', '说明 [TOOL:run_terminal command="npm test"] 这段格式'],
  ['path-with-test', '读取 src/MODEL_LATEST_OK.ts'],
  ['uav-isolation', '这是新对话，只解释 CPU 与 GPU，不要引用无人机项目'],
  ['steer-like', '更正：别创建 alpha.txt，改为 beta.txt'],
  ['failure-context', '编译报错 undefined reference，帮我定位根因'],
  ['large-task', '在 code 目录实现一个约千行的 C++ 动画程序并编译验证'],
];

for (const [id, prompt] of userCases) {
  test(`model-led corpus: ${id}`, () => {
    const decision = controller.decide({
      userDisplay: prompt,
      prompt,
      files: [],
      agentEnabled: true,
    });

    assert.equal(decision.intent.kind, 'chat');
    assert.equal(decision.intent.mode, 'model-led');
    assert.equal(decision.intent.semanticContract.intent.taskKind, 'ambiguous');
    assert.equal(decision.intent.semanticContract.mutation.requested, false);
    assert.equal(decision.intent.semanticContract.validation.requested, false);
    assert.equal(decision.workflow.kind, 'model-agent');
    assert.equal(decision.workflow.useAgent, true);
    assert.equal(decision.workflow.toolPolicyMode, 'model-led');
  });
}

test('attachment display metadata does not replace the raw current user message', () => {
  const decision = controller.decide({
    userDisplay: '📎 `main.cpp`\n\n说明这段代码',
    prompt: '**附件：`main.cpp`**\nint main() {}\n\n---\n说明这段代码',
    files: ['/tmp/main.cpp'],
    agentEnabled: true,
  });

  assert.equal(decision.intentRoutingText, '说明这段代码');
  assert.equal(decision.intent.semanticContract.prompt, '说明这段代码');
  assert.equal(decision.workflow.kind, 'model-agent');
});

test('model-led surface exposes tools while concrete local risk still gates execution', () => {
  const decision = controller.decide({
    userDisplay: '完成这个任务',
    prompt: '完成这个任务',
    files: [],
    agentEnabled: true,
  });
  const policy = decision.toolPolicy;

  assert.equal(decideToolPermission(policy, { kind: 'read', risk: 'low' }).action, 'allow');
  assert.equal(decideToolPermission(policy, {
    kind: 'edit',
    risk: 'medium',
    mutatesWorkspace: true,
    protectedPath: true,
  }).action, 'requireConfirm');
  assert.equal(decideToolPermission(policy, { kind: 'terminal', risk: 'high' }).action, 'requireConfirm');
  assert.equal(decideToolPermission(policy, { kind: 'terminal' }).action, 'requireConfirm');
});

test('empty input is the only ordinary local no-turn decision', () => {
  const decision = controller.decide({
    userDisplay: '   ',
    prompt: '   ',
    files: [],
    agentEnabled: true,
  });

  assert.deepEqual(decision.intent.blockers, ['empty-prompt']);
  assert.equal(decision.workflow.kind, 'plain-chat');
  assert.equal(decision.workflow.useAgent, false);
});
