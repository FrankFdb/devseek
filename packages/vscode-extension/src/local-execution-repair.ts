import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';
import {
  buildExecutionRepairPrompt,
  parseLocalExecutionDiagnostics,
  type LocalExecutionPlan,
  type LocalExecutionResult,
  selectRepairFiles,
} from './execution-planner';
import type { AgentTask } from './agent-task-decomposer';
import type { AgentLoopCallbacks } from './agent/loop-types';
import type { AppliedChangeRecord, ApplyWorkflowStatus } from './workspace-applier';
import { MemoryService } from './app/memory-service';
import { decideToolPermission, type ToolPolicy } from './app/permission-service';
import { decideAgentFileWrite, type AgentFileWriteContext } from './app/agent-file-write-policy';
import { listCppBuildOutputDirNames } from './cpp-build-layout';
import { isFileProtected } from './protected-files';
import { postWebviewMessage } from './ui/webview-event-adapter';

const LOCAL_REPAIR_SOURCE_FILE_RE = /(?:^|\/)(?:Makefile|CMakeLists\.txt)$|\.(cpp|c|h|hpp|cc|cxx|ts|tsx|js|jsx|mjs|py|rs|go|java|cs|rb|php|swift|kt|scala|dart|lua|r)$/i;
const LOCAL_REPAIR_SEARCH_EXCLUDE_GLOB = `**/{${[
  'node_modules',
  'backups',
  'dist',
  '.git',
  ...listCppBuildOutputDirNames(),
].join(',')}}/**`;

export interface LocalExecutionRepairCallbacksDeps {
  webview: vscode.Webview;
  workflowReporter: (status: ApplyWorkflowStatus) => Promise<void>;
  workspaceRoot: string;
  defaultWorkdir: string;
  toolPolicy: ToolPolicy;
  consumeAgentSteer: () => string[];
  confirmTerminal: (command: string, workdir?: string) => Promise<{ allow: boolean; alwaysAllow?: boolean; reason?: string }>;
  registerAppliedChange: (change: AppliedChangeRecord) => Promise<void>;
  registerToMemory: (absPath: string) => void;
  sessionRecentFiles: Map<string, string>;
  repairFiles?: string[];
  mcpToolRefs?: AgentLoopCallbacks['mcpToolRefs'];
  onMcpToolCall?: AgentLoopCallbacks['onMcpToolCall'];
  signal?: AbortSignal;
}

export function relPathFromRepairWorkspace(workspaceRoot: string, absPath: string): string | null {
  if (!workspaceRoot || !absPath) return null;
  try {
    const rel = nodePath.relative(workspaceRoot, absPath).replace(/\\/g, '/');
    if (!rel || rel.startsWith('..') || nodePath.isAbsolute(rel)) return null;
    return rel;
  } catch {
    return null;
  }
}

export function buildLocalExecutionRepairTasks(
  plan: LocalExecutionPlan,
  result: LocalExecutionResult,
  workspaceRoot: string,
): AgentTask[] {
  const selected = selectRepairFiles(plan, result);
  const diagnostics = parseLocalExecutionDiagnostics(plan, result);
  const diagnosticByPath = new Map<string, string>();
  for (const diagnostic of diagnostics) {
    const key = nodePath.resolve(diagnostic.filePath);
    if (diagnosticByPath.has(key)) continue;
    const loc = diagnostic.line
      ? `${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}`
      : '';
    diagnosticByPath.set(key, [loc, diagnostic.message].filter(Boolean).join(' '));
  }

  const repairFiles = [...new Set(selected.map((filePath) => nodePath.resolve(filePath)))]
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile() && LOCAL_REPAIR_SOURCE_FILE_RE.test(filePath);
      } catch {
        return false;
      }
    })
    .slice(0, 4);

  return repairFiles.map((absPath, index) => {
    const rel = relPathFromRepairWorkspace(workspaceRoot, absPath) ?? nodePath.basename(absPath);
    const diagnostic = diagnosticByPath.get(nodePath.resolve(absPath));
    return {
      id: `local-execution-repair-${index + 1}`,
      file: rel,
      absPath,
      action: 'modify',
      desc: diagnostic
        ? `修复 ${rel}:${diagnostic}`
        : (index === 0
            ? `修复本地执行失败（exitCode=${result.exitCode ?? 'null'}）`
            : `检查并修复相关文件：${nodePath.basename(absPath)}`),
    };
  });
}

export function buildLocalExecutionAgentRepairPrompt(
  originalPrompt: string,
  plan: LocalExecutionPlan,
  result: LocalExecutionResult,
  round: number,
): string {
  return [
    buildExecutionRepairPrompt(originalPrompt, plan, result),
    '',
    '【Agent 闭环要求（按 Claude Code / Codex 风格处理）】',
    `这是第 ${round} 轮本地执行失败后的自动修复。上面的终端输出是工具结果，不是最终答案。`,
    '不要依赖网页附件上传；请使用本地工具 read_file / grep_search / list_dir / run_terminal 读取和验证。',
    '必须先围绕“本次失败定位”读取根因文件，再用 create_file/write_file 或 SEARCH/REPLACE 修改必要源码文件。',
    '不要顺手修复工作区中与本次命令失败无关的其他诊断。',
    `修复后必须重新运行验证命令：${plan.command}`,
    '只有验证通过，才能报告完成；如果仍失败，继续基于新输出修复。',
  ].join('\n');
}

export function buildLocalExecutionAgentCallbacks(deps: LocalExecutionRepairCallbacksDeps): AgentLoopCallbacks {
  const {
    webview,
    workflowReporter,
    workspaceRoot,
    defaultWorkdir,
    toolPolicy,
    consumeAgentSteer,
    confirmTerminal,
    registerAppliedChange,
    registerToMemory,
    sessionRecentFiles,
    repairFiles,
    mcpToolRefs,
    onMcpToolCall,
    signal,
  } = deps;
  const repairFileSet = new Set((repairFiles ?? []).map((filePath) => nodePath.resolve(filePath)));

  const resolveReadablePath = (filePath: string, workDir?: string): string | null => {
    const tryCandidate = (candidate: string): string | null => {
      const resolved = nodePath.resolve(candidate);
      try {
        if (fs.statSync(resolved).isFile()) return resolved;
      } catch { /* ignore */ }
      return null;
    };

    if (nodePath.isAbsolute(filePath)) return tryCandidate(filePath);
    const byBasename = sessionRecentFiles.get(nodePath.basename(filePath).toLowerCase());
    if (byBasename) {
      const resolved = tryCandidate(byBasename);
      if (resolved) return resolved;
    }
    const byRel = sessionRecentFiles.get(filePath);
    if (byRel) {
      const resolved = tryCandidate(byRel);
      if (resolved) return resolved;
    }
    if (workDir) {
      const resolved = tryCandidate(nodePath.resolve(workDir, filePath));
      if (resolved) return resolved;
    }
    return tryCandidate(nodePath.join(workspaceRoot, filePath));
  };

  return {
    onDelta: (delta) => {
      if (delta.startsWith('\x00RESET\x00')) {
        postWebviewMessage(webview, { type: 'resetResponse', text: delta.slice(7) });
      } else {
        postWebviewMessage(webview, { type: 'delta', text: delta });
      }
    },
    onWorkflowStatus: workflowReporter,
    onAgentStatus: async (s) => { webview.postMessage(s); },
    onAppliedChange: async (change) => {
      await registerAppliedChange(change);
      const absPath = nodePath.isAbsolute(change.path)
        ? change.path
        : nodePath.join(workspaceRoot, change.path);
      registerToMemory(absPath);
    },
    onResponseMeta: async () => { /* suppressed for local execution repair */ },
    onToolActivity: (kind, label) => {
      webview.postMessage({ type: 'agentToolActivity', activityKind: kind, activityLabel: label });
    },
    onTodoUpdate: (items) => { webview.postMessage({ type: 'todoUpdate', items }); },
    onUserSteer: consumeAgentSteer,
    onTerminalCommand: (command, workdir) => runAgentTerminalCommandForLocalRepair({
      webview,
      toolPolicy,
      confirmTerminal,
      command,
      workdir: workdir ?? defaultWorkdir,
    }),
    onReadFile: async (filePath, workDir) => {
      const resolved = resolveReadablePath(filePath, workDir ?? defaultWorkdir);
      if (!resolved) throw new Error(`找不到文件：${filePath}`);
      return fs.readFileSync(resolved, 'utf8').slice(0, 8000);
    },
    onGrepSearch: async (pattern, path, _isRegexp, workDir) => {
      const baseDir = path
        ? (nodePath.isAbsolute(path) ? path : nodePath.join(workDir ?? defaultWorkdir, path))
        : (workDir ?? defaultWorkdir);
      const searchDir = nodePath.resolve(baseDir);
      if (!isPathInsideRoot(searchDir, workspaceRoot)) {
        throw new Error('grep_search: path outside workspace');
      }
      const { runCommand } = await import('./tools/terminal');
      const includes = ['ts','tsx','js','jsx','cpp','c','h','hpp','py','java','go','rs','cs','json','md','txt']
        .map(ext => `--include='*.${ext}'`)
        .join(' ');
      const cmd = `grep -r -n -E ${shellArg(pattern.slice(0, 200))} ${includes} ${shellArg(searchDir)} 2>/dev/null | head -80`;
      const result = await runCommand({ command: cmd, timeoutMs: 15000 });
      return result.stdout || '（无匹配结果）';
    },
    onListDir: async (dirPath) => {
      const target = nodePath.isAbsolute(dirPath)
        ? nodePath.resolve(dirPath)
        : nodePath.resolve(defaultWorkdir, dirPath);
      if (!isPathInsideRoot(target, workspaceRoot)) throw new Error('list_dir: path outside workspace');
      const entries = fs.readdirSync(target, { withFileTypes: true }).slice(0, 120);
      return entries.map(e => `${e.isDirectory() ? '[dir]' : '[file]'} ${e.name}`).join('\n') || '（空目录）';
    },
    onGetErrors: async () => {
      const diagnostics = vscode.languages.getDiagnostics()
        .filter(([uri, items]) => {
          const resolved = nodePath.resolve(uri.fsPath);
          if (!isPathInsideRoot(resolved, workspaceRoot)) return false;
          if (repairFileSet.size > 0 && !repairFileSet.has(resolved)) return false;
          return items.some(d => d.severity === vscode.DiagnosticSeverity.Error);
        })
        .slice(0, 20);
      if (diagnostics.length === 0) {
        return repairFileSet.size > 0
          ? '（本次定位文件没有 VS Code 诊断错误；请以终端失败输出为准，不要修复其他文件诊断）'
          : '（当前没有 VS Code 诊断错误）';
      }
      return diagnostics.map(([uri, items]) => {
        const rel = relPathFromRepairWorkspace(workspaceRoot, uri.fsPath) ?? uri.fsPath;
        return items
          .filter(d => d.severity === vscode.DiagnosticSeverity.Error)
          .slice(0, 5)
          .map(d => `${rel}:${d.range.start.line + 1}:${d.range.start.character + 1}: ${d.message}`)
          .join('\n');
      }).filter(Boolean).join('\n');
    },
    onFileSearch: async (glob) => {
      const files = await vscode.workspace.findFiles(glob, LOCAL_REPAIR_SEARCH_EXCLUDE_GLOB, 80);
      return files
        .filter(uri => isPathInsideRoot(uri.fsPath, workspaceRoot))
        .map(uri => relPathFromRepairWorkspace(workspaceRoot, uri.fsPath) ?? uri.fsPath)
        .join('\n') || '（无匹配文件）';
    },
    onGetChangedFiles: async () => {
      const { runCommand } = await import('./tools/terminal');
      const result = await runCommand({ command: 'git status --short && git diff --stat', cwd: workspaceRoot, timeoutMs: 15000 });
      return result.output || '（无变更或非 git 工作区）';
    },
    onBeforeFileWrite: async (absPath, context?: AgentFileWriteContext) => {
      const decision = decideAgentFileWrite({
        absPath,
        workspaceRoot,
        toolPolicy,
        autopilotMode: vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false),
        protectedPath: isFileProtected(absPath, workspaceRoot),
        context: context || { purpose: 'local-repair', displayName: relPathFromRepairWorkspace(workspaceRoot, absPath) ?? nodePath.basename(absPath) },
      });
      if (decision.action === 'allow') return true;
      if (decision.action === 'deny') {
        postWebviewMessage(webview, {
          type: 'agentNotice',
          kind: 'warn',
          text: decision.notice || `写入被权限策略阻止：${decision.reason}`,
        });
        return false;
      }
      const confirmResult = await confirmTerminal(decision.confirmationTitle || `确认写入文件：${nodePath.basename(absPath)}`, '');
      return confirmResult.allow;
    },
    onMemoryWrite: async (proposal) => {
      new MemoryService({ workspaceRoot }).acceptWriteProposal(proposal);
    },
    mcpToolRefs,
    onMcpToolCall,
    signal,
    autopilot: vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false),
  };
}

async function runAgentTerminalCommandForLocalRepair(args: {
  webview: vscode.Webview;
  toolPolicy: ToolPolicy;
  confirmTerminal: (command: string, workdir?: string) => Promise<{ allow: boolean; alwaysAllow?: boolean; reason?: string }>;
  command: string;
  workdir?: string;
}): Promise<string> {
  const { webview, toolPolicy, confirmTerminal, command, workdir } = args;
  const terminalPermission = decideToolPermission(toolPolicy, 'terminal');
  if (terminalPermission.action === 'deny') {
    return `（命令未执行：当前 ${toolPolicy.mode} 模式不允许终端工具：${terminalPermission.reason}）`;
  }
  const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
  if (terminalPermission.action === 'requireConfirm' || !isAutopilot) {
    const confirmResult = await confirmTerminal(command, workdir ?? '');
    if (confirmResult.alwaysAllow) {
      await vscode.workspace.getConfiguration('devseek').update('autopilotMode', true, vscode.ConfigurationTarget.Global);
    }
    if (!confirmResult.allow) return `（命令未执行：${confirmResult.reason ?? '用户拒绝'}）`;
  }
  const { runCommand, formatTerminalOutputForPrompt } = await import('./tools/terminal');
  const result = await runCommand({ command, cwd: workdir, visible: false, allowRisky: !isAutopilot });
  const outputPreview = result.output.slice(0, 4000);
  webview.postMessage({ type: 'terminalRanNotice', command, workdir: workdir ?? '', exitCode: result.exitCode, output: outputPreview });
  return formatTerminalOutputForPrompt(command, result);
}

function isPathInsideRoot(absPath: string, root: string): boolean {
  if (!absPath || !root) return false;
  const rel = nodePath.relative(nodePath.resolve(root), nodePath.resolve(absPath));
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

function shellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
