import type {
  AgentProgressPresentation,
  AgentProgressStage,
  AgentStatusEvent,
  AgentToolActivityEvent,
} from '../agent/events';

export interface PresentedAgentStatus extends AgentStatusEvent {
  displayTitle: string;
  displayDetail?: string;
}

const MAX_USER_FACING_PROGRESS_FOCUS_CHARS = 220;

export class AgentDisplayPresenter {
  private currentStage: AgentProgressStage = 'planning';
  private currentTaskAction: AgentStatusEvent['taskAction'];
  private currentTaskFocus = '';
  private readonly activityCounts = new Map<AgentProgressStage, Map<string, number>>();
  private readonly seenActivities = new Set<string>();

  presentStatus(status: AgentStatusEvent): PresentedAgentStatus {
    const displayTitle = formatStatusTitle(status);
    const displayDetail = formatStatusDetail(status.detail);
    if (status.taskAction) this.currentTaskAction = status.taskAction;
    const taskFocus = compactTaskFocus(status.taskDesc || status.title || status.taskFile || '');
    if (taskFocus) this.currentTaskFocus = taskFocus;
    this.currentStage = progressStageForStatus(status, this.currentStage, this.currentTaskAction);
    const progress = this.buildProgressPresentation(this.currentStage, status.state, status);
    return {
      ...status,
      title: displayTitle,
      detail: displayDetail,
      displayTitle,
      ...(displayDetail ? { displayDetail } : {}),
      ...progress,
    };
  }

  presentToolActivity(kind: string, label: string): AgentToolActivityEvent {
    const activityKind = normalizeActivityKind(kind);
    const activityLabel = normalizeActivityLabel(label);
    if (activityKind === 'label') {
      const focus = compactTaskFocus(activityLabel);
      if (focus) this.currentTaskFocus = focus;
    } else {
      this.currentStage = progressStageForActivity(activityKind, this.currentStage);
      const seenKey = `${this.currentStage}:${activityKind}:${activityLabel.toLowerCase()}`;
      if (!this.seenActivities.has(seenKey)) {
        this.seenActivities.add(seenKey);
        const counts = this.countsFor(this.currentStage);
        counts.set(activityKind, (counts.get(activityKind) || 0) + 1);
      }
    }

    const activityTotal = this.countsFor(this.currentStage).get(activityKind) || 0;
    return {
      type: 'agentToolActivity',
      activityKind,
      activityLabel,
      activityTotal,
      ...this.buildProgressPresentation(this.currentStage, 'started'),
    };
  }

  private countsFor(stage: AgentProgressStage): Map<string, number> {
    let counts = this.activityCounts.get(stage);
    if (!counts) {
      counts = new Map<string, number>();
      this.activityCounts.set(stage, counts);
    }
    return counts;
  }

  private buildProgressPresentation(
    stage: AgentProgressStage,
    state: NonNullable<AgentProgressPresentation['progressState']>,
    status?: AgentStatusEvent,
  ): AgentProgressPresentation {
    const counts = this.countsFor(stage);
    const computedTitle = progressTitle(stage, state, this.currentTaskFocus, this.currentTaskAction);
    const computedDetail = progressDetail(stage, state, counts, status, this.currentTaskFocus);
    return {
      progressStage: stage,
      progressTitle: status?.progressTitle || computedTitle,
      progressDetail: status?.progressDetail || computedDetail,
      progressState: state,
    };
  }
}

function progressStageForStatus(
  status: AgentStatusEvent,
  current: AgentProgressStage,
  action: AgentStatusEvent['taskAction'],
): AgentProgressStage {
  if (status.phase === 'plan') return 'planning';
  if (status.phase === 'validate') return 'validation';
  if (status.phase === 'repair' || status.phase === 'error') return 'recovery';
  if (status.phase === 'done') return 'delivery';
  if (status.phase === 'analyzeFile' || status.phase === 'analyzeSummary') return 'context';
  if (status.phase === 'execute') {
    if (action === 'create' || action === 'modify' || action === 'delete') return 'implementation';
    if (action === 'explore' || action === 'analyze' || action === 'explain') return 'context';
  }
  return current;
}

function progressStageForActivity(kind: string, current: AgentProgressStage): AgentProgressStage {
  if (kind === 'read' || kind === 'search' || kind === 'list' || kind === 'web') return 'context';
  if (kind === 'write') return 'implementation';
  if (kind === 'terminal' || kind === 'diagnostics' || kind === 'vscode-command') return 'validation';
  return current;
}

function progressTitle(
  stage: AgentProgressStage,
  state: string,
  focus: string,
  action: AgentStatusEvent['taskAction'],
): string {
  if (state === 'failed') {
    if (stage === 'validation') return '验证发现问题，正在保留失败证据';
    return '当前阶段未通过，正在整理失败原因';
  }
  if (state === 'completed') {
    if (stage === 'planning') return '任务路径已经梳理完成';
    if (stage === 'context') return '项目上下文和关键证据已收集';
    if (stage === 'implementation') return '成果物已经生成或更新';
    if (stage === 'validation') return '实现结果已经验证';
    if (stage === 'delivery') return '任务已经完成并进入交付';
  }
  if (stage === 'planning') return '正在梳理任务、边界和执行路径';
  if (stage === 'context') return focus ? `正在调查：${focus}` : '正在收集项目证据和依赖关系';
  if (stage === 'implementation') return implementationProgressTitle(focus, action);
  if (stage === 'validation') return '正在运行验证并检查交付完整性';
  if (stage === 'recovery') return '正在根据失败证据修复问题';
  return '正在汇总结果和交付证据';
}

function implementationProgressTitle(focus: string, action: AgentStatusEvent['taskAction']): string {
  if (action === 'create') return focus ? `正在创建：${focus}` : '正在创建成果物';
  if (action === 'modify') return focus ? `正在修改：${focus}` : '正在修改成果物';
  if (action === 'delete') return focus ? `正在删除：${focus}` : '正在删除成果物';
  return focus ? `正在实现：${focus}` : '正在生成和更新成果物';
}

function progressDetail(
  stage: AgentProgressStage,
  state: string,
  counts: Map<string, number>,
  status: AgentStatusEvent | undefined,
  focus: string,
): string {
  const completed = formatActivityCounts(counts);
  const parts: string[] = [];
  if (stage === 'planning' && status?.taskTotal) {
    parts.push(`已形成 ${status.taskTotal} 个可执行任务`);
  } else if (completed) {
    parts.push(`已完成：${completed}`);
  } else if (focus && stage !== 'delivery') {
    parts.push(`当前重点：${focus}`);
  }
  if (state === 'failed') {
    const failure = compactFailureDetail(status?.detail || '');
    if (failure) parts.push(`失败证据：${failure}`);
  }
  parts.push(nextStepFor(stage, state));
  return `${parts.join('。')}。`;
}

function formatActivityCounts(counts: Map<string, number>): string {
  const labels: Record<string, string> = {
    read: '读取',
    search: '搜索',
    list: '查看目录',
    web: '查阅网页',
    write: '更新成果物',
    terminal: '执行命令',
    diagnostics: '检查诊断',
    'vscode-command': '运行 VS Code 命令',
    mcp: '调用扩展工具',
  };
  const units: Record<string, string> = {
    read: '个文件',
    search: '次',
    list: '次',
    web: '次',
    write: '个',
    terminal: '次',
    diagnostics: '次',
    'vscode-command': '次',
    mcp: '次',
  };
  return [...counts.entries()]
    .filter(([kind, count]) => count > 0 && Boolean(labels[kind]))
    .map(([kind, count]) => `${labels[kind]} ${count} ${units[kind] || '次'}`)
    .join('，');
}

function nextStepFor(stage: AgentProgressStage, state: string): string {
  if (state === 'failed') return '下一步：依据失败证据修复后重新验证';
  if (stage === 'planning') return '下一步：读取项目事实并核对集成边界';
  if (stage === 'context') return '下一步：整理发现，确定设计和修改范围';
  if (stage === 'implementation') return '下一步：运行编译、测试和交付检查';
  if (stage === 'validation') return '下一步：根据验证结果修复或完成交付';
  if (stage === 'recovery') return '下一步：重放失败路径并确认问题已收敛';
  return '下一步：向用户交付结果、路径和验证结论';
}

function normalizeActivityKind(value: string): string {
  const kind = String(value || '').trim();
  return kind && kind !== 'undefined' && kind !== 'null' ? kind : 'read';
}

function normalizeActivityLabel(value: string): string {
  const label = String(value || '').replace(/\s+/g, ' ').trim();
  return label === 'undefined' || label === 'null' ? '' : label;
}

function compactTaskFocus(value: string): string {
  const normalized = normalizeInlineText(value)
    .replace(/^(?:正在|开始|继续|准备|我(?:将|先|来|会))\s*/, '')
    .replace(/[。；;].*$/, '')
    .trim();
  if (!normalized || looksLikeInternalToolTranscript(normalized) || looksLikeSourceSnippet(normalized)) return '';
  if (/(?:\/home\/|[A-Za-z]:\\)/.test(normalized)) return '';
  if (/^思考中\s*\(/.test(normalized)) return '';
  return normalized.length > MAX_USER_FACING_PROGRESS_FOCUS_CHARS
    ? `${normalized.slice(0, MAX_USER_FACING_PROGRESS_FOCUS_CHARS - 1)}…`
    : normalized;
}

function compactFailureDetail(value: string): string {
  const normalized = normalizeInlineText(value);
  if (!normalized || looksLikeInternalToolTranscript(normalized)) return '';
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized;
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
  return /(?:<TOOL_STREAM>|<\/TOOL_STREAM>|<TOOL\b|<\/TOOL>|\[TOOL:|(?:^|\s)(?:run_terminal|create_file|write_file|replace_in_file|apply_patch|read_file|list_dir|grep_search)\s*\(\s*\{)/i.test(value);
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
