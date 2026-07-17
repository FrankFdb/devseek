import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
