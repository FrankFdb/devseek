import * as nodePath from 'path';
import {
  coalesceWrittenFileEvidence,
  findBlockingTerminalFailureEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import {
  buildTerminalFailureDiagnosis,
  type FailureDiagnosis,
} from '../app/failure-diagnosis';

export type AgenticHistoryTodoStatus = 'not-started' | 'in-progress' | 'completed' | 'failed';

export interface AgenticHistoryTodo {
  id?: number;
  title: string;
  status: AgenticHistoryTodoStatus;
}

export interface AgenticHistoryQualityGate {
  status: 'pass' | 'fail' | 'blocked';
  summary: string;
  risks?: string[];
  evidenceRefs?: string[];
  failureDiagnosis?: FailureDiagnosis;
  alternativeChecks?: string[];
  requiredActions?: string[];
}

export interface AgenticHistoryInput {
  label?: string;
  countLabel?: string;
  userPrompt: string;
  roundCount: number;
  completed: boolean;
  failedReason?: string;
  summary?: string;
  todos?: AgenticHistoryTodo[];
  writtenFiles?: WrittenFileEvidence[];
  terminalEvidence?: TerminalEvidence[];
  qualityGate?: AgenticHistoryQualityGate;
  workspaceRoot?: string;
}

const MAX_PROMPT_CHARS = 600;
const MAX_SUMMARY_CHARS = 900;
const MAX_COMMAND_CHARS = 220;

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value: string, maxChars: number): string {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 3)).trimEnd() + '...';
}

function workspaceRelativePath(filePath: string, workspaceRoot?: string): string {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  if (!nodePath.isAbsolute(normalizedPath) && !/^[A-Za-z]:\//.test(normalizedPath)) {
    return normalizedPath;
  }
  if (!workspaceRoot) return normalizedPath;
  const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
  try {
    const rel = nodePath.relative(normalizedRoot, normalizedPath).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel)) return rel;
  } catch {
    // Fall back to the original path below.
  }
  return normalizedPath;
}

function statusLabel(status: AgenticHistoryTodoStatus): string {
  switch (status) {
    case 'completed': return 'completed';
    case 'in-progress': return 'in progress';
    case 'failed': return 'failed';
    default: return 'not started';
  }
}

function renderTodoList(todos: AgenticHistoryTodo[]): string {
  const items = todos
    .filter(todo => todo.title.trim())
    .slice(0, 12)
    .map(todo => `<li><code>${escapeHtml(statusLabel(todo.status))}</code> ${escapeHtml(todo.title.trim())}</li>`)
    .join('');
  return items ? `<p><strong>任务清单：</strong></p><ul>${items}</ul>` : '';
}

function renderWrittenFiles(files: WrittenFileEvidence[], workspaceRoot?: string): string {
  const items = coalesceWrittenFileEvidence(files, workspaceRoot)
    .slice(0, 20)
    .map((file) => {
      const relPath = workspaceRelativePath(file.path, workspaceRoot);
      const stat = `+${file.linesAdded || 0} -${file.linesRemoved || 0}`;
      const action = file.action ? `${file.action} ` : '';
      return `<li><code>${escapeHtml(relPath)}</code> <span>(${escapeHtml(action + stat)})</span></li>`;
    })
    .join('');
  return items ? `<p><strong>修改文件：</strong></p><ul>${items}</ul>` : '';
}

function renderTerminalEvidence(evidence: TerminalEvidence[]): string {
  const items = evidence
    .slice(-12)
    .map(item => {
      const state = item.reviewRequired ? 'review' : item.ok ? 'ok' : 'failed';
      const kind = item.kind || 'other';
      const code = item.exitCode === null || item.exitCode === undefined ? '' : `, code ${item.exitCode}`;
      const command = truncate(item.command || '', MAX_COMMAND_CHARS);
      const detail = item.detail ? ` <span>${escapeHtml(truncate(item.detail, 180))}</span>` : '';
      return `<li><code>${escapeHtml(state)}</code> ${escapeHtml(kind)}${escapeHtml(code)}: <code>${escapeHtml(command)}</code>${detail}</li>`;
    })
    .join('');
  return items ? `<p><strong>验证/终端证据：</strong></p><ul>${items}</ul>` : '';
}

function renderQualityGate(qualityGate?: AgenticHistoryQualityGate): string {
  if (!qualityGate) return '';
  const statusLabel = qualityGate.status === 'pass'
    ? 'pass'
    : qualityGate.status === 'fail'
      ? 'fail'
      : 'blocked';
  const risks = (qualityGate.risks || [])
    .slice(0, 4)
    .map(risk => `<li>${escapeHtml(truncate(risk, 220))}</li>`)
    .join('');
  const evidence = (qualityGate.evidenceRefs || [])
    .slice(0, 4)
    .map(ref => `<li><code>${escapeHtml(truncate(ref, 220))}</code></li>`)
    .join('');
  const diagnosis = qualityGate.failureDiagnosis
    ? `<p><strong>失败诊断：</strong> <code>${escapeHtml(qualityGate.failureDiagnosis.kind)}</code> ${escapeHtml(truncate(qualityGate.failureDiagnosis.summary, 320))}</p>`
    : '';
  const alternatives = (qualityGate.alternativeChecks || [])
    .slice(0, 4)
    .map(check => `<li>${escapeHtml(truncate(check, 220))}</li>`)
    .join('');
  const actions = (qualityGate.requiredActions || [])
    .slice(0, 4)
    .map(action => `<li>${escapeHtml(truncate(action, 220))}</li>`)
    .join('');
  return [
    `<p><strong>QualityGate：</strong> <code>${escapeHtml(statusLabel)}</code> ${escapeHtml(truncate(qualityGate.summary, 320))}</p>`,
    diagnosis,
    risks ? `<p><strong>风险：</strong></p><ul>${risks}</ul>` : '',
    evidence ? `<p><strong>证据引用：</strong></p><ul>${evidence}</ul>` : '',
    alternatives ? `<p><strong>替代检查：</strong></p><ul>${alternatives}</ul>` : '',
    actions ? `<p><strong>待处理事项：</strong></p><ul>${actions}</ul>` : '',
  ].filter(Boolean).join('\n');
}

export function buildAgenticQualityGateForHistory(input: {
  failedReason?: string;
  writtenFiles: WrittenFileEvidence[];
  terminalEvidence: TerminalEvidence[];
}): AgenticHistoryQualityGate | undefined {
  const reviewTerminal = [...input.terminalEvidence].reverse().find(e => e.reviewRequired);
  if (reviewTerminal) {
    return {
      status: 'blocked',
      summary: reviewTerminal.detail || 'QualityGate 阻塞：运行结果需要人工确认。',
      risks: ['图形、界面或交互式输出无法仅凭退出码自动证明正确。'],
      evidenceRefs: [terminalEvidenceRef(reviewTerminal)],
      alternativeChecks: ['人工确认窗口、画面或交互输出是否符合用户请求。'],
      requiredActions: ['确认效果后手动保留文件改动；如效果不符，继续发起修正。'],
    };
  }

  const failedTerminal = findBlockingTerminalFailureEvidence(input.terminalEvidence);
  if (failedTerminal) {
    const evidenceRef = terminalEvidenceRef(failedTerminal);
    return {
      status: 'fail',
      summary: `QualityGate 未通过：${failedTerminal.kind || 'terminal'} 验证失败。`,
      risks: ['自动验证命令失败，不能把任务标记为完全完成。'],
      evidenceRefs: [evidenceRef],
      failureDiagnosis: buildTerminalFailureDiagnosis({
        evidenceRef,
        command: failedTerminal.command,
        exitCode: failedTerminal.exitCode,
        detail: failedTerminal.detail,
        kind: failedTerminal.kind,
        changedPaths: input.writtenFiles.map(file => file.path || file.basename).filter(Boolean),
      }),
      requiredActions: ['修复自动验证失败后重新运行 QualityGate。'],
    };
  }

  if (input.failedReason) {
    return {
      status: 'blocked',
      summary: `QualityGate 阻塞：${input.failedReason}`,
      risks: ['任务缺少足够的完成证据，需要补充验证或人工确认。'],
      alternativeChecks: ['人工检查变更内容是否符合用户请求。'],
      requiredActions: ['补充可运行验证，或由用户明确接受剩余风险。'],
    };
  }

  const successfulTerminal = [...input.terminalEvidence].reverse().find(e => e.ok);
  if (successfulTerminal) {
    return {
      status: 'pass',
      summary: `QualityGate 通过：${successfulTerminal.kind || 'terminal'} 证据已通过。`,
      evidenceRefs: [terminalEvidenceRef(successfulTerminal)],
    };
  }

  if (input.writtenFiles.length > 0) {
    return {
      status: 'blocked',
      summary: 'QualityGate 阻塞：文件已修改，但没有自动验证证据。',
      risks: ['缺少编译、测试或文件检查证据，不能证明变更后的行为正确。'],
      alternativeChecks: ['人工检查变更内容是否符合用户请求。'],
      requiredActions: ['补充可运行验证，或由用户明确接受剩余风险。'],
    };
  }

  return undefined;
}

function terminalEvidenceRef(evidence: TerminalEvidence): string {
  const code = evidence.exitCode === null || evidence.exitCode === undefined ? 'null' : String(evidence.exitCode);
  return `terminal:${evidence.ok ? 'ok' : 'failed'}:${evidence.kind}:exitCode=${code}:${evidence.command}`;
}

function synthesizeAgenticHistorySummary(input: AgenticHistoryInput, writtenFiles: WrittenFileEvidence[]): string {
  const parts: string[] = [];
  const todos = input.todos || [];
  if (todos.length > 0) {
    const completed = todos.filter(todo => todo.status === 'completed').length;
    parts.push(`已完成 ${completed}/${todos.length} 个任务`);
  }
  if (writtenFiles.length > 0) {
    const verb = dominantFileActionVerb(writtenFiles);
    const preview = writtenFiles
      .slice(0, 4)
      .map(file => nodePath.basename(file.path || file.basename || '文件'))
      .filter(Boolean)
      .join('、');
    const suffix = writtenFiles.length > 4 ? ' 等' : '';
    parts.push(`${verb} ${writtenFiles.length} 个文件${preview ? `：${preview}${suffix}` : ''}`);
  }
  if (input.qualityGate?.summary) {
    parts.push(input.qualityGate.summary.replace(/[。.]$/, ''));
  } else {
    const successfulTerminal = [...(input.terminalEvidence || [])].reverse().find(evidence => evidence.ok);
    if (successfulTerminal) parts.push(`${successfulTerminal.kind || 'terminal'} 验证已通过`);
  }
  return parts.length > 0 ? `${parts.join('；')}。` : '';
}

function dominantFileActionVerb(files: WrittenFileEvidence[]): string {
  const actions = new Set(files.map(file => String(file.action || '').toLowerCase()));
  if (actions.size === 1 && actions.has('create')) return '创建';
  if (actions.size === 1 && actions.has('delete')) return '删除';
  if (actions.has('modify') || actions.has('update') || actions.has('patch')) return '修改';
  return '处理';
}

export function buildAgenticHistoryText(input: AgenticHistoryInput): string {
  const rounds = Math.max(0, Number(input.roundCount) || 0);
  const label = truncate(input.label || 'Agentic', 32);
  const countLabel = truncate(input.countLabel || `${rounds} 轮`, 80);
  const status = input.completed ? '已完成' : '未完成';
  const writtenFiles = coalesceWrittenFileEvidence(input.writtenFiles || [], input.workspaceRoot);
  const summary = truncate(
    input.failedReason || input.summary || synthesizeAgenticHistorySummary(input, writtenFiles),
    MAX_SUMMARY_CHARS,
  );
  const prompt = truncate(input.userPrompt || '', MAX_PROMPT_CHARS);
  const todos = renderTodoList(input.todos || []);
  const files = renderWrittenFiles(writtenFiles, input.workspaceRoot);
  const terminal = renderTerminalEvidence(input.terminalEvidence || []);
  const qualityGate = renderQualityGate(input.qualityGate);

  const visibleLines = [
    `**[${label}] ${status}（${countLabel}）**`,
    summary ? `\n**结果摘要：**\n${summary}` : '',
  ].filter(Boolean);

  const detailsBody = [
    prompt ? `<p><strong>用户请求：</strong></p><pre>${escapeHtml(prompt)}</pre>` : '',
    todos,
    files,
    terminal,
    qualityGate,
  ].filter(Boolean).join('\n');

  if (!detailsBody) return visibleLines.join('\n');

  return [
    ...visibleLines,
    '',
    '<details class="agent-history-details">',
    '<summary>任务清单与执行证据</summary>',
    detailsBody,
    '</details>',
  ].join('\n');
}
