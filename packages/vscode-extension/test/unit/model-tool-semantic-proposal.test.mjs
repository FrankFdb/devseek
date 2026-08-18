import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const proposalBundle = path.join(rootDir, 'test/unit/model-tool-semantic-proposal.bundle.cjs');
const routerBundle = path.join(rootDir, 'test/unit/model-tool-semantic-router.bundle.cjs');

execSync(
  `npx esbuild src/agent/model-tool-semantic-proposal.ts --bundle `
  + `--outfile=${proposalBundle} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);
execSync(
  `npx esbuild src/task-intent-router.ts --bundle `
  + `--outfile=${routerBundle} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const { projectModelToolSemanticProposal } = createRequire(import.meta.url)(proposalBundle);
const { routeTaskIntent } = createRequire(import.meta.url)(routerBundle);

test('Model tool semantic proposal: typo create becomes an arbitrated file change', () => {
  const prompt = '帮我见个 notes/ready.txt，里头就一行 READY，弄完再看眼写对没，别碰别的。';
  const initial = routeTaskIntent(prompt).semanticContract;
  const semanticIntent = projectModelToolSemanticProposal([
    tool('create_file', 'edit', 'workspace-mutation', ['notes/ready.txt']),
  ], initial);
  const route = routeTaskIntent(prompt, { current: initial, semanticIntent });

  assert.equal(semanticIntent.taskKind, 'file-artifact');
  assert.equal(semanticIntent.mutation, 'create-file');
  assert.equal(route.mode, 'edit');
  assert.equal(route.mutation.requested, true);
  assert.deepEqual(route.mutation.targets, ['notes/ready.txt']);
  assert.ok(route.signals.includes('semantic-proposal-accepted'));
});

test('Model tool semantic proposal: concrete tool path refines a basename from directory prose', () => {
  const prompt = '帮我在指定目录 generated/settings 里见个 devseek.ini，写好后读回来确认，别碰其他文件。';
  const initial = routeTaskIntent(prompt).semanticContract;
  const semanticIntent = projectModelToolSemanticProposal([
    tool('create_file', 'edit', 'workspace-mutation', ['generated/settings/devseek.ini']),
  ], initial);
  const route = routeTaskIntent(prompt, { current: initial, semanticIntent });

  assert.deepEqual(initial.mutation.targets, ['devseek.ini']);
  assert.deepEqual(route.mutation.targets, ['generated/settings/devseek.ini']);
  assert.deepEqual(route.semanticContract.taskContract.deliverableTargets, [
    'generated/settings/devseek.ini',
  ]);
});

test('Model tool semantic proposal: same basenames in separate directories stay independent', () => {
  const prompt = '创建 docs/README.md 和 packages/demo/README.md，别改其他文件。';
  const initial = routeTaskIntent(prompt).semanticContract;
  const semanticIntent = projectModelToolSemanticProposal([
    tool('create_file', 'edit', 'workspace-mutation', ['docs/README.md', 'packages/demo/README.md']),
  ], initial);
  const route = routeTaskIntent(prompt, { current: initial, semanticIntent });

  assert.deepEqual(route.mutation.targets, ['docs/README.md', 'packages/demo/README.md']);
});

test('Model tool semantic proposal: mixed-language plan stays non-mutating', () => {
  const prompt = '先 inspect src/math.js，然后 give me a fix plan only，暂时不要 apply，也不要 run command。';
  const initial = routeTaskIntent(prompt).semanticContract;
  const semanticIntent = projectModelToolSemanticProposal([
    tool('read_file', 'read', 'observe', ['src/math.js']),
    tool('manage_todo_list', 'plan', 'observe'),
  ], initial);
  const route = routeTaskIntent(prompt, { current: initial, semanticIntent });

  assert.equal(semanticIntent.taskKind, 'planning');
  assert.equal(route.mode, 'plan');
  assert.equal(route.mutation.requested, false);
  assert.equal(route.validation.commandEvidenceRequired, false);
  assert.equal(route.semanticContract.validation.runRequested, false);
});

test('Model tool semantic proposal: terminal verification cannot imply mutation', () => {
  const prompt = '只跑一下 health 检查，把结果告诉我；不要改文件，失败也不要修。';
  const initial = routeTaskIntent(prompt).semanticContract;
  const semanticIntent = projectModelToolSemanticProposal([
    tool('run_terminal', 'terminal', 'verify'),
  ], initial);
  const route = routeTaskIntent(prompt, { current: initial, semanticIntent });

  assert.equal(semanticIntent.taskKind, 'terminal-validation');
  assert.equal(route.mode, 'run');
  assert.equal(route.mutation.requested, false);
  assert.equal(route.validation.commandEvidenceRequired, true);
});

test('Model tool semantic proposal: explicit no-run remains a hard boundary', () => {
  const prompt = '创建 docs/result.md 写入结果，但不要运行任何命令。';
  const initial = routeTaskIntent(prompt).semanticContract;
  const semanticIntent = projectModelToolSemanticProposal([
    tool('create_file', 'edit', 'workspace-mutation', ['docs/result.md']),
  ], initial);
  const route = routeTaskIntent(prompt, { current: initial, semanticIntent });

  assert.equal(route.mutation.requested, true);
  assert.equal(route.semanticContract.validation.runProhibited, true);
  assert.equal(route.semanticContract.validation.runRequested, false);
});

test('Model tool semantic proposal: memory capture does not request command execution', () => {
  const prompt = '记一下这个项目的习惯：处理 src/bridge.ts 后，用 npm run test:bridge 做聚焦验证；现在只记录，不改文件也不运行。';
  const initial = routeTaskIntent(prompt).semanticContract;
  const semanticIntent = projectModelToolSemanticProposal([
    tool('memory_write', 'memory', 'external-effect'),
  ], initial);
  const route = routeTaskIntent(prompt, { current: initial, semanticIntent });

  assert.equal(semanticIntent.taskKind, 'external-effect');
  assert.equal(route.mode, 'inspect');
  assert.equal(route.mutation.requested, false);
  assert.equal(route.validation.commandEvidenceRequired, false);
  assert.equal(route.semanticContract.validation.runRequested, false);
  assert.ok(route.signals.includes('semantic-proposal-accepted'));
});

test('Model tool semantic proposal: destructive action stays confirmation-gated', () => {
  const prompt = '看看 build/cache.json 现在是什么情况。';
  const initial = routeTaskIntent(prompt).semanticContract;
  const semanticIntent = projectModelToolSemanticProposal([
    tool('delete_file', 'edit', 'workspace-mutation', ['build/cache.json']),
  ], initial);
  const route = routeTaskIntent(prompt, { current: initial, semanticIntent });

  assert.equal(semanticIntent.taskKind, 'destructive');
  assert.equal(route.semanticContract.kind, 'destructive');
  assert.equal(route.requiresConfirmation, true);
  assert.equal(route.mode, 'destructive');
});

function tool(name, kind, purpose, targetPaths = []) {
  return {
    id: `tool-${name}`,
    name,
    input: {},
    source: 'native',
    registered: true,
    kind,
    risk: kind === 'terminal' ? 'high' : 'medium',
    purpose,
    effects: purpose === 'workspace-mutation'
      ? ['workspace-mutation']
      : purpose === 'external-effect'
        ? ['local-state']
        : [],
    protectedPath: false,
    targetPaths,
    executable: true,
  };
}
