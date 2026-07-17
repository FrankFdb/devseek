import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { buildContext, buildPrompt, buildCommitPrompt, getDiagnosticsContext } from '../context-builder';
import { getActiveProvider } from '../llm/provider-router';
import { settleRunContextDirect } from '../app/agent-run-settlement';
import { createDevSeekRunContext } from '../app/run-context';
import type { AgentCommandSurfaceProjector } from '../app/agent-command-surface-projection';
import type { TerminalPermissionCoordinator } from '../app/terminal-permission-coordinator';

export type CommandRouteChat = (opts: {
  prompt: string;
  stream?: boolean;
  traceRunId?: string;
  traceWorkspaceRoot?: string;
  traceEvidenceParticipantToken?: string;
  onTraceEvidenceError?: (error: unknown) => void;
}) => Promise<string>;

// 代码预览（最多 maxLines 行）
function codePreview(code: string, language: string, maxLines = 15): string {
  const lines = code.split('\n');
  const shown = lines.slice(0, maxLines).join('\n');
  const extra = lines.length > maxLines ? `\n\n*… 还有 ${lines.length - maxLines} 行*` : '';
  return `\`\`\`${language}\n${shown}\n\`\`\`${extra}`;
}

// P3-4: 检测测试框架
function detectTestFramework(language: string, workspaceRoot?: string): { name: string; runCmd: string } {
  if (workspaceRoot) {
    try {
      const pkgPath = path.join(workspaceRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps['vitest'])  return { name: 'Vitest',  runCmd: 'npx vitest run' };
        if (deps['jest'])    return { name: 'Jest',    runCmd: 'npx jest' };
        if (deps['mocha'])   return { name: 'Mocha',   runCmd: 'npx mocha' };
        if (deps['jasmine']) return { name: 'Jasmine', runCmd: 'npx jasmine' };
      }
    } catch { /* ignore parse errors */ }

    if (language === 'python') {
      for (const f of ['pytest.ini', 'setup.cfg', 'pyproject.toml']) {
        if (fs.existsSync(path.join(workspaceRoot, f))) {
          return { name: 'pytest', runCmd: 'pytest' };
        }
      }
    }
    if (language === 'rust' && fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
      return { name: 'cargo test', runCmd: 'cargo test' };
    }
    if (language === 'go' && fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
      return { name: 'go test',   runCmd: 'go test ./...' };
    }
  }
  // language-based defaults
  const defaults: Record<string, { name: string; runCmd: string }> = {
    typescript: { name: 'Jest',    runCmd: 'npx jest' },
    javascript: { name: 'Jest',    runCmd: 'npx jest' },
    python:     { name: 'pytest',  runCmd: 'pytest' },
    rust:       { name: 'cargo test', runCmd: 'cargo test' },
    go:         { name: 'go test', runCmd: 'go test ./...' },
    java:       { name: 'JUnit',   runCmd: 'mvn test' },
    csharp:     { name: 'NUnit',   runCmd: 'dotnet test' },
    cpp:        { name: 'Google Test', runCmd: 'ctest' },
    c:          { name: 'Google Test', runCmd: 'ctest' },
  };
  return defaults[language] ?? { name: language + ' test', runCmd: '' };
}

function dispatch(
  projector: AgentCommandSurfaceProjector,
  source: string,
  userDisplay: string,
  prompt: string,
): Promise<void> {
  return projector.projectToChat({ source, userDisplay, prompt, newSession: false }).then(() => undefined);
}

export async function explainCode(projector: AgentCommandSurfaceProjector): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件'); return; }
  if (editor.selection.isEmpty) { vscode.window.showWarningMessage('DeepSeek: 请先选中要解释的代码'); return; }
  const ctx = buildContext(editor);
  await dispatch(
    projector,
    'devseek.explain',
    `🔍 **解释代码** · \`${ctx.filename}\`\n\n${codePreview(ctx.code, ctx.language)}`,
    buildPrompt(ctx, '请详细解释上面的代码，包括功能、逻辑流程和关键点。'),
  );
}

export async function fixBug(projector: AgentCommandSurfaceProjector): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件'); return; }
  const ctx = buildContext(editor);
  const diagSection = ctx.diagnostics
    ? `\n\n**诊断错误：**\n\`\`\`\n${ctx.diagnostics}\n\`\`\``
    : '';
  const instruction = ctx.diagnostics
    ? `存在如下诊断错误：\n${ctx.diagnostics}\n\n请分析根本原因，给出完整修复后代码。`
    : '请分析代码中可能存在的 Bug，给出完整修复后代码。';
  await dispatch(
    projector,
    'devseek.fix',
    `🐛 **修复 Bug** · \`${ctx.filename}\`${diagSection}\n\n${codePreview(ctx.code, ctx.language)}`,
    buildPrompt(ctx, instruction),
  );
}

export async function refactorCode(projector: AgentCommandSurfaceProjector): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件'); return; }
  if (editor.selection.isEmpty) { vscode.window.showWarningMessage('DeepSeek: 请先选中要重构的代码'); return; }
  const ctx = buildContext(editor);
  await dispatch(
    projector,
    'devseek.refactor',
    `♻️ **重构代码** · \`${ctx.filename}\`\n\n${codePreview(ctx.code, ctx.language)}`,
    buildPrompt(ctx, '请重构上面的代码，提升可读性、可维护性和性能。要求：说明每处修改原因，返回完整重构后代码。'),
  );
}

export async function genTest(projector: AgentCommandSurfaceProjector): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件'); return; }
  if (editor.selection.isEmpty) { vscode.window.showWarningMessage('DeepSeek: 请先选中要测试的代码'); return; }
  const ctx = buildContext(editor);
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const fw = detectTestFramework(ctx.language, wsRoot);

  // Suggest test file path (e.g. foo.ts → foo.test.ts)
  const srcBase = path.basename(ctx.filename, path.extname(ctx.filename));
  const testFileSuffix = ctx.language === 'python' ? `test_${srcBase}.py` : `${srcBase}.test${path.extname(ctx.filename)}`;
  const testFileHint = `建议测试文件名：\`${testFileSuffix}\``;

  const instruction =
    `请使用 **${fw.name}** 框架为上面的代码编写完整单元测试。\n` +
    `要求：\n` +
    `1. 覆盖正常流程、边界条件和异常情况\n` +
    `2. 每个测试用例写清楚测试意图的描述\n` +
    `3. 按 ${fw.name} 规范组织 describe/test 块\n` +
    `4. 在代码块开头注释标注测试文件路径（${testFileSuffix}）\n` +
    `5. 最后一行单独说明运行命令：\`${fw.runCmd || fw.name + ' <test-file>'}\``;

  await dispatch(
    projector,
    'devseek.genTest',
    `🧪 **生成测试** · \`${ctx.filename}\` · ${fw.name}\n\n${testFileHint}\n\n${codePreview(ctx.code, ctx.language)}`,
    buildPrompt(ctx, instruction),
  );
}

export async function genDoc(projector: AgentCommandSurfaceProjector): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件'); return; }
  if (editor.selection.isEmpty) { vscode.window.showWarningMessage('DeepSeek: 请先选中要生成文档的代码'); return; }
  const ctx = buildContext(editor);
  await dispatch(
    projector,
    'devseek.genDoc',
    `📝 **生成文档** · \`${ctx.filename}\`\n\n${codePreview(ctx.code, ctx.language)}`,
    buildPrompt(ctx, `请为上面的代码生成规范的文档注释（${ctx.language} 对应风格），不要修改代码本身。`),
  );
}

export async function askQuestion(projector: AgentCommandSurfaceProjector): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件'); return; }
  const question = await vscode.window.showInputBox({
    prompt: '请输入你的问题',
    placeHolder: '例如：这个函数的时间复杂度是多少？',
  });
  if (!question) return;
  const ctx = buildContext(editor);
  const codeSection = !editor.selection.isEmpty ? `\n\n${codePreview(ctx.code, ctx.language)}` : '';
  const instruction = !editor.selection.isEmpty ? `关于上面的代码：${question}` : question;
  await dispatch(
    projector,
    'devseek.ask',
    `❓ **${question}** · \`${ctx.filename}\`${codeSection}`,
    buildPrompt(ctx, instruction),
  );
}

/**
 * EX-70: 生成 Git 提交信息
 * 读取 git diff --cached，发给 LLM（当前活跃 Provider），结果填入 SCM inputBox
 * P2-6: 改用 LLMProvider 抽象层，支持 API / Ollama 等所有 provider
 */
export async function generateCommitMessage(routeChat: CommandRouteChat): Promise<void> {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension) {
    vscode.window.showErrorMessage('DeepSeek: 未找到 VS Code Git 扩展');
    return;
  }
  const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
  const api = git.getAPI(1);
  const repo = api.repositories[0];
  if (!repo) {
    vscode.window.showWarningMessage('DeepSeek: 没有找到 Git 仓库');
    return;
  }
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? process.cwd();
  const runContext = createDevSeekRunContext({
    workspaceRoot,
    source: 'vscode-extension.generate-commit-message',
    userPrompt: 'Generate a Git commit message from the staged diff',
    traceLevel: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
  });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'DeepSeek: 生成提交信息...', cancellable: false },
    async () => {
      try {
        const diff = await repo.diff(true);
        if (!diff || diff.trim().length === 0) {
          settleRunContextDirect(runContext, 'cancelled', { reason: 'no-staged-diff' });
          vscode.window.showWarningMessage('DeepSeek: 没有暂存的改动（请先 git add）');
          return;
        }

        const prompt = buildCommitPrompt(diff);
        const provider = getActiveProvider();
        const result = await routeChat({
          prompt,
          stream: false,
          traceRunId: runContext.runId,
          traceWorkspaceRoot: runContext.workspaceRoot,
          traceEvidenceParticipantToken: runContext.evidenceParticipantToken,
          onTraceEvidenceError: error => runContext.markEvidenceDegraded(error),
        });

        const msg = result.trim().replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
        const settlement = settleRunContextDirect(runContext, msg ? 'completed' : 'failed', {
          reason: msg ? 'commit-message-generated' : 'empty-provider-response',
        });
        if (msg && settlement.completed) {
          repo.inputBox.value = msg;
          vscode.window.showInformationMessage(`✅ DeepSeek [${provider.displayName}] 已生成提交信息`);
        } else if (msg) {
          vscode.window.showErrorMessage('DeepSeek: 提交信息已生成，但运行证据结算失败，未写入 SCM 输入框。');
        }
      } catch (e) {
        settleRunContextDirect(runContext, 'failed', { reason: 'generate-commit-message-error' });
        vscode.window.showErrorMessage(`DeepSeek: 生成提交信息失败 — ${(e as Error).message}`);
      }
    },
  );
}

/**
 * EX-16: Diff 视图 — 将 AI 返回的代码以 diff 形式展示，用户确认后替换选中区域
 */
export async function applyDiff(routeChat: CommandRouteChat): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage('DeepSeek: 请先打开一个文件'); return; }
  if (editor.selection.isEmpty) { vscode.window.showWarningMessage('DeepSeek: 请先选中要修改的代码'); return; }

  const ctx = buildContext(editor);
  const instruction = await vscode.window.showInputBox({
    prompt: '请输入修改指令',
    placeHolder: '例如：优化性能、添加类型注解、修复 bug...',
  });
  if (!instruction) return;

  const provider = getActiveProvider();
  const avail = await provider.available();
  if (!avail) {
    vscode.window.showErrorMessage('DeepSeek NetAI: LLM Provider 不可用，请检查 ⚙ 设置');
    return;
  }
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath
    ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    ?? process.cwd();
  const runContext = createDevSeekRunContext({
    workspaceRoot,
    source: 'vscode-extension.apply-diff',
    userPrompt: instruction,
    traceLevel: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
  });

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'DeepSeek: 生成代码修改...', cancellable: false },
    async (progress) => {
      try {
        progress.report({ message: '请求 DeepSeek...' });
        const { buildInlineChatPrompt } = await import('../context-builder');
        const prompt = buildInlineChatPrompt(instruction, ctx.code, ctx.language, ctx.relPath);
        const result = await routeChat({
          prompt,
          stream: false,
          traceRunId: runContext.runId,
          traceWorkspaceRoot: runContext.workspaceRoot,
          traceEvidenceParticipantToken: runContext.evidenceParticipantToken,
          onTraceEvidenceError: error => runContext.markEvidenceDegraded(error),
        });

        // 提取代码块内容（去掉 ```lang ... ``` 包裹）
        const codeMatch = result.match(/```[^\n]*\n([\s\S]*?)```/);
        const newCode = codeMatch ? codeMatch[1].trimEnd() : result.trim();

        if (!newCode) {
          settleRunContextDirect(runContext, 'failed', { reason: 'empty-provider-response' });
          vscode.window.showWarningMessage('DeepSeek: 未收到有效代码');
          return;
        }

        // 创建临时文件展示 diff
        const originalUri = editor.document.uri;
        const modifiedContent = editor.document.getText(
          new vscode.Range(0, 0, editor.document.lineCount, 0),
        ).replace(ctx.code, newCode);

        const tmpUri = vscode.Uri.parse(
          `untitled:${originalUri.fsPath.replace(/\.\w+$/, '')}-deepseek-preview${originalUri.fsPath.match(/\.\w+$/)?.[0] ?? ''}`,
        );
        await vscode.workspace.openTextDocument({ content: modifiedContent, language: ctx.language });

        // 使用 diff editor 展示
        await vscode.commands.executeCommand(
          'vscode.diff',
          originalUri,
          tmpUri,
          `DeepSeek 修改预览：${ctx.filename}`,
          { preview: true },
        );

        // 提供快速应用按钮
        const choice = await vscode.window.showInformationMessage(
          'DeepSeek 代码修改预览已打开，是否直接应用到选中区域？',
          '✅ 应用修改',
          '❌ 放弃',
        );
        if (choice === '✅ 应用修改') {
          const task = {
            type: 'agentStatus' as const,
            phase: 'execute' as const,
            taskId: 'apply-diff-editor-edit',
            taskFile: ctx.relPath,
            taskAction: 'modify' as const,
            title: `应用 ${ctx.filename} 修改`,
          };
          runContext.recordAgentStatus({ ...task, state: 'started' });
          const applied = await editor.edit(eb => eb.replace(editor.selection, newCode));
          runContext.recordAgentStatus({ ...task, state: applied ? 'completed' : 'failed' });
          if (!applied) throw new Error('VS Code 拒绝应用编辑');
          const settlement = settleRunContextDirect(runContext, 'completed', { changedPaths: [ctx.relPath] });
          if (settlement.completed) {
            vscode.window.showInformationMessage('✅ 代码已应用');
          } else {
            vscode.window.showErrorMessage('DeepSeek: 代码已写入，但运行证据结算失败；本轮不能标记完成。');
          }
        } else {
          settleRunContextDirect(runContext, 'cancelled', { reason: 'user-declined-diff' });
        }
      } catch (e) {
        settleRunContextDirect(runContext, 'failed', { reason: 'apply-diff-error' });
        vscode.window.showErrorMessage(`DeepSeek: 修改失败 — ${(e as Error).message}`);
      }
    },
  );
}

/**
 * P3-4: 在集成终端运行检测到的测试框架命令
 */
export async function runTests(terminalPermissionCoordinator: TerminalPermissionCoordinator): Promise<void> {
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const editor = vscode.window.activeTextEditor;
  const language = editor ? buildContext(editor).language : 'typescript';
  const fw = detectTestFramework(language, wsRoot);

  if (!fw.runCmd) {
    vscode.window.showWarningMessage(`DeepSeek: 无法确定测试运行命令，请手动运行测试`);
    return;
  }

  // Let user confirm / edit the command
  const cmd = await vscode.window.showInputBox({
    prompt: `运行测试（${fw.name}）`,
    value: fw.runCmd,
    placeHolder: fw.runCmd,
  });
  if (!cmd) return;

  await terminalPermissionCoordinator.runOwnedCommandWithPermission({
    command: cmd,
    workdir: wsRoot,
    workspaceRoot: wsRoot ?? process.cwd(),
    mode: 'run',
    source: 'vscode-extension.run-tests',
    userConfirmed: true,
    presentation: 'visible',
    terminalName: 'DeepSeek Tests',
    reuseTerminal: true,
  });
}
