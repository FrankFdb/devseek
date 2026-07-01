import type { ChatMessage } from '../llm/types';
import { isCppBuildArtifactDirName } from '../cpp-build-layout';
import { absPathFromWorkspaceRel, relPathFromWorkspace } from './context-discovery-service';
import {
  buildContextAnchors,
  filterByContextAnchors,
  hasContextAnchors,
  textMatchesContextAnchors,
} from './context-relevance';
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
  if (!input.workspaceRoot) return [];

  const primaryRelPaths = [
    ...(input.state?.changedPaths ?? []),
    ...input.lastAgentChangedPaths,
  ].filter(pathValue => isRestorableSessionPath(pathValue, input.workspaceRoot));
  const primaryAnchors = buildContextAnchors({
    workspaceRoot: input.workspaceRoot,
    prompt: input.prompt,
    relatedPaths: primaryRelPaths,
  });

  const candidates: string[] = [];
  for (const rel of input.state?.changedPaths ?? []) {
    if (isRestorableSessionPath(rel, input.workspaceRoot)) candidates.push(rel);
  }
  for (const rel of input.lastAgentChangedPaths) {
    if (isRestorableSessionPath(rel, input.workspaceRoot)) candidates.push(rel);
  }
  for (const abs of input.recentFilePaths) {
    const rel = relPathFromWorkspace(input.workspaceRoot, abs);
    if (rel && isRestorableSessionPath(rel, input.workspaceRoot)) candidates.push(rel);
  }

  const scopedCandidates = hasContextAnchors(primaryAnchors)
    ? filterByContextAnchors([...new Set(candidates)], primaryAnchors, pathValue => pathValue)
    : [...new Set(candidates)];

  const resolved = prioritizeContinuationFiles(scopedCandidates
    .map(rel => absPathFromWorkspaceRel(input.workspaceRoot, rel))
    .filter((abs): abs is string => Boolean(abs)), input.workspaceRoot);
  const codeFirst = resolved.filter(pathValue => AGENT_CODE_FILE_RE.test(pathValue));
  if (!shouldRestoreSessionFiles(input.prompt, input.intent, codeFirst.length > 0)) return [];
  if (codeFirst.length === 0) return [];
  const supporting = resolved.filter(pathValue => !AGENT_CODE_FILE_RE.test(pathValue)).slice(0, 3);
  return [...codeFirst.slice(0, 6), ...supporting];
}

function prioritizeContinuationFiles(absPaths: string[], workspaceRoot: string): string[] {
  const scored = absPaths.map(absPath => ({
    absPath,
    score: continuationPathScore(absPath, workspaceRoot),
  }));
  scored.sort((a, b) => b.score - a.score || a.absPath.localeCompare(b.absPath));
  return scored.map(item => item.absPath);
}

function continuationPathScore(absPath: string, workspaceRoot: string): number {
  const rel = relPathFromWorkspace(workspaceRoot, absPath) ?? absPath.replace(/\\/g, '/');
  const depth = rel.split('/').filter(Boolean).length;
  const sourceRootBonus = /^(?:code|src|source|sources|include|lib|app|apps|packages|pkg|modules|cmd|core)\//i.test(rel)
    ? 100
    : 0;
  const rootFilePenalty = rel.includes('/') ? 0 : -50;
  return sourceRootBonus + depth + rootFilePenalty;
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

  const primaryRelatedPaths = [
    ...(input.state?.changedPaths ?? []),
    ...input.lastAgentChangedPaths,
  ].filter(pathValue => isRestorableSessionPath(pathValue, input.workspaceRoot));
  const recentFileList = [...new Set(input.recentFilePaths)]
    .filter(Boolean)
    .filter(pathValue => isRestorableSessionPath(pathValue, input.workspaceRoot));
  const anchors = buildContextAnchors({
    workspaceRoot: input.workspaceRoot,
    prompt: input.currentPrompt,
    relatedPaths: primaryRelatedPaths.length > 0 ? primaryRelatedPaths : recentFileList,
    extraText: [
      input.state?.lastUserPrompt ?? '',
      input.state?.lastSummary ?? '',
    ],
  });
  const shouldFilter = hasContextAnchors(anchors);
  const historySource = shouldFilter
    ? filterByContextAnchors(input.history, anchors, message => chatMessageText(message))
    : [...input.history];

  const recentHistory = historySource
    .slice(-6)
    .map((entry) => {
      const role = entry.role === 'user' ? '用户' : '助手';
      const content = chatMessageText(entry);
      return `- ${role}: ${content.replace(/\s+/g, ' ').slice(0, 700)}`;
    });

  const recentFiles = filterByContextAnchors(recentFileList, anchors, abs => relPathFromWorkspace(input.workspaceRoot, abs) ?? abs)
    .filter(Boolean)
    .map(abs => relPathFromWorkspace(input.workspaceRoot, abs) ?? abs)
    .filter(pathValue => pathValue && !pathValue.startsWith('..'))
    .slice(0, 12);

  const stateRelevant = input.state
    && (!shouldFilter
      || textMatchesContextAnchors(input.state.lastSummary, anchors)
      || input.state.changedPaths
        .filter(pathValue => isRestorableSessionPath(pathValue, input.workspaceRoot))
        .some(pathValue => textMatchesContextAnchors(pathValue, anchors)));
  if (recentHistory.length === 0 && recentFiles.length === 0 && !stateRelevant) return '';

  const lines: string[] = [
    '这是同一个聊天 session 的后续消息。当前用户消息如果是短句、追问、纠错或反馈，必须优先基于下面的上一轮上下文继续处理；不要把它当作全新任务，也不要默认扫描整个工作区目录。',
    `当前用户消息：${input.currentPrompt}`,
  ];
  if (input.state?.lastSummary && stateRelevant) {
    lines.push('上一轮 Agent 状态：');
    lines.push(`- 用户目标：${input.state.lastUserPrompt}`);
    lines.push(`- 执行结果：${input.state.completed ? '已完成' : '未完成或需要复核'}`);
    lines.push(`- 摘要：${input.state.lastSummary.slice(0, 800)}`);
    if (input.state.changedPaths.length > 0) {
      const changedPaths = input.state.changedPaths.filter(pathValue => isRestorableSessionPath(pathValue, input.workspaceRoot));
      if (changedPaths.length > 0) {
        lines.push('- 涉及文件：');
        lines.push(...filterByContextAnchors(changedPaths, anchors, pathValue => pathValue).slice(0, 12).map(pathValue => `  - ${pathValue}`));
      }
    }
  }
  if (input.lastAgentChangedPaths.length > 0) {
    const changedPaths = filterByContextAnchors(
      input.lastAgentChangedPaths.filter(pathValue => isRestorableSessionPath(pathValue, input.workspaceRoot)),
      anchors,
      pathValue => pathValue,
    ).slice(0, 10);
    if (changedPaths.length > 0) {
      lines.push('上一轮 Agent 涉及/修改的文件：');
      lines.push(...changedPaths.map(pathValue => `- ${pathValue}`));
    }
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

function chatMessageText(message: ChatMessage): string {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
}

function isRestorableSessionPath(pathValue: string, workspaceRoot: string): boolean {
  const rel = relPathFromWorkspace(workspaceRoot, pathValue) ?? String(pathValue || '').replace(/\\/g, '/');
  return !rel
    .split('/')
    .filter(Boolean)
    .some(isGeneratedArtifactSegment);
}

function isGeneratedArtifactSegment(segment: string): boolean {
  const normalized = segment.toLowerCase();
  return isCppBuildArtifactDirName(segment)
    || ['dist', 'out', 'target', 'coverage', 'node_modules'].includes(normalized);
}
