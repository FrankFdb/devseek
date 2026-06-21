import type { ChatMessage } from '../llm/types';
import { absPathFromWorkspaceRel, relPathFromWorkspace } from './context-discovery-service';
import { shouldRestoreSessionFiles } from './session-continuation';

export const AGENT_CODE_FILE_RE = /(?:^|\/)(?:Makefile|CMakeLists\.txt)$|\.(cpp|c|h|hpp|cc|cxx|ts|tsx|js|jsx|mjs|py|rs|go|java|cs|rb|php|swift|kt|scala|dart|lua|r)$/i;

export interface AgentSessionState {
  lastUserPrompt: string;
  lastSummary: string;
  changedPaths: string[];
  completed: boolean;
  savedAt: number;
}

export interface ResolveSessionContinuationFilesInput {
  workspaceRoot: string;
  prompt: string;
  intent?: { mode?: string; signals?: readonly string[] };
  state?: AgentSessionState;
  lastAgentChangedPaths: readonly string[];
  recentFilePaths: Iterable<string>;
}

export function resolveSessionContinuationFilesFromState(input: ResolveSessionContinuationFilesInput): string[] {
  if (!input.workspaceRoot || !shouldRestoreSessionFiles(input.prompt, input.intent)) return [];

  const candidates: string[] = [];
  for (const rel of input.state?.changedPaths ?? []) candidates.push(rel);
  for (const rel of input.lastAgentChangedPaths) candidates.push(rel);
  for (const abs of input.recentFilePaths) {
    const rel = relPathFromWorkspace(input.workspaceRoot, abs);
    if (rel) candidates.push(rel);
  }

  const resolved = [...new Set(candidates)]
    .map(rel => absPathFromWorkspaceRel(input.workspaceRoot, rel))
    .filter((abs): abs is string => Boolean(abs));
  const codeFirst = resolved.filter(pathValue => AGENT_CODE_FILE_RE.test(pathValue));
  if (codeFirst.length === 0) return [];
  const supporting = resolved.filter(pathValue => !AGENT_CODE_FILE_RE.test(pathValue)).slice(0, 3);
  return [...codeFirst.slice(0, 6), ...supporting];
}

export interface BuildAgenticSessionContextInput {
  workspaceRoot: string;
  currentPrompt: string;
  state?: AgentSessionState;
  lastAgentChangedPaths: readonly string[];
  recentFilePaths: Iterable<string>;
  history: readonly ChatMessage[];
}

export function buildAgenticSessionContextFromState(input: BuildAgenticSessionContextInput): string {
  if (!input.workspaceRoot) return '';

  const recentHistory = input.history
    .slice(-6)
    .map((entry) => {
      const role = entry.role === 'user' ? '用户' : '助手';
      const content = typeof entry.content === 'string'
        ? entry.content
        : JSON.stringify(entry.content);
      return `- ${role}: ${content.replace(/\s+/g, ' ').slice(0, 700)}`;
    });

  const recentFiles = [...new Set(input.recentFilePaths)]
    .filter(Boolean)
    .map(abs => relPathFromWorkspace(input.workspaceRoot, abs) ?? abs)
    .filter(pathValue => pathValue && !pathValue.startsWith('..'))
    .slice(0, 12);

  if (recentHistory.length === 0 && recentFiles.length === 0 && !input.state?.lastSummary) return '';

  const lines: string[] = [
    '这是同一个聊天 session 的后续消息。当前用户消息如果是短句、追问、纠错或反馈，必须优先基于下面的上一轮上下文继续处理；不要把它当作全新任务，也不要默认扫描整个工作区目录。',
    `当前用户消息：${input.currentPrompt}`,
  ];
  if (input.state?.lastSummary) {
    lines.push('上一轮 Agent 状态：');
    lines.push(`- 用户目标：${input.state.lastUserPrompt}`);
    lines.push(`- 执行结果：${input.state.completed ? '已完成' : '未完成或需要复核'}`);
    lines.push(`- 摘要：${input.state.lastSummary.slice(0, 800)}`);
    if (input.state.changedPaths.length > 0) {
      lines.push('- 涉及文件：');
      lines.push(...input.state.changedPaths.slice(0, 12).map(pathValue => `  - ${pathValue}`));
    }
  }
  if (input.lastAgentChangedPaths.length > 0) {
    lines.push('上一轮 Agent 涉及/修改的文件：');
    lines.push(...input.lastAgentChangedPaths.slice(0, 10).map(pathValue => `- ${pathValue}`));
  }
  if (recentFiles.length > 0) {
    lines.push('本 session 最近文件记忆：');
    lines.push(...recentFiles.map(pathValue => `- ${pathValue}`));
  }
  if (recentHistory.length > 0) {
    lines.push('最近对话摘要：');
    lines.push(...recentHistory);
  }
  lines.push('执行要求：若用户反馈“没有看到/找不到/不对/继续/重新编译/运行”等，先核查上一轮目标文件和目录的真实状态，再修复或验证；不要泛化为分析整个 code 目录。');
  return lines.join('\n').slice(0, 6000);
}
