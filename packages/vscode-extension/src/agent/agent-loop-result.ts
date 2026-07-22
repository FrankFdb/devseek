import * as nodePath from 'path';
import type { AgentTask } from '../agent-task-decomposer';
import {
  buildAgenticHistoryText,
  buildAgenticQualityGateForHistory,
  type AgenticHistoryQualityGate,
  type AgenticHistoryTodoStatus,
} from './agentic-history';
import {
  coalesceWrittenFileEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import {
  selectArtifactGroundingResultFields,
  type ArtifactGroundingResultFields,
} from './artifact-grounding-lifecycle';
import type { AgentLoopResult } from './loop-types';

export interface AgentLoopResultInput extends ArtifactGroundingResultFields {
  tasks: AgentTask[];
  tasksApplied: number;
  tasksFailed: number;
  changedPaths: string[];
  userPrompt: string;
  todos: Array<{ id: number | string; title: string; status: string }>;
  editedFileRecords: WrittenFileEvidence[];
  terminalEvidence: TerminalEvidence[];
  workspaceRoot: string;
  failedReason?: string;
  summary?: string;
  manualReviewReason?: string;
  analysisTexts?: string[];
  verificationIds?: string[];
}

export function buildAgentLoopResult(input: AgentLoopResultInput): AgentLoopResult {
  const historyWrittenFiles = coalesceEditedFileRecordsForHistory(input.editedFileRecords, input.workspaceRoot);
  const historyQualityGate: AgenticHistoryQualityGate | undefined = input.manualReviewReason
    ? buildManualReviewQualityGate(input.manualReviewReason, input.terminalEvidence)
    : buildAgenticQualityGateForHistory({
      failedReason: input.failedReason,
      writtenFiles: historyWrittenFiles,
      terminalEvidence: input.terminalEvidence,
    });
  const historyText = buildAgenticHistoryText({
    label: 'Agent',
    countLabel: `${input.tasksApplied}/${input.tasks.length} 个任务`,
    userPrompt: input.userPrompt,
    roundCount: input.tasks.length,
    completed: input.tasksFailed === 0,
    failedReason: input.failedReason,
    summary: input.summary,
    todos: input.todos.map(todo => ({
      id: typeof todo.id === 'number' ? todo.id : undefined,
      title: todo.title,
      status: normalizeHistoryTodoStatus(todo.status),
    })),
    writtenFiles: historyWrittenFiles,
    terminalEvidence: input.terminalEvidence,
    qualityGate: historyQualityGate,
    workspaceRoot: input.workspaceRoot,
  });

  return {
    tasksTotal: input.tasks.length,
    tasksApplied: input.tasksApplied,
    tasksFailed: input.tasksFailed,
    changedPaths: input.changedPaths,
    ...(input.manualReviewReason ? {
      manualReviewRequired: true,
      manualReviewReason: input.manualReviewReason,
    } : {}),
    ...(input.analysisTexts?.length ? { analysisText: input.analysisTexts.join('\n\n') } : {}),
    ...(input.verificationIds?.length ? { verificationIds: input.verificationIds } : {}),
    ...selectArtifactGroundingResultFields(input),
    historyText,
  };
}

function buildManualReviewQualityGate(
  reason: string,
  terminalEvidence: TerminalEvidence[],
): AgenticHistoryQualityGate {
  const latest = terminalEvidence[terminalEvidence.length - 1];
  const qualityGate: AgenticHistoryQualityGate = {
    status: 'blocked',
    summary: `QualityGate 阻塞：${reason}`,
    risks: ['图形或交互式运行结果无法由退出码自动证明，不能自动接受文件改动。'],
    alternativeChecks: ['人工确认图形窗口、界面或交互输出是否符合用户请求。'],
    requiredActions: ['确认效果后手动保留文件改动；如效果不符，继续发起修正。'],
  };
  if (latest) {
    const code = latest.exitCode === null || latest.exitCode === undefined ? 'null' : String(latest.exitCode);
    qualityGate.evidenceRefs = [`terminal:review:${latest.kind}:exitCode=${code}:${latest.command}`];
  }
  return qualityGate;
}

function coalesceEditedFileRecordsForHistory(
  records: WrittenFileEvidence[],
  workspaceRoot: string,
): WrittenFileEvidence[] {
  const absoluteRecords = records.map(record => ({
    ...record,
    path: nodePath.isAbsolute(record.path)
      ? record.path
      : nodePath.join(workspaceRoot, record.path),
  }));
  return coalesceWrittenFileEvidence(absoluteRecords, workspaceRoot);
}

function normalizeHistoryTodoStatus(status: string): AgenticHistoryTodoStatus {
  return status === 'completed' || status === 'failed' || status === 'in-progress'
    ? status
    : 'not-started';
}
