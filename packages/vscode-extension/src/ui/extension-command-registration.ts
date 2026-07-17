import * as vscode from 'vscode';
import {
  askQuestion,
  applyDiff,
  explainCode,
  fixBug,
  genDoc,
  generateCommitMessage,
  genTest,
  refactorCode,
  runTests,
} from '../commands';
import {
  buildCompletionPrompt,
  buildContext,
  buildInlineChatPrompt,
} from '../context-builder';
import { getActiveProvider } from '../llm/provider-router';
import type { DeepSeekViewProvider } from './deepseek-view-provider';
import { addResourceToChat } from '../app/chat-resource-actions';
import {
  createAgentCommandSurfaceProjection,
  type AgentCommandSurfaceProjector,
} from '../app/agent-command-surface-projection';
import { settleRunContextDirect } from '../app/agent-run-settlement';
import { MemoryService } from '../app/memory-service';
import { createDevSeekRunContext } from '../app/run-context';
import type { TerminalPermissionCoordinator } from '../app/terminal-permission-coordinator';

interface ExtensionCommandRegistrationDeps {
  viewProvider: DeepSeekViewProvider;
  terminalPermissionCoordinator: TerminalPermissionCoordinator;
  pushChatPanel: (userDisplay: string, prompt: string, newSession: boolean) => void | Promise<void>;
  routeChat: (opts: {
    prompt: string;
    stream?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
    traceRunId?: string;
    traceWorkspaceRoot?: string;
    traceEvidenceParticipantToken?: string;
    onTraceEvidenceError?: (error: unknown) => void;
  }) => Promise<string>;
}

interface CompletionState {
  debounceTimer?: ReturnType<typeof setTimeout>;
  cache: Map<string, vscode.InlineCompletionItem[]>;
}

export function registerExtensionCommands(
  context: vscode.ExtensionContext,
  deps: ExtensionCommandRegistrationDeps,
): void {
  const commandProjector = createCommandSurfaceProjector(deps);
  registerChatRelayCommand(context, commandProjector);
  registerVisibleCommands(context, deps, commandProjector);
  registerInlineChatCommand(context, deps, commandProjector);
  registerInlineCompletionProvider(context, deps.routeChat);
}

function createCommandSurfaceProjector(
  deps: ExtensionCommandRegistrationDeps,
): AgentCommandSurfaceProjector {
  return createAgentCommandSurfaceProjection({
    isProviderAvailable: async () => getActiveProvider().available(),
    pushChatPanel: deps.pushChatPanel,
    focusView: () => deps.viewProvider.focus(),
    onProviderUnavailable: async () => {
      await vscode.window.showErrorMessage('DeepSeek NetAI: LLM Provider 不可用，请检查 ⚙ 设置');
    },
    onInvalidRequest: async () => {
      await vscode.window.showErrorMessage('DevSeek: 命令请求不完整，未发送到聊天面板。');
    },
  });
}

function registerChatRelayCommand(
  context: vscode.ExtensionContext,
  commandProjector: AgentCommandSurfaceProjector,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      '_deepseek.askChat',
      (userDisplay: string, prompt: string, newSession: boolean) => {
        return commandProjector.projectToChat({
          source: '_deepseek.askChat',
          userDisplay,
          prompt,
          newSession,
        });
      },
    ),
  );
}

function registerVisibleCommands(
  context: vscode.ExtensionContext,
  deps: ExtensionCommandRegistrationDeps,
  commandProjector: AgentCommandSurfaceProjector,
): void {
  const commands: [string, () => Promise<void>][] = [
    ['devseek.explain', async () => explainCode(commandProjector)],
    ['devseek.fix', async () => fixBug(commandProjector)],
    ['devseek.refactor', async () => refactorCode(commandProjector)],
    ['devseek.genTest', async () => genTest(commandProjector)],
    ['devseek.runTests', async () => runTests(deps.terminalPermissionCoordinator)],
    ['devseek.genDoc', async () => genDoc(commandProjector)],
    ['devseek.ask', async () => askQuestion(commandProjector)],
    ['devseek.generateCommit', async () => generateCommitMessage(deps.routeChat)],
    ['devseek.applyDiff', async () => applyDiff(deps.routeChat)],
    ['devseek.openChat', async () => { deps.viewProvider.focus(); }],
    ['devseek.triggerCompletion', async () => {
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    }],
    ['devseek.runTerminalCommand', async () => {
      await runTerminalCommand(deps, commandProjector);
    }],
    ['devseek.showMemoryFiles', openMemoryFile],
  ];

  for (const [id, command] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(id, command));
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('devseek.addFileToChat', async (resource?: vscode.Uri) => {
      await addResourceToChat(deps.viewProvider, resource);
    }),
  );
}

async function runTerminalCommand(
  deps: ExtensionCommandRegistrationDeps,
  commandProjector: AgentCommandSurfaceProjector,
): Promise<void> {
  const command = await vscode.window.showInputBox({
    prompt: '输入要执行的 Shell 命令',
    placeHolder: 'e.g. npm run build',
  });
  if (!command) return;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const result = await deps.terminalPermissionCoordinator.runOwnedCommandWithPermission({
    command,
    workdir: workspaceRoot,
    workspaceRoot,
    mode: 'run',
    source: 'vscode-extension.run-terminal-command',
    userConfirmed: true,
    presentation: 'captured',
  });
  await commandProjector.projectToChat({
    source: 'devseek.runTerminalCommand',
    userDisplay: `> ${command}`,
    prompt: `请分析以下命令输出并给出建议：\n\n${result.output}`,
    focus: true,
  });
}

async function openMemoryFile(): Promise<void> {
  const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!wsPath) {
    vscode.window.showWarningMessage('DevSeek: 请先打开一个工作区');
    return;
  }

  const memPath = new MemoryService({ workspaceRoot: wsPath }).ensureLegacyMemoryFile();
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(memPath));
  await vscode.window.showTextDocument(doc);
}

function registerInlineChatCommand(
  context: vscode.ExtensionContext,
  deps: ExtensionCommandRegistrationDeps,
  commandProjector: AgentCommandSurfaceProjector,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('devseek.inlineChat', async () => {
      await runInlineChat(deps, commandProjector);
    }),
  );
}

async function runInlineChat(
  deps: ExtensionCommandRegistrationDeps,
  commandProjector: AgentCommandSurfaceProjector,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件');
    return;
  }

  const rawInstruction = await pickInlineInstruction();
  if (!rawInstruction) return;

  const instruction = mapSlashInstruction(rawInstruction);
  const inlineProvider = getActiveProvider();
  const inlineAvailable = await inlineProvider.available();
  if (!inlineAvailable) {
    vscode.window.showErrorMessage('DeepSeek NetAI: LLM Provider 不可用，请检查设置（⚙ 状态栏）');
    return;
  }

  const ctx = buildContext(editor);
  const prompt = buildInlineChatPrompt(instruction, ctx.code, ctx.language, ctx.relPath);
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `DevSeek: ${instruction.slice(0, 30)}...`,
      cancellable: false,
    },
    async () => {
      await applyInlineChatResult({
        deps,
        commandProjector,
        editor,
        instruction,
        prompt,
        filename: ctx.filename,
      });
    },
  );
}

function pickInlineInstruction(): Promise<string | undefined> {
  const slashItems: vscode.QuickPickItem[] = [
    { label: '/fix', description: '修复 Bug' },
    { label: '/refactor', description: '重构代码' },
    { label: '/tests', description: '生成单元测试' },
    { label: '/doc', description: '生成文档注释' },
    { label: '/explain', description: '解释代码' },
  ];

  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = '输入指令，或 / 选择预设命令...';
  quickPick.items = slashItems;
  quickPick.matchOnDescription = true;
  quickPick.show();

  return new Promise<string | undefined>((resolve) => {
    let resolved = false;
    const finish = (value: string | undefined) => {
      if (resolved) return;
      resolved = true;
      quickPick.dispose();
      resolve(value);
    };
    quickPick.onDidChangeValue(value => {
      quickPick.items = value.startsWith('/')
        ? slashItems.filter(item => item.label.startsWith(value.split(' ')[0]))
        : [];
    });
    quickPick.onDidAccept(() => {
      finish(quickPick.value.trim() || quickPick.selectedItems[0]?.label);
    });
    quickPick.onDidHide(() => finish(undefined));
  });
}

function mapSlashInstruction(instruction: string): string {
  const slashMap: Record<string, string> = {
    '/fix': '修复代码中的 Bug，返回完整修复后代码',
    '/refactor': '重构代码，提升可读性和性能，返回完整重构后代码',
    '/tests': '为代码编写完整单元测试',
    '/doc': '为代码生成规范的文档注释，不改变代码逻辑',
    '/explain': '详细解释代码的功能和逻辑',
  };

  for (const [slash, mapped] of Object.entries(slashMap)) {
    if (instruction === slash || instruction.startsWith(slash + ' ')) {
      return mapped + instruction.slice(slash.length);
    }
  }
  return instruction;
}

async function applyInlineChatResult(args: {
  deps: ExtensionCommandRegistrationDeps;
  commandProjector: AgentCommandSurfaceProjector;
  editor: vscode.TextEditor;
  instruction: string;
  prompt: string;
  filename: string;
}): Promise<void> {
  let runContext: ReturnType<typeof createDevSeekRunContext> | undefined;
  try {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(args.editor.document.uri)?.uri.fsPath
      ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      ?? process.cwd();
    runContext = createDevSeekRunContext({
      workspaceRoot,
      source: 'vscode-extension.inline-chat',
      userPrompt: args.prompt,
      traceLevel: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
    });
    const result = await args.deps.routeChat({
      prompt: args.prompt,
      stream: false,
      traceRunId: runContext.runId,
      traceWorkspaceRoot: runContext.workspaceRoot,
      traceEvidenceParticipantToken: runContext.evidenceParticipantToken,
      onTraceEvidenceError: error => runContext?.markEvidenceDegraded(error),
    });
    const codeMatch = result.match(/```[^\n]*\n([\s\S]*?)```/);
    const newCode = codeMatch ? codeMatch[1].trimEnd() : result.trim();
    if (!newCode) {
      settleRunContextDirect(runContext, 'failed', { reason: 'empty-provider-response' });
      vscode.window.showWarningMessage('DeepSeek: 未收到有效代码');
      return;
    }

    if (!args.editor.selection.isEmpty) {
      const originalContent = args.editor.document.getText();
      const relPath = vscode.workspace.asRelativePath(args.editor.document.uri, false);
      const task = {
        type: 'agentStatus' as const,
        phase: 'execute' as const,
        taskId: 'inline-chat-editor-edit',
        taskFile: relPath,
        taskAction: 'modify' as const,
        title: `应用 ${args.filename} 行内修改`,
      };
      runContext.recordAgentStatus({ ...task, state: 'started' });
      const applied = await args.editor.edit(edit => edit.replace(args.editor.selection, newCode));
      runContext.recordAgentStatus({ ...task, state: applied ? 'completed' : 'failed' });
      if (!applied) throw new Error('VS Code 拒绝应用行内编辑');
      await args.deps.viewProvider.registerInlineChatEdit({
        path: relPath,
        oldContent: originalContent,
        newContent: args.editor.document.getText(),
        existed: true,
      });
      const settlement = settleRunContextDirect(runContext, 'completed', { changedPaths: [relPath] });
      if (settlement.completed) {
        vscode.window.showInformationMessage('✅ DeepSeek 行内修改已应用（侧边栏可对比 / 撤销）');
      } else {
        vscode.window.showErrorMessage('DeepSeek: 行内修改已写入，但运行证据结算失败；本轮不能标记完成。');
      }
      return;
    }

    const projection = await args.commandProjector.projectToChat({
      source: 'devseek.inlineChat',
      userDisplay: `⚡ **${args.instruction}** · \`${args.filename}\``,
      prompt: args.prompt,
    });
    if (!projection.projected) {
      settleRunContextDirect(runContext, 'failed', { reason: `chat-projection-${projection.reason}` });
      return;
    }
    const settlement = settleRunContextDirect(runContext, 'completed', { reason: 'forwarded-to-chat-panel' });
    if (!settlement.completed) {
      throw new Error('内容已转发到聊天面板，但运行证据结算失败；本轮不能标记完成。');
    }
  } catch (error) {
    if (runContext) settleRunContextDirect(runContext, 'failed', { reason: 'inline-chat-error' });
    vscode.window.showErrorMessage(`DeepSeek Inline Chat: ${(error as Error).message}`);
  }
}

function registerInlineCompletionProvider(
  context: vscode.ExtensionContext,
  routeChat: ExtensionCommandRegistrationDeps['routeChat'],
): void {
  const state: CompletionState = {
    cache: new Map<string, vscode.InlineCompletionItem[]>(),
  };

  const provider = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: '**' },
    {
      provideInlineCompletionItems: async (document, position, _context, token) => {
        return provideInlineCompletions(state, document, position, token, routeChat);
      },
    },
  );
  context.subscriptions.push(provider);
}

async function provideInlineCompletions(
  state: CompletionState,
  document: vscode.TextDocument,
  position: vscode.Position,
  token: vscode.CancellationToken,
  routeChat: ExtensionCommandRegistrationDeps['routeChat'],
): Promise<vscode.InlineCompletionItem[]> {
  const config = vscode.workspace.getConfiguration('devseek');
  if (!config.get<boolean>('completionEnabled', false) || token.isCancellationRequested) {
    return [];
  }

  const provider = getActiveProvider();
  const available = await provider.available();
  if (!available || token.isCancellationRequested) return [];

  const request = buildCompletionRequest(document, position);
  if (state.cache.has(request.cacheKey)) {
    return state.cache.get(request.cacheKey)!;
  }

  const delay = config.get<number>('completionTriggerDelay', 800);
  return new Promise((resolve) => {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(async () => {
      if (token.isCancellationRequested) {
        resolve([]);
        return;
      }
      await completeAfterDebounce({ state, routeChat, request, token, resolve });
    }, delay);
  });
}

function buildCompletionRequest(document: vscode.TextDocument, position: vscode.Position): {
  cacheKey: string;
  prompt: string;
} {
  const prefixLines = 50;
  const suffixLines = 20;
  const startLine = Math.max(0, position.line - prefixLines);
  const endLine = Math.min(document.lineCount - 1, position.line + suffixLines);
  const prefix = document.getText(new vscode.Range(startLine, 0, position.line, position.character));
  const suffix = document.getText(new vscode.Range(
    position.line,
    position.character,
    endLine,
    document.lineAt(endLine).text.length,
  ));
  const relPath = vscode.workspace.asRelativePath(document.uri);
  return {
    cacheKey: `${relPath}::${prefix.slice(-200)}`,
    prompt: buildCompletionPrompt(prefix, suffix, document.languageId, relPath),
  };
}

async function completeAfterDebounce(args: {
  state: CompletionState;
  routeChat: ExtensionCommandRegistrationDeps['routeChat'];
  request: { cacheKey: string; prompt: string };
  token: vscode.CancellationToken;
  resolve: (items: vscode.InlineCompletionItem[]) => void;
}): Promise<void> {
  try {
    const abortCtrl = new AbortController();
    args.token.onCancellationRequested(() => abortCtrl.abort());
    const result = await args.routeChat({
      prompt: args.request.prompt,
      stream: false,
      timeoutMs: 15000,
      signal: abortCtrl.signal,
    });
    if (args.token.isCancellationRequested) {
      args.resolve([]);
      return;
    }

    const items = [new vscode.InlineCompletionItem(result.trim())];
    args.state.cache.set(args.request.cacheKey, items);
    setTimeout(() => args.state.cache.delete(args.request.cacheKey), 30000);
    args.resolve(items);
  } catch {
    args.resolve([]);
  }
}
