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
  if (shouldWarnMcpStartupFailure(report)) {
    surface.warn(`DevSeek MCP 初始化未完全成功：${summarizeFailures(report)}`);
  }
  return report;
}

export function renderMcpStatusText(
  report: McpLoadReport | undefined,
  workspaceRoot: string | undefined,
): string {
  if (!workspaceRoot) return 'DevSeek MCP: 未打开工作区，未加载 MCP 配置。';
  if (!report) return `DevSeek MCP: 尚未完成初始化。\n工作区: ${workspaceRoot}`;
  const lines = [
    'DevSeek MCP 状态',
    `工作区: ${workspaceRoot}`,
    `配置: ${renderConfigStatus(report.configStatus)}`,
    `服务器: configured=${report.configuredServers}, connected=${report.connectedServers.length}, denied=${report.deniedServers.length}`,
    `工具: registered=${report.registeredTools}`,
  ];
  if (report.connectedServers.length > 0) {
    lines.push(`已连接: ${report.connectedServers.join(', ')}`);
  }
  if (report.deniedServers.length > 0) {
    lines.push(`已拒绝: ${report.deniedServers.join(', ')}`);
  }
  if (report.failures.length > 0) {
    lines.push('失败摘要:');
    lines.push(...report.failures.slice(0, 5).map(failure =>
      `- ${failure.serverName ?? 'config'}:${failure.stage}:${failure.code}`
    ));
    if (report.failures.length > 5) {
      lines.push(`- ... 还有 ${report.failures.length - 5} 项`);
    }
  } else {
    lines.push('失败摘要: none');
  }
  return lines.join('\n');
}

function shouldWarnMcpStartupFailure(report: McpLoadReport): boolean {
  return report.failures.some(failure => failure.stage !== 'config-read');
}

function renderConfigStatus(status: McpLoadReport['configStatus']): string {
  if (status === 'absent') return 'absent optional config';
  if (status === 'loaded') return 'loaded';
  return 'invalid';
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
