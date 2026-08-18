import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';
import type { TerminalPermissionCoordinator } from '../app/terminal-permission-coordinator';
import { buildToolPolicy } from '../app/permission-service';
import { ProductMutationCoordinator } from '../app/product-mutation-coordinator';
import { adaptPreparedProductTool } from '../app/prepared-product-tool-adapter';
import type { DevSeekRunContext } from '../app/run-context';
import { VsCodeWorkspaceDirectoryMutationAdapter } from '../workspace/coding-workspace-directory-mutation-adapter';
import { WorkspaceEditService } from '../workspace/edit-service';
import type { AgentLoopCallbacks } from './loop-types';
import { explainUnsupportedVscodeCommand, getSupportedVscodeCommandPolicy } from './vscode-command-policy';

type HostToolCallbacks = Pick<
  AgentLoopCallbacks,
  | 'onGetErrors'
  | 'onFileSearch'
  | 'onGetChangedFiles'
  | 'onCreateDirectory'
  | 'onFetchWebpage'
  | 'onListCodeUsages'
  | 'onPrepareVscodeCommand'
>;

export interface AgentHostToolContext {
  workspaceRoot: string;
  webview: vscode.Webview;
  terminalPermissionCoordinator: TerminalPermissionCoordinator;
  runContext: DevSeekRunContext;
  signal?: AbortSignal;
}

function isInternalNetworkHost(host: string): boolean {
  return /^(localhost|127\.|0\.0\.0\.0|::1|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.)/.test(host);
}

function escapeShellSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''").slice(0, 80);
}

async function fetchWebpageText(url: string): Promise<string> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`无效 URL: ${url}`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('仅支持 http/https 协议');
  if (isInternalNetworkHost(parsedUrl.hostname.toLowerCase())) throw new Error('拒绝访问内部网络地址');

  const mod = parsedUrl.protocol === 'https:' ? require('https') : require('http');
  return new Promise<string>((resolve, reject) => {
    const req = mod.request(
      url,
      { headers: { 'User-Agent': 'DevSeek-Agent/1.0' }, timeout: 8000 },
      (res: NodeJS.ReadableStream & { setEncoding: (encoding: string) => void }) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => { if (data.length < 50000) data += chunk; });
        res.on('end', () => {
          const text = data
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 20000);
          resolve(text || '（页面内容为空）');
        });
      },
    );
    req.on('error', (e: Error) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.end();
  });
}

type ReadOnlyCommandRunner = (command: string, timeoutMs: number) => Promise<{ stdout: string }>;

async function listCodeUsages(
  workspaceRoot: string,
  symbol: string,
  filePath: string | undefined,
  runReadOnlyCommand: ReadOnlyCommandRunner,
): Promise<string> {
  let targetUri: vscode.Uri | undefined;
  let targetPos: vscode.Position | undefined;
  const lookupPath = filePath
    ? (nodePath.isAbsolute(filePath) ? filePath : nodePath.join(workspaceRoot, filePath))
    : null;

  if (lookupPath && fs.existsSync(lookupPath)) {
    targetUri = vscode.Uri.file(lookupPath);
  } else {
    const esc = escapeShellSingleQuotes(symbol);
    const exts = ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'cs', 'cpp', 'c', 'h'];
    const includes = exts.map(e => `--include='*.${e}'`).join(' ');
    const root = workspaceRoot.replace(/'/g, "'\\''");
    const result = await runReadOnlyCommand(`grep -r -l -w '${esc}' ${includes} '${root}' 2>/dev/null | head -3`, 8000);
    const first = result.stdout.trim().split('\n')[0];
    if (first && fs.existsSync(first)) targetUri = vscode.Uri.file(first);
  }

  if (targetUri) {
    try {
      const doc = await vscode.workspace.openTextDocument(targetUri);
      const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      for (let i = 0; i < Math.min(doc.lineCount, 3000); i++) {
        const match = re.exec(doc.lineAt(i).text);
        if (match) {
          targetPos = new vscode.Position(i, match.index);
          break;
        }
      }
      if (targetPos) {
        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          targetUri,
          targetPos,
        );
        if (locations && locations.length > 0) {
          const lines = locations.slice(0, 30).map(location =>
            `${vscode.workspace.asRelativePath(location.uri)}:${location.range.start.line + 1}`,
          );
          return `"${symbol}" 共 ${locations.length} 处引用：\n${lines.join('\n')}${
            locations.length > 30 ? '\n（仅显示前 30 条）' : ''
          }`;
        }
      }
    } catch {
      // Fall back to grep below when the language server has no usable answer.
    }
  }

  const esc = escapeShellSingleQuotes(symbol);
  const exts = ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'cs', 'cpp', 'c', 'h', 'hpp'];
  const includes = exts.map(e => `--include='*.${e}'`).join(' ');
  const root = workspaceRoot.replace(/'/g, "'\\''");
  const result = await runReadOnlyCommand(`grep -r -n -w '${esc}' ${includes} '${root}' 2>/dev/null | head -40`, 10000);
  return result.stdout ? `"${symbol}" 引用（grep fallback）:\n${result.stdout}` : '（未找到引用）';
}

export function createAgentHostToolCallbacks(context: AgentHostToolContext): HostToolCallbacks {
  const { workspaceRoot, webview, terminalPermissionCoordinator, runContext, signal } = context;
  const mutations = new ProductMutationCoordinator(runContext, 'vscode-agent-host');
  const workspaceEditService = new WorkspaceEditService();
  const directoryMutations = new VsCodeWorkspaceDirectoryMutationAdapter(workspaceEditService);
  const runReadOnlyCommand: ReadOnlyCommandRunner = async (command, timeoutMs) => {
    const result = await terminalPermissionCoordinator.runCommandWithPermissionDetailed({
      webview,
      command,
      workdir: workspaceRoot,
      workspaceRoot,
      mode: 'run',
      toolPolicy: buildToolPolicy('run'),
      policyPreauthorized: true,
      presentation: 'captured',
      timeoutMs,
      traceRunId: runContext.runId,
      traceEvidenceParticipantToken: runContext.evidenceParticipantToken,
      onTraceEvidenceError: error => runContext.reportEvidenceIssue(error),
      signal,
    });
    if (result.outcome !== 'committed') {
      throw new Error(`Read-only host inspection did not complete: ${result.output}`);
    }
    return { stdout: result.stdout ?? '' };
  };

  return {
    onGetErrors: async () => {
      const errors: string[] = [];
      for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
        for (const diagnostic of diagnostics) {
          if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
            errors.push(`${vscode.workspace.asRelativePath(uri)}:${diagnostic.range.start.line + 1}: ${diagnostic.message}`);
          }
        }
      }
      return errors.length > 0 ? errors.join('\n') : '（当前无诊断错误）';
    },
    onFileSearch: async (glob: string) => {
      const uris = await vscode.workspace.findFiles(glob, '**/node_modules/**', 50);
      if (uris.length === 0) return '（无匹配文件）';
      return uris.map(uri => workspaceRoot ? nodePath.relative(workspaceRoot, uri.fsPath) : uri.fsPath).join('\n');
    },
    onGetChangedFiles: async () => {
      if (!workspaceRoot) return '（无工作区）';
      try {
        const status = await runReadOnlyCommand('git status --short', 5000);
        const diff = await runReadOnlyCommand('git diff --stat HEAD', 5000);
        const statusText = status.stdout.trim() || '（无变更）';
        const diffText = diff.stdout.trim();
        return diffText ? `${statusText}\n\n${diffText}` : statusText;
      } catch {
        return '（非 git 工作区或无变更）';
      }
    },
    onCreateDirectory: async (dirPath, authorization) => {
      const absPath = nodePath.isAbsolute(dirPath) ? dirPath : nodePath.join(workspaceRoot, dirPath);
      if (authorization.policyPreauthorized !== true) {
        throw new Error('agent file-write policy did not authorize directory creation');
      }
      const outcome = await directoryMutations.execute({
        transaction: authorization.transaction,
        runId: authorization.runId,
        sequence: authorization.sequence,
        actionId: authorization.actionId,
        absPath,
        workspaceRoot,
        baseline: workspaceEditService.captureWorkspaceDirectoryBaseline(absPath, workspaceRoot),
        evidenceRefs: authorization.evidenceRefs,
      });
      return {
        message: outcome.receipt.result?.created ? `目录已创建: ${dirPath}` : `目录已存在: ${dirPath}`,
        changeReceipt: outcome.receipt,
      };
    },
    onFetchWebpage: fetchWebpageText,
    onListCodeUsages: (symbol: string, filePath?: string) => listCodeUsages(
      workspaceRoot,
      symbol,
      filePath,
      runReadOnlyCommand,
    ),
    onPrepareVscodeCommand: async (command: string, args?: unknown[]) => {
      if (!/^[\w.-]+$/.test(command)) throw new Error(`无效命令 ID: ${command}`);
      const policy = getSupportedVscodeCommandPolicy(command);
      const preflightReason = !policy
        ? explainUnsupportedVscodeCommand(command)
        : (args?.length ?? 0) > 0
          ? `${command} does not accept opaque agent-supplied arguments`
          : undefined;
      const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
      const prepared = await mutations.prepare({
        kind: 'vscode-command',
        label: `vscode-command:${command}`,
        authorize: async () => {
          if (!policy || (args?.length ?? 0) > 0) {
            return { allowed: false, source: 'execution-policy', reason: preflightReason };
          }
          if (policy.classification !== 'mutating-with-permission' || isAutopilot) {
            return { allowed: true, source: 'execution-policy' };
          }
          const decision = await terminalPermissionCoordinator.requestInlineConfirmation(webview, `⚡ VS Code: ${command}`);
          return { allowed: decision.allow, source: 'user-confirmed', reason: decision.reason };
        },
        invoke: () => vscode.commands.executeCommand(command),
        completionEvidence: {
          kind: 'invocation-receipt',
          proof: () => ({
            command_id: command,
            command_classification: policy?.classification ?? 'unsupported',
            receipt: 'vscode-command-promise-resolved',
          }),
        },
      });
      return adaptPreparedProductTool({
        prepared,
        constraintRef: `vscode-command-constraint:${runContext.runId}:${command}`,
        completedEvidenceRef: `vscode-command-result:${runContext.runId}:${command}`,
        formatResult: result => result !== undefined
          ? `VS Code 已接受命令: ${command}\n返回: ${JSON.stringify(result).slice(0, 500)}\n（仅证明命令 Promise 已成功返回）`
          : `VS Code 已接受命令: ${command}（仅证明命令 Promise 已成功返回）`,
      });
    },
  };
}
