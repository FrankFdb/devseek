import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');

function source(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

test('VS Code command chat projection has one owner boundary', () => {
  const commands = source('src/commands/index.ts');
  const registration = source('src/ui/extension-command-registration.ts');
  const projector = source('src/app/agent-command-surface-projection.ts');

  assert.match(projector, /function createAgentCommandSurfaceProjection/);
  assert.doesNotMatch(
    commands,
    /executeCommand\(\s*['_"]_deepseek\.askChat['"]/,
    'command implementations must not bypass the projection owner',
  );
  assert.doesNotMatch(
    registration,
    /deps\.pushChatPanel\s*\(/,
    'registered VS Code command paths must not push chat directly',
  );
  assert.match(registration, /createAgentCommandSurfaceProjection\(\{/);
  assert.match(registration, /pushChatPanel:\s*deps\.pushChatPanel/);
  assert.match(registration, /source:\s*'devseek\.runTerminalCommand'/);
  assert.match(registration, /source:\s*'devseek\.inlineChat'/);
});

test('public code commands inject projector instead of depending on hidden command relay', () => {
  const commands = source('src/commands/index.ts');
  const registration = source('src/ui/extension-command-registration.ts');

  for (const command of ['explainCode', 'fixBug', 'refactorCode', 'genTest', 'genDoc', 'askQuestion']) {
    assert.match(
      commands,
      new RegExp(`export async function ${command}\\(projector: AgentCommandSurfaceProjector\\)`),
      `${command} must accept the projection owner explicitly`,
    );
  }

  for (const commandId of [
    'devseek.explain',
    'devseek.fix',
    'devseek.refactor',
    'devseek.genTest',
    'devseek.genDoc',
    'devseek.ask',
  ]) {
    assert.match(
      registration,
      new RegExp(`\\['${commandId}', async \\(\\) => [a-zA-Z]+\\(commandProjector\\)\\]`),
      `${commandId} must be wired through the shared projector`,
    );
  }

  assert.match(
    registration,
    /'_deepseek\.askChat'[\s\S]*?commandProjector\.projectToChat\(\{[\s\S]*?source:\s*'_deepseek\.askChat'/,
    'hidden relay must stay a compatibility shim over the projection owner',
  );
});

test('R1-D2A VS Code code commands do not own provider or editor mutation runtime', () => {
  const commands = source('src/commands/index.ts');
  const registration = source('src/ui/extension-command-registration.ts');

  assert.doesNotMatch(
    commands,
    /export type CommandRouteChat/,
    'public VS Code code commands must not expose a second provider routing contract',
  );
  assert.doesNotMatch(
    commands,
    /routeChat\s*\(/,
    'public VS Code code commands must project AgentCommand requests instead of calling the provider directly',
  );
  assert.doesNotMatch(
    commands,
    /editor\.edit\s*\(/,
    'public VS Code code commands must not mutate editor text outside the Agent/Mutation authority',
  );
  assert.doesNotMatch(
    registration,
    /applyInlineChatResult[\s\S]*?routeChat\s*\(/,
    'inline chat must not keep a direct provider fallback after VS Code atomic cutover',
  );
  assert.doesNotMatch(
    registration,
    /applyInlineChatResult[\s\S]*?editor\.edit\s*\(/,
    'inline chat must not apply direct editor edits after VS Code atomic cutover',
  );
  for (const command of ['generateCommitMessage', 'applyDiff']) {
    assert.match(
      commands,
      new RegExp(`export async function ${command}\\(projector: AgentCommandSurfaceProjector\\)`),
      `${command} must consume the shared command projection owner`,
    );
  }
  assert.match(registration, /generateCommitMessage\(commandProjector\)/);
  assert.match(registration, /applyDiff\(commandProjector\)/);
});

test('R1-D2C auxiliary VS Code commands only form AgentCommand or ContextRef', () => {
  const commands = source('src/commands/index.ts');
  const registration = source('src/ui/extension-command-registration.ts');

  assert.match(
    commands,
    /export async function runTests\(projector: AgentCommandSurfaceProjector\)/,
    'runTests must project an AgentCommand instead of owning terminal execution',
  );
  assert.doesNotMatch(
    commands,
    /runOwnedCommandWithPermission\s*\(/,
    'command helper implementations must not execute terminal effects directly',
  );
  assert.doesNotMatch(
    registration,
    /terminalPermissionCoordinator\.runOwnedCommandWithPermission\s*\(/,
    'registered VS Code command paths must not execute terminal effects directly',
  );
  assert.match(registration, /runTests\(commandProjector\)/);
  assert.match(registration, /runTerminalCommand\(commandProjector\)/);
  assert.doesNotMatch(
    registration,
    /showTextDocument\s*\(/,
    'showMemoryFiles must form a memory ContextRef instead of opening files as its own UI owner',
  );
  assert.match(registration, /addMemoryFileToChat\(deps\.viewProvider\)/);
});

test('R1-D2C generated artifact webview is presentation-only', () => {
  const viewProvider = source('src/ui/deepseek-view-provider.ts');

  assert.match(viewProvider, /case 'openGeneratedPath':[\s\S]*?openWorkspacePathInEditor\(\{/);
  assert.doesNotMatch(viewProvider, /case '(?:preview|apply)Generated(?:Files|Path)'/);
  assert.doesNotMatch(
    viewProvider,
    /previewGeneratedArtifactsWithPrompt|applyGeneratedArtifactsWithPrompt|recoverApplyFailureIfPossible|runClosedLoopRepair/,
    'webview provider must not own generated artifact mutation or recovery runtime',
  );
  assert.equal(existsSync(path.join(rootDir, 'src/ui/generated-artifact-surface-controller.ts')), false);
});
