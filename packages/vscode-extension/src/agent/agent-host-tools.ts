import * as fs from 'fs';
import * as nodePath from 'path';
import * as vscode from 'vscode';
import type { TerminalPermissionCoordinator } from '../app/terminal-permission-coordinator';
import type { AgentLoopCallbacks } from './loop-types';

type HostToolCallbacks = Pick<
  AgentLoopCallbacks,
  | 'onGetErrors'
  | 'onFileSearch'
  | 'onGetChangedFiles'
  | 'onCreateDirectory'
  | 'onFetchWebpage'
  | 'onListCodeUsages'
  | 'onRunVscodeCommand'
>;

export interface AgentHostToolContext {
  workspaceRoot: string;
  webview: vscode.Webview;
  terminalPermissionCoordinator: TerminalPermissionCoordinator;
}

const SAFE_VSCODE_COMMANDS = new Set([
  'editor.action.formatDocument',
  'editor.action.formatSelection',
  'editor.action.organizeImports',
  'editor.action.fixAll',
  'workbench.action.files.saveAll',
  'workbench.action.files.save',
  'workbench.files.action.refreshFilesExplorer',
  'typescript.restartTsServer',
  'eslint.executeAutofix',
  'workbench.action.tasks.runTask',
  'workbench.action.tasks.build',
  'testing.runAll',
  'testing.refreshTests',
  'editor.action.triggerSuggest',
  'rust-analyzer.reloadWorkspace',
  'python.execInTerminal',
  'C_Cpp.BuildAndDebugActiveFile',
]);

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

async function listCodeUsages(workspaceRoot: string, symbol: string, filePath?: string): Promise<string> {
  let targetUri: vscode.Uri | undefined;
  let targetPos: vscode.Position | undefined;
  const lookupPath = filePath
    ? (nodePath.isAbsolute(filePath) ? filePath : nodePath.join(workspaceRoot, filePath))
    : null;

  if (lookupPath && fs.existsSync(lookupPath)) {
    targetUri = vscode.Uri.file(lookupPath);
  } else {
    const { runCommand } = await import('../tools/terminal');
    const esc = escapeShellSingleQuotes(symbol);
    const exts = ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'cs', 'cpp', 'c', 'h'];
    const includes = exts.map(e => `--include='*.${e}'`).join(' ');
    const root = workspaceRoot.replace(/'/g, "'\\''");
    const result = await runCommand({
      command: `grep -r -l -w '${esc}' ${includes} '${root}' 2>/dev/null | head -3`,
      timeoutMs: 8000,
    });
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

  const { runCommand } = await import('../tools/terminal');
  const esc = escapeShellSingleQuotes(symbol);
  const exts = ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rs', 'cs', 'cpp', 'c', 'h', 'hpp'];
  const includes = exts.map(e => `--include='*.${e}'`).join(' ');
  const root = workspaceRoot.replace(/'/g, "'\\''");
  const result = await runCommand({
    command: `grep -r -n -w '${esc}' ${includes} '${root}' 2>/dev/null | head -40`,
    timeoutMs: 10000,
  });
  return result.stdout ? `"${symbol}" 引用（grep fallback）:\n${result.stdout}` : '（未找到引用）';
}

export function createAgentHostToolCallbacks(context: AgentHostToolContext): HostToolCallbacks {
  const { workspaceRoot, webview, terminalPermissionCoordinator } = context;

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
      const { runCommand } = await import('../tools/terminal');
      try {
        const status = await runCommand({ command: 'git status --short', cwd: workspaceRoot, timeoutMs: 5000 });
        const diff = await runCommand({ command: 'git diff --stat HEAD', cwd: workspaceRoot, timeoutMs: 5000 });
        const statusText = status.stdout.trim() || '（无变更）';
        const diffText = diff.stdout.trim();
        return diffText ? `${statusText}\n\n${diffText}` : statusText;
      } catch {
        return '（非 git 工作区或无变更）';
      }
    },
    onCreateDirectory: async (dirPath: string) => {
      const absPath = nodePath.isAbsolute(dirPath) ? dirPath : nodePath.join(workspaceRoot, dirPath);
      if (workspaceRoot && !absPath.startsWith(workspaceRoot)) throw new Error('禁止在工作区外创建目录');
      fs.mkdirSync(absPath, { recursive: true });
      return `目录已创建: ${dirPath}`;
    },
    onFetchWebpage: fetchWebpageText,
    onListCodeUsages: (symbol: string, filePath?: string) => listCodeUsages(workspaceRoot, symbol, filePath),
    onRunVscodeCommand: async (command: string, args?: unknown[]) => {
      if (!/^[\w.-]+$/.test(command)) throw new Error(`无效命令 ID: ${command}`);
      const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
      if (!isAutopilot && !SAFE_VSCODE_COMMANDS.has(command)) {
        const commandConfirm = await terminalPermissionCoordinator.requestInlineConfirmation(webview, `⚡ VS Code: ${command}`);
        if (!commandConfirm.allow) return '（命令未执行：用户拒绝）';
      }
      try {
        const result = await vscode.commands.executeCommand(command, ...(args ?? []));
        return result !== undefined
          ? `命令已执行: ${command}\n返回: ${JSON.stringify(result).slice(0, 500)}`
          : `命令已执行: ${command}`;
      } catch (err) {
        throw new Error(`命令执行失败: ${(err as Error).message}`);
      }
    },
  };
}
