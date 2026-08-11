import * as nodePath from 'path';
import * as vscode from 'vscode';
import type {
  CodingMcpAuthorityApproval,
  CodingMcpServerLaunchRequest,
} from '@devseek-netai/shared';
import { McpManager, type McpLoadReport } from './client';

const MCP_SERVER_LAUNCH_ACTION = '允许本次启动';

export interface VscodeMcpSurfacePort {
  workspaceRoot(): string | undefined;
  confirmLaunch(message: string, action: string): Promise<boolean>;
  warn(message: string): void;
}

const productionSurface: VscodeMcpSurfacePort = {
  workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  confirmLaunch: async (message, action) => {
    const selection = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      action,
    );
    return selection === action;
  },
  warn: message => { void vscode.window.showWarningMessage(message); },
};

export function createVscodeMcpManager(
  surface: VscodeMcpSurfacePort = productionSurface,
): McpManager {
  return new McpManager({
    authorizeServerLaunch: request => authorizeServerLaunch(surface, request),
  });
}

export async function initializeWorkspaceMcp(
  manager: Pick<McpManager, 'load'>,
  surface: VscodeMcpSurfacePort = productionSurface,
): Promise<McpLoadReport | undefined> {
  const workspaceRoot = surface.workspaceRoot();
  if (!workspaceRoot) return undefined;
  const configPath = nodePath.join(workspaceRoot, '.devseek', 'mcp.json');
  let report: McpLoadReport;
  try {
    report = await manager.load(configPath, workspaceRoot);
  } catch {
    surface.warn('DevSeek MCP 初始化失败：unexpected-runtime-failure');
    return undefined;
  }
  if (report.failures.length > 0) {
    surface.warn(`DevSeek MCP 初始化未完全成功：${summarizeFailures(report)}`);
  }
  return report;
}

async function authorizeServerLaunch(
  surface: VscodeMcpSurfacePort,
  request: CodingMcpServerLaunchRequest,
): Promise<CodingMcpAuthorityApproval> {
  const environmentSummary = request.environmentKeys.length > 0
    ? `；显式环境变量：${request.environmentKeys.join(', ')}`
    : '';
  const message = `MCP 服务器“${request.serverName}”请求启动 ${request.commandLabel}`
    + `（${request.argumentCount} 个参数${environmentSummary}）。启动后，本会话内只读工具可直接运行，`
    + '高风险操作仍会确认；配置文件本身不代表执行授权。';
  const allowed = await surface.confirmLaunch(message, MCP_SERVER_LAUNCH_ACTION);
  return {
    decision: allowed ? 'allow' : 'deny',
    actor: 'user',
    reason: allowed ? 'user-approved-visible-mcp-server-launch' : 'user-rejected-mcp-server-launch',
    ...(allowed ? {
      evidenceRef: `vscode-mcp-launch-confirmation:${request.requestSha256}`,
    } : {}),
  };
}

function summarizeFailures(report: McpLoadReport): string {
  return report.failures
    .slice(0, 3)
    .map(failure => `${failure.serverName ?? 'config'}:${failure.stage}:${failure.code}`)
    .join('; ');
}
