import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '../../');
const sourceRoot = path.join(packageRoot, 'src');

function readSources(dir = sourceRoot, relativeDir = 'src') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) files.push(...readSources(absolutePath, relativePath));
    else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push({ relativePath, source: readFileSync(absolutePath, 'utf8') });
    }
  }
  return files;
}

const sources = readSources();
const source = relativePath => sources.find(file => file.relativePath === relativePath)?.source ?? '';

test('Mutation guard: process creation remains confined to named transport/execution owners', () => {
  const importPattern = /(?:from\s+['"](?:node:)?child_process['"]|require\(['"](?:node:)?child_process['"]\)|import\s+\*\s+as\s+\w+\s+from\s+['"](?:node:)?child_process['"])/;
  const processOwners = sources
    .filter(file => importPattern.test(file.source))
    .map(file => file.relativePath)
    .sort();
  assert.deepEqual(processOwners, [
    'src/bridge-client.ts',
    'src/execution-outcome-classifier.ts',
    'src/mcp/client.ts',
    'src/tools/terminal.ts',
  ]);

  const agentHost = source('src/agent/agent-host-tools.ts');
  assert.doesNotMatch(agentHost, /import\(['"][^'"]*tools\/terminal|from\s+['"][^'"]*tools\/terminal/);
  assert.match(agentHost, /terminalPermissionCoordinator\.runCommandWithPermissionDetailed\s*\(/);
});

test('Mutation guard: arbitrary VS Code command dispatch cannot bypass the closed registry', () => {
  const agentHost = source('src/agent/agent-host-tools.ts');
  const commandPolicy = source('src/agent/vscode-command-policy.ts');
  const viewProvider = source('src/ui/deepseek-view-provider.ts');

  assert.match(agentHost, /getSupportedVscodeCommandPolicy\(command\)/);
  assert.match(agentHost, /\(args\?\.length \?\? 0\) > 0/);
  assert.match(agentHost, /invoke:\s*\(\)\s*=>\s*vscode\.commands\.executeCommand\(command\)/);
  assert.doesNotMatch(agentHost, /executeCommand\(command,\s*\.\.\./);
  assert.match(commandPolicy, /mutating-with-permission/);
  assert.match(commandPolicy, /must use run_terminal/);
  assert.doesNotMatch(viewProvider, /executeCommand\(\s*(?:msg|message)\.command/);
  assert.match(viewProvider, /Generic inbound VS Code commands are disabled/);

  for (const file of sources.filter(file => file.relativePath !== 'src/agent/agent-host-tools.ts')) {
    const calls = [...file.source.matchAll(/commands\.executeCommand(?:<[^>]+>)?\(([\s\S]{0,120})/g)];
    for (const call of calls) {
      assert.match(
        call[1].trimStart(),
        /^['"`]/,
        `${file.relativePath} gained a dynamic VS Code command dispatch`,
      );
    }
  }
});

test('Tool guard: terminal, VS Code, and MCP effects require prepared canonical execution', () => {
  for (const file of sources) {
    assert.doesNotMatch(
      file.source,
      /onTerminalCommand|onRunVscodeCommand|onMcpToolCall/,
      `${file.relativePath} reintroduced a host-effect callback that executes before canonical settlement`,
    );
  }

  const agenticLoop = source('src/agent/agentic-loop.ts');
  const toolLoop = source('src/agent/tool-loop.ts');
  const canonicalSession = source('src/agent/tool-loop-canonical-session.ts');
  assert.match(agenticLoop, /executeFakeToolsForLoop\s*\(/);
  assert.match(toolLoop, /plannedTerminalValidation/);
  assert.match(toolLoop, /prepared\.execute\(\)/);
  assert.match(toolLoop, /canonicalTools\.settle\s*\(/);
  assert.match(canonicalSession, /this\.executor\.executeCanonical\s*\(/);
  assert.match(canonicalSession, /vscode-tool-loop:incomplete-canonical-tool-sessions/);
  assert.doesNotMatch(canonicalSession, /InMemoryCodingOperationJournal/);
  assert.doesNotMatch(canonicalSession, /new Canonical(?:Tool|Workspace|External)/);
  assert.doesNotMatch(toolLoop, /\.executeCanonical\s*\(/);
});

test('Mutation guard: workspace writes in audited flows route through the writer/mutation owners', () => {
  const directFsMutation = /fs\.(?:writeFileSync|appendFileSync|mkdirSync|rmdirSync|rmSync|unlinkSync|renameSync|copyFileSync|truncateSync)\s*\(/;
  const workspaceFsMutation = /workspace\.fs\.(?:writeFile|delete|rename|copy|createDirectory)\s*\(/;
  const directOwners = sources
    .filter(file => directFsMutation.test(file.source) || workspaceFsMutation.test(file.source))
    .map(file => file.relativePath)
    .sort();
  assert.deepEqual(directOwners, [
    'src/bridge-client.ts',
    'src/memory/memory-store.ts',
    'src/ui/real-plugin-harness.ts',
    'src/workspace/coding-workspace-batch-mutation-adapter.ts',
    'src/workspace/cpp-build-cleanup-service.ts',
    'src/workspace/edit-service.ts',
  ]);

  for (const relativePath of [
    'src/agent/agent-host-tools.ts',
    'src/agent/auto-validation.ts',
    'src/agent/markdown-artifact-applier.ts',
    'src/agent/tool-loop.ts',
    'src/pending-edit-coordinator.ts',
  ]) {
    const text = source(relativePath);
    assert.doesNotMatch(text, directFsMutation, `${relativePath} bypasses WorkspaceEditService`);
    assert.doesNotMatch(text, workspaceFsMutation, `${relativePath} bypasses WorkspaceEditService`);
  }
  assert.match(source('src/agent/agent-host-tools.ts'), /directoryMutations\.execute\(\{/);
  assert.match(source('src/agent/tool-loop.ts'), /changeReceipts\.push\(result\.changeReceipt\)/);
  const directoryMutationAdapter = source('src/workspace/coding-workspace-directory-mutation-adapter.ts');
  assert.match(directoryMutationAdapter, /transaction: WorkspaceMutationTransactionPort/);
  assert.match(directoryMutationAdapter, /input\.transaction\.execute\(/);
  assert.doesNotMatch(directoryMutationAdapter, /new CanonicalWorkspaceMutationTransaction/);
  assert.match(directoryMutationAdapter, /rollbackWorkspaceDirectoryCommit/);
  const productMutationSession = source('src/workspace/product-workspace-mutation-transaction.ts');
  assert.match(productMutationSession, /new CanonicalWorkspaceMutationTransaction/);
  assert.match(productMutationSession, /FileSystemCodingOperationJournal\.forWorkspace/);
  assert.doesNotMatch(source('src/app/product-mutation-coordinator.ts'), /workspace-directory/);
  assert.match(source('src/agent/tool-loop.ts'), /workspaceMutation\.executeTextFileDelete\(\{/);
  assert.match(source('src/pending-edit-coordinator.ts'), /kind:\s*'pending-edit-undo'/);
  assert.match(source('src/pending-edit-coordinator.ts'), /workspaceMutation\.executeTextFileWrite\(\{/);
  assert.match(source('src/pending-edit-coordinator.ts'), /workspaceMutation\.executeTextFileDelete\(\{/);
  assert.doesNotMatch(source('src/pending-edit-coordinator.ts'), /commitTextFileProposal\(/);
  assert.match(source('src/pending-edit-coordinator.ts'), /buildPendingEditUndoProof\(/);
  assert.doesNotMatch(source('src/pending-edit-coordinator.ts'), /kind:\s*['"]workspace-text-readback['"]/);
  assert.doesNotMatch(source('src/agent/auto-validation.ts'), /normalizeFormalProjectMarkdown|writeFileSync|workspace\.fs/);

  for (const file of sources) {
    assert.doesNotMatch(
      file.source,
      /\b(?:writeTextFileSync|snapshotTextFile|applyTextFileProposal)\s*\(/,
      `${file.relativePath} reintroduced an unsafe unscoped text-write API`,
    );
  }
  for (const relativePath of [
    'src/agent/markdown-artifact-applier.ts',
    'src/agent/markdown-deliverable-task.ts',
    'src/agent/simple-file-task.ts',
    'src/agent/tool-loop.ts',
  ]) {
    const text = source(relativePath);
    assert.match(text, /captureTextFileBaseline\(/, `${relativePath} must capture a workspace-rooted baseline`);
    assert.match(text, /workspaceMutation\.executeTextFile(?:Write|Delete)\(\{/, `${relativePath} must use the canonical mutation adapter`);
    assert.doesNotMatch(text, /commitTextFileProposal\(/, `${relativePath} bypasses canonical mutation settlement`);
  }
  const workspaceApplier = source('src/workspace-applier.ts');
  assert.match(workspaceApplier, /captureTextFileBaseline\(/, 'workspace applier must capture workspace-rooted baselines');
  assert.match(workspaceApplier, /workspaceMutation\.execute\(\{/, 'workspace applier must use the canonical batch mutation adapter');
  assert.doesNotMatch(workspaceApplier, /commitTextFileProposal\(/, 'workspace applier bypasses canonical mutation settlement');
  assert.doesNotMatch(workspaceApplier, /rollbackCommittedChanges/, 'workspace applier retained obsolete out-of-transaction rollback');

  const batchMutationAdapter = source('src/workspace/coding-workspace-batch-mutation-adapter.ts');
  assert.match(batchMutationAdapter, /commitTextFileProposal\(/, 'batch mutation adapter must own atomic host commits');
  assert.match(batchMutationAdapter, /rollbackTextFileCommit\(/, 'batch mutation adapter must own token compensation');
});

test('Verification guard: agentic validation projects through the shared receipt owner', () => {
  const autoValidation = source('src/agent/auto-validation.ts');
  const adapter = source('src/app/coding-verification-adapter.ts');

  assert.match(adapter, /new CanonicalVerificationService\(\)/);
  assert.match(autoValidation, /canonicalVerificationAdapter/);
  assert.match(autoValidation, /verificationReceipt: outcome\.receipt/);
});

test('Mutation guard: MCP tools have one authorized product boundary and honest receipt semantics', () => {
  const callToolFiles = sources
    .filter(file => /\.callTool\s*\(/.test(file.source))
    .map(file => file.relativePath)
    .sort();
  assert.deepEqual(callToolFiles, ['src/app/evidence-aware-mcp-tool-call.ts', 'src/mcp/client.ts']);
  const extension = source('src/extension.ts');
  const mcpBoundary = source('src/app/evidence-aware-mcp-tool-call.ts');
  assert.equal((mcpBoundary.match(/deps\.mcpManager\.callTool\s*\(/g) ?? []).length, 1);
  assert.equal((extension.match(/createEvidenceAwareMcpToolCall\s*\(/g) ?? []).length, 2);
  assert.match(extension, /createEvidenceAwareMcpToolCallFactory\(\{[\s\S]*?terminalPermissions:[\s\S]*?mcpManager/);
  assert.match(mcpBoundary, /kind:\s*'mcp-tool'[\s\S]*?kind:\s*'invocation-receipt'[\s\S]*?mcp-json-rpc-call-resolved/);
  assert.match(mcpBoundary, /requestInlineConfirmation\(webview, `MCP:/);
});

test('Mutation guard: durable settlement controls every completed success projection', () => {
  const extension = source('src/extension.ts');
  const localRunner = source('src/local-execution-chat-runner.ts');
  const terminalCoordinator = source('src/app/terminal-permission-coordinator.ts');
  const commands = source('src/commands/index.ts');
  const commandRegistration = source('src/ui/extension-command-registration.ts');
  const viewProvider = source('src/ui/deepseek-view-provider.ts');
  const generatedArtifacts = source('src/ui/generated-artifact-surface-controller.ts');
  const agentKernel = source('src/app/agent-kernel-service.ts');
  const agentSettlement = source('src/app/agent-run-settlement.ts');
  const evidenceRouter = source('src/app/evidence-aware-chat-router.ts');
  const pendingEdit = source('src/pending-edit-coordinator.ts');

  const agenticStart = extension.indexOf('const agSettlement = agentKernelRun.settleAgentLoopResult');
  const agenticSave = extension.indexOf('completed: agDurablyCompleted', agenticStart);
  const agenticAutopilot = extension.indexOf('if (agDurablyCompleted)', agenticStart);
  assert.ok(agenticStart >= 0 && agenticSave > agenticStart && agenticAutopilot > agenticStart);
  assert.match(extension, /\[Agentic\] \$\{agDurablyCompleted \? '已完成' : '未完成'\}/);

  assert.doesNotMatch(extension, /const agentSettlement = agentKernelRun\.settleAgentLoopResult/);
  assert.doesNotMatch(extension, /loopFailedForAutoAccept|durableAgentSettlement/);
  assert.doesNotMatch(extension, /from '\.\/app\/agent-run-settlement'/);
  assert.match(agentKernel, /settleAgentLoopResult\(this\.terminalPermissions, this\.runContext/);
  assert.match(agentKernel, /completeRunContext\(this\.runContext,\s*'failed'/);
  assert.match(agentSettlement, /const canonicalStatus = result\.completionDecision\?\.status/);
  assert.match(agentSettlement, /const requestedStatus: RunContextStatus = canonicalStatus\s*\?\?/);
  assert.doesNotMatch(agentSettlement, /canonicalStatus === 'blocked'[\s\S]*?'failed'/);
  assert.doesNotMatch(agentSettlement, /const requestedStatus = result\.tasksFailed > 0 \? 'failed' : 'completed'/);
  assert.match(agentSettlement, /const status = terminalPermissions\.completeRunContext[\s\S]*?const completed = requestedStatus === 'completed' && status === 'completed'/);
  assert.match(agentSettlement, /function settleRunContextDirect[\s\S]*?runContext\.complete\(requestedStatus, data\)/);

  assert.match(localRunner, /successMessage:\s*buildLocalExecutionSuccessMessage/);
  assert.doesNotMatch(
    localRunner,
    /postWebviewMessage\(input\.webview, \{ type: 'delta', text: buildLocalExecutionSuccessMessage/,
    'local execution must return candidate success instead of presenting it before owner settlement',
  );
  assert.match(
    extension,
    /const settlementStatus = terminalPermissionCoordinator\.completeRunContext\([\s\S]*?if \(settlementStatus === 'completed' && localExecutionResult\.successMessage\)/,
  );
  assert.match(extension, /const chatSettlementStatus = terminalPermissionCoordinator\.completeRunContext[\s\S]*?chatSettlementStatus !== 'completed'/);
  assert.match(evidenceRouter, /settleRunContextDirect\(ownedContext, 'completed'[\s\S]*?\.completed/);

  assert.match(terminalCoordinator, /const settlementStatus = this\.completeRunContext\([\s\S]*?return \{ \.\.\.result, settlementStatus,/);
  assert.doesNotMatch(commands, /settleRunContextDirect|createDevSeekRunContext|routeChat\s*\(|editor\.edit\s*\(/);
  assert.match(commands, /generateCommitMessage\(projector: AgentCommandSurfaceProjector\)/);
  assert.match(commands, /applyDiff\(projector: AgentCommandSurfaceProjector\)/);
  assert.match(commandRegistration, /generateCommitMessage\(commandProjector\)/);
  assert.match(commandRegistration, /applyDiff\(commandProjector\)/);
  assert.doesNotMatch(commandRegistration, /applyInlineChatResult|inline-chat-editor-edit|editor\.edit\s*\(/);
  assert.match(pendingEdit, /settleRunContextDirect\(runContext, 'completed', \{ mutationKind: 'pending-edit-undo' \}\)\.completed/);
  assert.doesNotMatch(viewProvider, /completeRunContext\(runContext/);
  assert.equal((generatedArtifacts.match(/const settlementStatus = this\.deps\.terminalPermissionCoordinator\.completeRunContext\(runContext/g) ?? []).length, 2);
  assert.equal((generatedArtifacts.match(/requestedStatus === 'completed' && settlementStatus !== 'completed'/g) ?? []).length, 2);

  const directRunCompletionOwners = sources
    .filter(file => /\b[A-Za-z_$][\w$]*Context\??\.complete\s*\(/.test(file.source))
    .map(file => file.relativePath)
    .sort();
  assert.deepEqual(directRunCompletionOwners, [
    'src/app/agent-run-settlement.ts',
    'src/app/terminal-permission-coordinator.ts',
  ]);
});

test('Mutation guard: every ValidationService construction injects command authority and validation is pure', () => {
  const constructors = [];
  for (const file of sources) {
    let index = file.source.indexOf('new ValidationService(');
    while (index >= 0) {
      constructors.push({
        relativePath: file.relativePath,
        excerpt: file.source.slice(index, index + 240),
      });
      index = file.source.indexOf('new ValidationService(', index + 1);
    }
  }
  assert.deepEqual(
    constructors.map(constructor => constructor.relativePath).sort(),
    ['src/agent/auto-validation.ts', 'src/workspace-applier.ts'],
  );
  for (const constructor of constructors) {
    assert.match(constructor.excerpt, /commandRunner\s*:/, `${constructor.relativePath} lacks validation command authority`);
  }
  const validationService = source('src/workspace/validation-service.ts');
  assert.doesNotMatch(validationService, /child_process|tools\/terminal/);
  assert.match(validationService, /options\.commandRunner\s*\?\?\s*rejectMissingCommandAuthority/);
});

test('Mutation guard: tool planning consumes policy before every execution branch', () => {
  const toolLoop = source('src/agent/tool-loop.ts');
  const agenticLoop = source('src/agent/agentic-loop.ts');
  const writeAuthority = source('src/agent/write-authority.ts');
  assert.equal(
    [...toolLoop.matchAll(/canonicalTools\.plan\([\s\S]*?buildToolPolicy\(callbacks\.executionMode \?\? 'inspect'\)/g)].length,
    2,
    'initial and batched file-write dispatch must both consume the surface policy',
  );
  assert.doesNotMatch(toolLoop, /agentToolExecutor/);
  assert.match(toolLoop, /toolPlan\.permission\?\.action === 'deny'/);
  assert.match(toolLoop, /toolPlan\.permission\?\.action === 'requireConfirm'/);
  assert.match(toolLoop, /hasEvidenceAwareToolAuthority\(toolPlan\.kind, callbacks\)/);
  assert.match(agenticLoop, /callbacks = \{ \.\.\.callbacks, executionMode: workflowMode \}/);
  assert.doesNotMatch(writeAuthority, /if \(!callbacks\.onResolveFileWriteConstraint\) return true/);
  assert.match(source('src/extension.ts'), /agentKernelService\.executeCanonicalTask\(\{[\s\S]*?callbacks:\s*\{[\s\S]*?executionMode:\s*workflow\.toolPolicyMode/);
});

test('Mutation guard: participant capability is sent only through the Bridge provider envelope', () => {
  const loopChat = source('src/agent/loop-chat.ts');
  const llmTypes = source('src/llm/types.ts');
  const bridgeProvider = source('src/llm/providers/bridge.ts');
  assert.equal((loopChat.match(/provider\.type === 'bridge' && traceEvidenceParticipantToken/g) ?? []).length, 2);
  assert.doesNotMatch(llmTypes, /traceEvidenceParticipantToken\?:/);
  assert.match(llmTypes, /evidenceCapability\?:/);
  assert.match(bridgeProvider, /opts\.evidenceCapability\?\.token/);
});
