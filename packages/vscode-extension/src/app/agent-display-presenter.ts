import type { AgentStatusEvent } from '../agent/events';

export interface PresentedAgentStatus extends AgentStatusEvent {
  displayTitle: string;
  displayDetail?: string;
}

export class AgentDisplayPresenter {
  presentStatus(status: AgentStatusEvent): PresentedAgentStatus {
    const displayTitle = formatStatusTitle(status);
    const displayDetail = formatStatusDetail(status.detail);
    return {
      ...status,
      title: displayTitle,
      detail: displayDetail,
      displayTitle,
      ...(displayDetail ? { displayDetail } : {}),
    };
  }
}

function formatStatusTitle(status: AgentStatusEvent): string {
  const raw = normalizeInlineText(status.title);
  if (!raw || looksLikeInternalCommandTitle(raw) || looksLikeInternalToolTranscript(raw) || looksLikeSourceSnippet(raw)) {
    return fallbackStatusTitle(status);
  }
  if (status.phase === 'execute' && status.state === 'started' && status.taskAction === 'explore' && looksLikeUserPromptTitle(raw)) {
    return '正在建立任务上下文';
  }
  if (status.phase === 'validate') {
    return raw
      .replace(/^执行完成\s*✓?$/, '运行验证完成 ✓')
      .replace(/^执行完成/, '运行验证完成')
      .replace(/^Command completed$/i, '命令执行完成')
      .replace(/^Command failed$/i, '命令执行失败');
  }
  return raw;
}

function formatStatusDetail(detail: string | undefined): string | undefined {
  const raw = String(detail || '').trim();
  if (!raw) return undefined;
  const max = 1800;
  return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
}

function fallbackStatusTitle(status: AgentStatusEvent): string {
  if (status.phase === 'validate') {
    if (status.state === 'failed') return '验证未通过';
    if (status.state === 'skipped') return '已跳过验证';
    if (status.state === 'started') return '正在验证';
    return '验证完成';
  }
  if (status.phase === 'error') return '本轮失败';
  if (status.phase === 'done') return status.state === 'failed' ? '任务未完成' : '任务完成';
  if (status.phase === 'repair') return status.state === 'failed' ? '修复未通过' : '正在修复';
  if (status.phase === 'plan') return status.state === 'failed' ? '计划生成失败' : '任务规划';
  return status.state === 'failed' ? '执行未完成' : '处理中';
}

function normalizeInlineText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function looksLikeInternalCommandTitle(value: string): boolean {
  return /^(?:Ran|Failed)\s+/i.test(value)
    || /(?:^|\s)(?:cmake|make|ninja|npm|node|python|pytest|cargo|go|gcc|g\+\+|clang|rm|mkdir|cd)\s/.test(value)
    || /\$\s*(?:cmake|make|npm|node|python|rm|mkdir|cd)\b/.test(value);
}

function looksLikeInternalToolTranscript(value: string): boolean {
  return /(?:<TOOL_STREAM>|<\/TOOL_STREAM>|<TOOL\b|<\/TOOL>|\[TOOL:|(?:^|\s)(?:run_terminal|create_file|write_file|replace_in_file|read_file|list_dir|grep_search)\s*\(\s*\{)/i.test(value);
}

function looksLikeSourceSnippet(value: string): boolean {
  if (/^(?:void|int|bool|char|class|struct|template|#include)\b/i.test(value)) return true;
  if (/(?:#include\s*<|\bstd::|\bnullptr\b|\b[A-Za-z_]\w*::[A-Za-z_]\w*\b)/.test(value)) return true;
  return /[{};]/.test(value) && /\b(?:void|int|bool|char|class|struct|return|nullptr|std::)\b/.test(value);
}

function looksLikeUserPromptTitle(value: string): boolean {
  if (value.length > 80) return true;
  return /(?:\/home\/|[A-Za-z]:\\|请|需要|基于|参考|实现|分析).{20,}/.test(value);
}
