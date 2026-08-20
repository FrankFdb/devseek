import type { ChatMessage } from '../llm/types';
import type { TaskSemanticContract } from '../task-semantic-contract';
import { isCppBuildArtifactDirName } from '../cpp-build-layout';
import { absPathFromWorkspaceRel, relPathFromWorkspace } from './context-discovery-service';

export const AGENT_CODE_FILE_RE = /(?:^|\/)(?:Makefile|CMakeLists\.txt)$|\.(cpp|c|h|hpp|cc|cxx|ts|tsx|js|jsx|mjs|py|rs|go|java|cs|rb|php|swift|kt|scala|dart|lua|r)$/i;

export interface AgentSessionState {
  lastUserPrompt: string;
  lastSummary: string;
  changedPaths: string[];
  completed: boolean;
  savedAt: number;
  /** Historical metadata only; never restored as current execution authority. */
  semanticContract?: TaskSemanticContract;
}

export interface ResolveSessionContinuationFilesInput {
  workspaceRoot: string;
  prompt: string;
  state?: AgentSessionState;
  lastAgentChangedPaths: readonly string[];
  recentFilePaths: Iterable<string>;
  currentFilePaths?: Iterable<string>;
}

/**
 * Returns a bounded same-session working set without interpreting the current
 * sentence. These files are context for the model, not mutation permission.
 */
export function resolveSessionContinuationFilesFromState(input: ResolveSessionContinuationFilesInput): string[] {
  if (!input.workspaceRoot) return [];

  const candidates: string[] = [];
  for (const pathValue of input.state?.changedPaths ?? []) {
    if (isRestorableSessionPath(pathValue, input.workspaceRoot)) candidates.push(pathValue);
  }
  for (const pathValue of input.lastAgentChangedPaths) {
    if (isRestorableSessionPath(pathValue, input.workspaceRoot)) candidates.push(pathValue);
  }
  for (const absPath of input.recentFilePaths) {
    const relative = relPathFromWorkspace(input.workspaceRoot, absPath);
    if (relative && isRestorableSessionPath(relative, input.workspaceRoot)) candidates.push(relative);
  }

  const resolved = prioritizeContinuationFiles(
    [...new Set(candidates)]
      .map(relative => absPathFromWorkspaceRel(input.workspaceRoot, relative))
      .filter((absPath): absPath is string => Boolean(absPath)),
    input.workspaceRoot,
  );
  const codeFiles = resolved.filter(pathValue => AGENT_CODE_FILE_RE.test(pathValue));
  const supportingFiles = resolved.filter(pathValue => !AGENT_CODE_FILE_RE.test(pathValue));
  return [...codeFiles.slice(0, 6), ...supportingFiles.slice(0, 3)];
}

function prioritizeContinuationFiles(absPaths: string[], workspaceRoot: string): string[] {
  const scored = absPaths.map(absPath => ({
    absPath,
    score: continuationPathScore(absPath, workspaceRoot),
  }));
  scored.sort((left, right) => right.score - left.score || left.absPath.localeCompare(right.absPath));
  return scored.map(item => item.absPath);
}

function continuationPathScore(absPath: string, workspaceRoot: string): number {
  const relative = relPathFromWorkspace(workspaceRoot, absPath) ?? absPath.replace(/\\/g, '/');
  const depth = relative.split('/').filter(Boolean).length;
  const sourceRootBonus = /^(?:code|src|source|sources|include|lib|app|apps|packages|pkg|modules|cmd|core)\//i.test(relative)
    ? 100
    : 0;
  const rootFilePenalty = relative.includes('/') ? 0 : -50;
  return sourceRootBonus + depth + rootFilePenalty;
}

export interface BuildAgenticSessionContextInput {
  workspaceRoot: string;
  currentPrompt: string;
  state?: AgentSessionState;
  lastAgentChangedPaths: readonly string[];
  recentFilePaths: Iterable<string>;
  currentFilePaths?: Iterable<string>;
  history: readonly ChatMessage[];
  preserveSessionContext?: boolean;
}

export function buildAgenticSessionContextFromState(input: BuildAgenticSessionContextInput): string {
  if (!input.workspaceRoot) return '';

  const recentHistory = input.history
    .slice(-6)
    .map(entry => {
      const role = entry.role === 'user' ? '用户' : '助手';
      return `- ${role}: ${chatMessageText(entry).replace(/\s+/g, ' ').slice(0, 700)}`;
    });
  const recentFiles = [...new Set(input.recentFilePaths)]
    .filter(pathValue => isRestorableSessionPath(pathValue, input.workspaceRoot))
    .map(absPath => relPathFromWorkspace(input.workspaceRoot, absPath) ?? absPath)
    .filter(pathValue => pathValue && !pathValue.startsWith('..'))
    .slice(0, 12);
  const changedPaths = [...new Set([
    ...(input.state?.changedPaths ?? []),
    ...input.lastAgentChangedPaths,
  ])]
    .filter(pathValue => isRestorableSessionPath(pathValue, input.workspaceRoot))
    .slice(0, 12);

  if (!input.state && recentHistory.length === 0 && recentFiles.length === 0 && changedPaths.length === 0) {
    return '';
  }

  const lines: string[] = [
    '【同一 session 的有界历史上下文（非执行授权）】',
    '以下记录可用于理解指代、追问、纠错或任务切换。请由模型根据当前用户消息判断相关性；历史路径、状态和旧契约不授权任何工具动作，也不得覆盖当前要求。',
    `当前用户消息：${input.currentPrompt}`,
  ];
  if (input.state) {
    lines.push('上一轮 Agent 状态：');
    lines.push(`- 历史用户目标：${input.state.lastUserPrompt.slice(0, 700)}`);
    lines.push(`- 历史执行状态：${input.state.completed ? '已完成' : '未完成或需要复核'}`);
    if (input.state.lastSummary) lines.push(`- 历史摘要：${input.state.lastSummary.slice(0, 800)}`);
  }
  if (changedPaths.length > 0) {
    lines.push('历史工作集路径：');
    lines.push(...changedPaths.map(pathValue => `- ${pathValue}`));
  }
  if (recentFiles.length > 0) {
    lines.push('本 session 最近文件：');
    lines.push(...recentFiles.map(pathValue => `- ${pathValue}`));
  }
  if (recentHistory.length > 0) {
    lines.push('最近对话：');
    lines.push(...recentHistory);
  }
  return lines.join('\n').slice(0, 6000);
}

export type SessionContinuationProjectionMode =
  | 'none'
  | 'files-only'
  | 'context-only'
  | 'context-and-files';

export interface ProjectSessionContinuationInput extends BuildAgenticSessionContextInput {
  newSession: boolean;
}

export interface SessionContinuationProjection {
  mode: SessionContinuationProjectionMode;
  restoreFiles: string[];
  contextText: string;
}

export function projectSessionContinuationFromState(
  input: ProjectSessionContinuationInput,
): SessionContinuationProjection {
  if (input.newSession) return { mode: 'none', restoreFiles: [], contextText: '' };

  const currentFilePaths = [...(input.currentFilePaths ?? [])];
  const recentFilePaths = [...input.recentFilePaths];
  const restoreFiles = currentFilePaths.length > 0
    ? []
    : resolveSessionContinuationFilesFromState({
        workspaceRoot: input.workspaceRoot,
        prompt: input.currentPrompt,
        state: input.state,
        lastAgentChangedPaths: input.lastAgentChangedPaths,
        recentFilePaths,
        currentFilePaths,
      });
  const contextText = buildAgenticSessionContextFromState({
    ...input,
    recentFilePaths,
    currentFilePaths,
  });

  return {
    mode: projectionMode(restoreFiles.length > 0, Boolean(contextText)),
    restoreFiles,
    contextText,
  };
}

function projectionMode(hasFiles: boolean, hasContext: boolean): SessionContinuationProjectionMode {
  if (hasFiles && hasContext) return 'context-and-files';
  if (hasFiles) return 'files-only';
  if (hasContext) return 'context-only';
  return 'none';
}

function chatMessageText(message: ChatMessage): string {
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
}

function isRestorableSessionPath(pathValue: string, workspaceRoot: string): boolean {
  const relative = relPathFromWorkspace(workspaceRoot, pathValue) ?? String(pathValue || '').replace(/\\/g, '/');
  return !relative
    .split('/')
    .filter(Boolean)
    .some(isGeneratedArtifactSegment);
}

function isGeneratedArtifactSegment(segment: string): boolean {
  const normalized = segment.toLowerCase();
  return isCppBuildArtifactDirName(segment)
    || ['dist', 'out', 'target', 'coverage', 'node_modules'].includes(normalized);
}
