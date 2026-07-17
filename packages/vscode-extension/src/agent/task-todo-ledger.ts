import { createHash } from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';
import type { AgentTask, AgentTaskAction } from '../agent-task-decomposer';
import { isCanonicalPathInsideRoot } from '../workspace/path-containment';
import type { AgentStatusEvent } from './events';
import {
  coalesceWrittenFileEvidence,
  findBlockingTerminalFailureEvidence,
  getMissingCompletionEvidence,
  getUnsupportedSummaryFileClaims,
  hasReadOnlyAnswerEvidence,
  requiresCodeArtifactForEvidence,
  requiresCommandEvidence,
  requiresFileCheckEvidence,
  requiresFileChangeEvidence,
  requiresReadEvidence,
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import {
  runtimeStateCanDeliver,
  settleAgentRuntimeState,
} from './agent-runtime-state-machine';
import { stripToolCallBlocks } from './fake-tool-parser';
import { extractTaskFileTokens, normalizeEvidencePath, taskFileTokensMatchWrittenEvidence } from './task-file-tokens';
import { buildTaskTerminalFailureDetail } from './task-execution-result';
import { classifyAgentTaskShape } from './task-shape';
import { buildTaskContract, hasSourceClaimArtifactContract, resolveTaskContractSourcePaths } from './task-contract';
import {
  deriveArtifactClaimSpecs,
  verifyArtifactClaims,
  type ArtifactClaim,
  type EvidenceRef,
  type VerificationResult,
} from './evidence-grounding';

type TodoStatus = TodoItem['status'];
type LinearTodoInput = Pick<TodoItem, 'title'> & Partial<Pick<TodoItem, 'status' | '__agentState'>>;
type TaskFailureKind = 'terminal' | 'missing-evidence' | 'missing-write' | 'validation' | 'execution-error' | 'artifact-grounding';

const TODO_TITLE_MAX = 36;

interface TaskEvidence {
  action: AgentTaskAction;
  applied?: boolean;
  path?: string;
  writtenFiles?: WrittenFileEvidence[];
  raw?: string;
  taskComplete?: boolean;
  failedReason?: string;
  terminalEvidence?: TerminalEvidence[];
  workspaceRoot?: string;
  promptText?: string;
  evidenceRefs?: EvidenceRef[];
  artifactClaims?: ArtifactClaim[];
  verificationResults?: VerificationResult[];
}

interface FinalTaskEvidence {
  validationFailed?: boolean;
  writtenFiles?: WrittenFileEvidence[];
  terminalEvidence?: TerminalEvidence[];
  workspaceRoot?: string;
}

export interface TaskSettleResult {
  completed: boolean;
  failed: boolean;
  failedReason?: string;
  todos: TodoItem[];
}

export interface TaskReconcileResult {
  clearedFailures: number;
  todos: TodoItem[];
}

export interface AgentTaskTodoLedger {
  snapshot(): TodoItem[];
  firstUnfinishedTaskIndex(): number | undefined;
  startTask(index: number): TodoItem[];
  settleTask(index: number, evidence: TaskEvidence): TaskSettleResult;
  reconcileFinalEvidence(evidence: FinalTaskEvidence): TaskReconcileResult;
  repairSnapshot(title: string, id: number): TodoItem[];
  markValidationFailure(): TodoItem[];
}

export function buildTaskSettlementFailureStatus(
  task: AgentTask,
  taskIndex: number,
  taskTotal: number,
  result: { applied?: boolean; raw?: string; failedReason?: string; terminalEvidence?: TerminalEvidence[]; writtenFiles?: WrittenFileEvidence[]; workspaceRoot?: string; taskComplete?: boolean },
): AgentStatusEvent {
  const target = getTaskDisplayTarget(task);
  return {
    type: 'agentStatus',
    phase: 'execute',
    taskId: task.id,
    taskFile: target,
    taskAction: task.action,
    taskDesc: task.desc,
    taskIndex,
    taskTotal,
    state: 'failed',
    title: summarizeAgentTodoTitle(task.desc || target, target),
    detail: buildTaskSettlementFailureDetail(task, result),
  };
}

export function buildTaskSettlementCompletionStatus(
  task: AgentTask,
  taskIndex: number,
  taskTotal: number,
  result: { writtenFiles?: WrittenFileEvidence[]; workspaceRoot?: string },
): AgentStatusEvent {
  const target = getTaskDisplayTarget(task);
  const writtenFiles = coalesceWrittenFileEvidence(result.writtenFiles ?? [], result.workspaceRoot);
  const changedBasenames = writtenFiles
    .map(file => nodePath.basename(file.path || file.basename))
    .filter(Boolean);
  const linesAdded = sumOptional(writtenFiles.map(file => file.linesAdded));
  const linesRemoved = sumOptional(writtenFiles.map(file => file.linesRemoved));
  return {
    type: 'agentStatus',
    phase: 'execute',
    taskId: task.id,
    taskFile: target,
    taskAction: task.action,
    taskDesc: task.desc,
    taskIndex,
    taskTotal,
    state: 'completed',
    title: summarizeAgentTodoTitle(task.desc || target, target),
    ...(changedBasenames.length > 0
      ? { detail: `${changedBasenames.join('、')} · 已通过任务结算` }
      : {}),
    ...(linesAdded !== undefined ? { linesAdded } : {}),
    ...(linesRemoved !== undefined ? { linesRemoved } : {}),
  };
}

export function createAgentTaskTodoLedger(
  tasks: AgentTask[],
  startFromIndex = 0,
): AgentTaskTodoLedger {
  const statuses: TodoStatus[] = tasks.map((_, index) => (
    index < startFromIndex ? 'completed' : 'not-started'
  ));
  const failureKinds: Array<TaskFailureKind | undefined> = tasks.map(() => undefined);
  let validationFailureTodo: TodoItem | undefined;

  const snapshot = (): TodoItem[] => {
    const items = tasks.map((task, index) => taskTodoItem(task, index, statuses[index] ?? 'not-started'));
    return validationFailureTodo ? [...items, validationFailureTodo] : items;
  };

  return {
    snapshot,
    firstUnfinishedTaskIndex(): number | undefined {
      const index = statuses.findIndex(status => status !== 'completed');
      return index >= 0 ? index : undefined;
    },
    startTask(index: number): TodoItem[] {
      if (isTaskIndex(index, tasks) && !isTerminalStatus(statuses[index])) {
        statuses[index] = 'in-progress';
      }
      return snapshot();
    },
    settleTask(index: number, evidence: TaskEvidence): TaskSettleResult {
      const terminalFailure = findBlockingTerminalFailureEvidence(evidence.terminalEvidence);
      const groundingFailure = isTaskIndex(index, tasks)
        ? getArtifactGroundingFailure(tasks[index], evidence)
        : undefined;
      const missingEvidence = isTaskIndex(index, tasks)
        ? getTaskMissingCompletionEvidence(tasks[index], evidence)
        : [];
      const completed = !evidence.failedReason
        && !terminalFailure
        && !groundingFailure
        && missingEvidence.length === 0
        && taskRuntimeCanDeliver(evidence);
      const failureKind: TaskFailureKind | undefined = groundingFailure
        ? 'artifact-grounding'
        : evidence.failedReason
        ? 'execution-error'
        : terminalFailure
          ? 'terminal'
          : missingEvidence.length > 0
            ? 'missing-evidence'
            : !completed
              ? isReadOnlyAgentTaskAction(evidence.action) ? 'missing-evidence' : 'missing-write'
              : undefined;
      const failed = Boolean(failureKind);
      if (isTaskIndex(index, tasks)) {
        statuses[index] = failed ? 'failed' : completed ? 'completed' : 'in-progress';
        failureKinds[index] = failed ? failureKind : undefined;
      }
      return {
        completed,
        failed,
        failedReason: groundingFailure || evidence.failedReason,
        todos: snapshot(),
      };
    },
    reconcileFinalEvidence(evidence: FinalTaskEvidence): TaskReconcileResult {
      if (evidence.validationFailed) {
        return { clearedFailures: 0, todos: snapshot() };
      }

      const writtenFiles = coalesceWrittenFileEvidence(evidence.writtenFiles ?? [], evidence.workspaceRoot);
      const hasFinalSuccess = hasSuccessfulFinalTerminalEvidence(evidence.terminalEvidence);
      let clearedFailures = 0;
      for (let index = 0; index < tasks.length; index += 1) {
        if (statuses[index] !== 'failed' || !isRecoverableFailureKind(failureKinds[index])) continue;
        if (
          isConditionalFailureRecoveryTask(tasks[index])
            ? !hasFinalSuccess
            : !hasFinalTaskCompletionEvidence(tasks[index], evidence, writtenFiles)
        ) {
          continue;
        }

        statuses[index] = 'completed';
        failureKinds[index] = undefined;
        clearedFailures += 1;
      }
      return { clearedFailures, todos: snapshot() };
    },
    repairSnapshot(title: string, id: number): TodoItem[] {
      return [
        ...snapshot(),
        {
          id,
          title: summarizeAgentTodoTitle(title),
          status: 'in-progress',
          __agentState: true,
        },
      ];
    },
    markValidationFailure(): TodoItem[] {
      const validationIndex = findValidationTaskIndex(tasks);
      if (validationIndex >= 0) {
        statuses[validationIndex] = 'failed';
        failureKinds[validationIndex] = 'validation';
        validationFailureTodo = undefined;
      } else {
        validationFailureTodo = {
          id: tasks.length + 1,
          title: '运行自动验证 / QualityGate',
          status: 'failed',
          __agentState: true,
        };
      }
      return snapshot();
    },
  };
}

export function settleValidationFailureTodos(todos: TodoItem[]): TodoItem[] {
  if (!todos.length) return todos;
  let matched = false;
  const updated = todos.map(item => {
    const title = item.title.toLowerCase();
    if (!isAutomaticValidationTodoTitle(title)) {
      return item;
    }
    matched = true;
    return { ...item, status: 'failed' as const };
  });
  if (matched) return updated;

  if (updated.some(item => isFileFactVerificationTodoTitle(item.title))) {
    return [
      ...updated,
      {
        id: nextTodoId(updated),
        title: '运行自动验证 / QualityGate',
        status: 'failed' as const,
      },
    ];
  }

  const lastCompletedIndex = updated
    .map((item, index) => ({ item, index }))
    .reverse()
    .find(({ item }) => item.status === 'completed')?.index;
  if (lastCompletedIndex === undefined) return updated;
  return updated.map((item, index) => (
    index === lastCompletedIndex ? { ...item, status: 'failed' as const } : item
  ));
}

export function createLinearAgentTodos(items: LinearTodoInput[]): TodoItem[] {
  return items.map((item, index) => ({
    id: index + 1,
    title: summarizeAgentTodoTitle(item.title),
    status: item.status ?? (index === 0 ? 'in-progress' : 'not-started'),
    ...(item.__agentState ? { __agentState: true } : {}),
  }));
}

export function completeAgentTodos(todos: TodoItem[]): TodoItem[] {
  return todos.map(item => ({ ...item, status: 'completed' as const, __agentState: true }));
}

export function advanceLinearAgentTodo(
  todos: TodoItem[],
  completedIndex: number,
  nextIndex?: number,
): TodoItem[] {
  return todos.map((item, index) => {
    if (index === completedIndex) return { ...item, status: 'completed' as const };
    if (nextIndex !== undefined && index === nextIndex && item.status !== 'completed' && item.status !== 'failed') {
      return { ...item, status: 'in-progress' as const };
    }
    return item;
  });
}

export function failLinearAgentTodo(todos: TodoItem[], failedIndex: number): TodoItem[] {
  return todos.map((todo, todoIndex) => (
    todoIndex === failedIndex
      ? { ...todo, status: 'failed' as const }
      : todo.status === 'in-progress'
        ? { ...todo, status: 'not-started' as const }
        : todo
  ));
}

export function settleMissingEvidenceTodos(todos: TodoItem[], missing: string[]): TodoItem[] {
  if (!todos.length || !missing.length) return todos;
  const needsCode = missing.some(m => m.includes('代码') || m.includes('程序'));
  const needsCommand = missing.some(m => m.includes('编译') || m.includes('运行') || m.includes('测试') || m.includes('成功'));
  const needsRead = missing.some(m => m.includes('读取') || m.includes('检查'));
  let firstMissing = true;
  return todos.map(item => {
    const title = item.title.toLowerCase();
    const matchesCode = needsCode && /(?:代码|源码|程序|脚本|实现|动画|开发)/i.test(title);
    const matchesCommand = needsCommand && /(?:编译|运行|执行|测试|验证|调试|compile|build|test|run)/i.test(title);
    const matchesRead = needsRead && /(?:读取|检查|查看|显示|确认|验证|校验|read|inspect|check|show|verify|validate)/i.test(title);
    if (!matchesCode && !matchesCommand && !matchesRead) return item;
    const status = firstMissing ? 'in-progress' as const : 'not-started' as const;
    firstMissing = false;
    return { ...item, status };
  });
}

export function appendQualityGateTodo(todos: TodoItem[], status: Extract<TodoStatus, 'completed' | 'failed'>): TodoItem[] {
  return [
    ...todos,
    {
      id: nextTodoId(todos),
      title: '运行自动验证 / QualityGate',
      status,
    },
  ];
}

export function inferInitialAgenticTodos(userPrompt: string): TodoItem[] {
  const taskShape = classifyAgentTaskShape(userPrompt);
  if (taskShape.shape === 'existing-project' && !taskShape.readOnlyLikely) {
    const needsCode = requiresCodeArtifactForEvidence(userPrompt);
    const needsCommand = requiresCommandEvidence(userPrompt)
      || /(?:自闭环|测试|验证|编译|运行|代码实现|实现代码|程序|compile|build|test|run|verify)/i.test(userPrompt);
    const items: LinearTodoInput[] = [
      { title: '项目调查：事实矩阵、通讯链路和集成锚点', status: 'in-progress' },
      { title: '设计交付：接口文档、原代码修改清单和实现边界', status: 'not-started' },
    ];
    if (needsCode) {
      items.push({ title: '实现：创建/更新代码文件并嵌入既有边界', status: 'not-started' });
    }
    if (needsCommand || needsCode) {
      items.push({ title: '验证：编译/测试/静态审计与 QualityGate 自闭环', status: 'not-started' });
    }
    return createLinearAgentTodos(items);
  }

  const items: LinearTodoInput[] = [];
  const needsRead = requiresReadEvidence(userPrompt);
  const needsFile = requiresFileChangeEvidence(userPrompt);
  const needsCode = requiresCodeArtifactForEvidence(userPrompt);
  const needsFileCheck = requiresFileCheckEvidence(userPrompt);
  const needsCommand = !needsFileCheck && (requiresCommandEvidence(userPrompt) || /(?:程序|代码|动画|运行效果|效果)/i.test(userPrompt));
  if (needsRead) {
    items.push({ title: '检查/读取目标文件', status: 'in-progress' });
  }
  if (needsFile) {
    items.push({ title: needsCode ? '创建/更新代码文件' : '创建/更新文件', status: 'in-progress' });
  }
  if (needsCommand) {
    items.push({ title: '编译/运行并验证结果', status: needsCode ? 'not-started' : 'in-progress' });
  }
  if (needsFileCheck) {
    items.push({ title: '验证文件创建成功（文件存在、内容正确、大小正常）', status: needsFile ? 'not-started' : 'in-progress' });
  }
  if (!items.length && /(?:查找|定位|分析|确认|排查|检查)/i.test(userPrompt)) {
    items.push({ title: '分析并定位问题', status: 'in-progress' });
  }
  return createLinearAgentTodos(items);
}

function getTaskMissingCompletionEvidence(task: AgentTask, evidence: TaskEvidence): string[] {
  if (!isReadOnlyAgentTaskAction(evidence.action)) return [];
  if (evidence.action === 'respond') return [];
  const missing = getMissingCompletionEvidence(
    task.desc || task.file || '',
    [{ title: task.desc || task.file || '' }],
    evidence.writtenFiles ?? [],
    evidence.terminalEvidence ?? [],
  );
  if (!hasReadOnlyAnswerOrTerminalEvidence(evidence)) {
    missing.push('分析结论');
  }
  if (evidence.taskComplete || isCompletionLikeProviderText(evidence.raw)) {
    const unsupportedFileClaims = getUnsupportedSummaryFileClaims(
      evidence.raw ?? '',
      evidence.writtenFiles ?? [],
      evidence.workspaceRoot,
    );
    if (unsupportedFileClaims.length > 0) {
      missing.push(`文件写盘证据（${unsupportedFileClaims.join('、')}）`);
    }
  }
  return [...new Set(missing)];
}

function isCompletionLikeProviderText(text: string | undefined): boolean {
  return /(?:已完成|完成了|已生成|已创建|已输出|已写入|saved|created|generated|wrote|completed)/i.test(String(text || ''));
}

export function isReadOnlyAgentTaskAction(action: AgentTaskAction): boolean {
  return action === 'analyze' || action === 'explain' || action === 'explore' || action === 'respond';
}

function hasReadOnlyAnswerOrTerminalEvidence(evidence: TaskEvidence): boolean {
  return Boolean(
    hasReadOnlyAnswerEvidence(evidence.raw)
    || hasSuccessfulTerminalCompletionEvidence(evidence.terminalEvidence),
  );
}

function hasSuccessfulTerminalCompletionEvidence(evidence: TerminalEvidence[] | undefined): boolean {
  return Boolean(evidence?.some(item =>
    item.ok && (item.kind === 'run' || item.kind === 'test' || item.kind === 'compile-run'),
  ));
}

function isRecoverableFailureKind(kind: TaskFailureKind | undefined): boolean {
  return kind === 'missing-evidence' || kind === 'missing-write' || kind === 'terminal';
}

function getArtifactGroundingFailure(task: AgentTask, evidence: TaskEvidence): string | undefined {
  const semanticPrompt = [...new Set([task.desc, evidence.promptText].filter(Boolean))].join('\n');
  const contract = resolveTaskContractSourcePaths(buildTaskContract(semanticPrompt), (evidence.evidenceRefs || []).flatMap(ref => (
    ref.sourcePath && ref.kind !== 'artifact-readback' ? [ref.sourcePath] : []
  )), evidence.workspaceRoot);
  const requirements = contract.evidenceRequirements;
  const writesMarkdownArtifact = [task.file, task.absPath, evidence.path]
    .some(pathValue => /\.(?:md|markdown)$/i.test(String(pathValue || '')));
  const hasGroundedArtifactContract = (task.action === 'create' || task.action === 'modify')
    && (hasSourceClaimArtifactContract(contract)
      || (requirements.length > 0 && writesMarkdownArtifact));
  if (!hasGroundedArtifactContract) return undefined;
  if (requirements.length === 0) {
    return 'artifact-grounding: 源码事实报告契约未解析出明确 claim symbol';
  }
  const expectedSymbols = new Set(requirements.map(requirement => requirement.symbol));
  const latest = evidence.verificationResults?.at(-1);
  if (!latest) return `artifact-grounding: 缺少 ${requirements.length} 项源码事实的写后 VerificationResult`;
  const claimSymbols = latest.claims.map(claim => claim.symbol);
  const uniqueClaimSymbols = new Set(claimSymbols);
  const hasExactCoverage = latest.claims.length === requirements.length
    && uniqueClaimSymbols.size === requirements.length
    && [...expectedSymbols].every(symbol => uniqueClaimSymbols.has(symbol));
  if (!hasExactCoverage) {
    return `artifact-grounding: VerificationResult 覆盖 ${uniqueClaimSymbols.size}/${requirements.length} 项请求事实`;
  }
  if (!latest.ok || latest.claims.some(claim => claim.status !== 'verified')) {
    return `artifact-grounding: ${latest.differences.join('; ') || '存在未通过的源码事实 claim'}`;
  }
  const workspaceBindingFailure = getVerificationEvidenceWorkspaceBindingFailure(
    latest,
    evidence.evidenceRefs || [],
    evidence.workspaceRoot,
  );
  if (workspaceBindingFailure) return `artifact-grounding: ${workspaceBindingFailure}`;
  if (contract.deliverableTargets.length > 1) {
    return `artifact-grounding: 存在 ${contract.deliverableTargets.length} 个交付目标，无法唯一绑定 VerificationResult`;
  }
  const structuredTarget = resolveStructuredArtifactTarget(task, evidence.workspaceRoot);
  if (structuredTarget.error) {
    return `artifact-grounding: ${structuredTarget.error}`;
  }
  if (!structuredTarget.target) {
    return 'artifact-grounding: source-claim 写任务缺少唯一的结构化交付目标';
  }
  const absoluteStructuredTarget = nodePath.isAbsolute(structuredTarget.target)
    ? structuredTarget.target
    : nodePath.resolve(evidence.workspaceRoot || '', structuredTarget.target);
  if (!evidence.workspaceRoot
      || !isCanonicalPathInsideRoot(absoluteStructuredTarget, evidence.workspaceRoot)) {
    return `artifact-grounding: 任务结构化目标不在中央结算 workspaceRoot 内：${structuredTarget.target}`;
  }
  if (!evidencePathsMatch(structuredTarget.target, latest.artifactPath, evidence.workspaceRoot)) {
    return `artifact-grounding: VerificationResult 交付物 ${latest.artifactPath} 与任务目标 ${structuredTarget.target} 不一致`;
  }
  const [contractTarget] = contract.deliverableTargets;
  if (contractTarget && !evidencePathsMatch(contractTarget, latest.artifactPath, evidence.workspaceRoot)) {
    return `artifact-grounding: VerificationResult 交付物 ${latest.artifactPath} 与请求目标 ${contractTarget} 不一致`;
  }
  const artifactRef = evidence.evidenceRefs?.find(ref => ref.evidenceId === latest.artifactEvidenceId);
  if (!artifactRef
      || artifactRef.kind !== 'artifact-readback'
      || !artifactRef.sourcePath
      || !evidencePathsMatch(artifactRef.sourcePath, latest.artifactPath, evidence.workspaceRoot)
      || artifactRef.contentHash !== latest.artifactHash
      || !evidenceRefContentMatchesHash(artifactRef)) {
    return 'artifact-grounding: VerificationResult 未绑定有效的交付物读回 EvidenceRef';
  }
  const currentArtifactHash = hashCurrentEvidenceFile(latest.artifactPath, evidence.workspaceRoot);
  if (!currentArtifactHash || currentArtifactHash !== latest.artifactHash) {
    return `artifact-grounding: 交付物在 VerificationResult 后已变化或不可读取 ${latest.artifactPath}`;
  }
  const sourceReadbackIds = new Set(latest.sourceReadbackEvidenceIds);
  const currentSourceHashes = new Map<string, string | undefined>();
  for (const claim of latest.claims) {
    const sourceKey = normalizeEvidencePath(claim.sourcePath);
    if (!currentSourceHashes.has(sourceKey)) {
      currentSourceHashes.set(
        sourceKey,
        hashCurrentEvidenceFile(claim.sourcePath, evidence.workspaceRoot),
      );
    }
  }
  const hasBoundSourceEvidence = latest.claims.every(claim => {
    const sourceEvidence = evidence.evidenceRefs?.find(ref => ref.evidenceId === claim.evidenceId);
    const readbackEvidence = evidence.evidenceRefs?.find(ref => (
      ref.evidenceId
      && sourceReadbackIds.has(ref.evidenceId)
      && ref.evidenceId !== claim.evidenceId
      && ref.sourcePath
      && evidencePathsMatch(ref.sourcePath, claim.sourcePath, evidence.workspaceRoot)
      && ref.contentHash === claim.sourceHash
      && evidenceRefContentMatchesHash(ref)
    ));
    return Boolean(
      sourceEvidence?.sourcePath
      && evidencePathsMatch(sourceEvidence.sourcePath, claim.sourcePath, evidence.workspaceRoot)
      && sourceEvidence.contentHash === claim.sourceHash
      && currentSourceHashes.get(normalizeEvidencePath(claim.sourcePath)) === claim.sourceHash
      && sourceEvidence.captureSequence === claim.evidenceSequence
      && artifactRef.captureSequence !== undefined
      && sourceEvidence.captureSequence !== undefined
      && artifactRef.captureSequence > sourceEvidence.captureSequence
      && evidenceRefContentMatchesHash(sourceEvidence)
      && readbackEvidence?.kind === 'read'
      && readbackEvidence.operationId
      && readbackEvidence.captureSequence !== undefined
      && readbackEvidence.captureSequence > artifactRef.captureSequence
      && readbackEvidence,
    );
  });
  if (!hasBoundSourceEvidence) {
    return 'artifact-grounding: VerificationResult 未绑定当前磁盘源码、原始源码证据和独立源码读回证据';
  }
  try {
    const sourceEvidenceIds = new Set(latest.claims.map(claim => claim.evidenceId));
    const sourceEvidenceRefs = (evidence.evidenceRefs || []).filter(ref => (
      ref.evidenceId && sourceEvidenceIds.has(ref.evidenceId)
    ));
    const sourceReadbackRefs = latest.sourceReadbackEvidenceIds.flatMap(evidenceId => {
      const ref = evidence.evidenceRefs?.find(candidate => candidate.evidenceId === evidenceId);
      return ref ? [ref] : [];
    });
    const recomputedSpecs = deriveArtifactClaimSpecs(requirements, sourceEvidenceRefs);
    const recomputed = verifyArtifactClaims(
      recomputedSpecs,
      artifactRef,
      sourceReadbackRefs,
      contract.verificationContract,
    );
    const semanticResultMatches = recomputed.verificationId === latest.verificationId
      && JSON.stringify(recomputed.claims) === JSON.stringify(latest.claims)
      && JSON.stringify(recomputed.differences) === JSON.stringify(latest.differences)
      && JSON.stringify(recomputed.contractDifferences) === JSON.stringify(latest.contractDifferences)
      && JSON.stringify(recomputed.sourceReadbackEvidenceIds) === JSON.stringify(latest.sourceReadbackEvidenceIds);
    if (!recomputed.ok || !semanticResultMatches) {
      return 'artifact-grounding: VerificationResult 与中央结算重算的源码/交付物语义不一致';
    }
  } catch (error) {
    return `artifact-grounding: 中央结算无法重算 VerificationResult（${(error as Error).message}）`;
  }
  const writtenFiles = coalesceWrittenFileEvidence(evidence.writtenFiles ?? [], evidence.workspaceRoot);
  if (!writtenFiles.some(file => evidencePathsMatch(file.path, latest.artifactPath, evidence.workspaceRoot))) {
    return `artifact-grounding: VerificationResult 未绑定本次写盘交付物 ${latest.artifactPath}`;
  }
  const unrelatedWrittenFile = writtenFiles.find(file => (
    !evidencePathsMatch(file.path, structuredTarget.target!, evidence.workspaceRoot)
  ));
  if (unrelatedWrittenFile) {
    return `artifact-grounding: 本任务写入了未绑定唯一交付目标的文件 ${unrelatedWrittenFile.path}`;
  }
  if (contract.verificationContract.maxWrittenFiles !== undefined
      && writtenFiles.length > contract.verificationContract.maxWrittenFiles) {
    return `artifact-grounding: 本次写入 ${writtenFiles.length} 个文件，超过契约上限 ${contract.verificationContract.maxWrittenFiles}`;
  }
  return undefined;
}

function getVerificationEvidenceWorkspaceBindingFailure(
  verification: VerificationResult,
  evidenceRefs: EvidenceRef[],
  settlementWorkspaceRoot?: string,
): string | undefined {
  if (!settlementWorkspaceRoot) {
    return '中央结算缺少 workspaceRoot，不能重锚 EvidenceRef';
  }
  const settlementRoot = canonicalWorkspaceRoot(settlementWorkspaceRoot);
  const referencedIds = new Set([
    verification.artifactEvidenceId,
    ...verification.claims.map(claim => claim.evidenceId),
    ...verification.sourceReadbackEvidenceIds,
  ]);
  for (const evidenceId of referencedIds) {
    const matches = evidenceRefs.filter(ref => ref.evidenceId === evidenceId);
    if (matches.length !== 1) {
      return `VerificationResult 引用的 EvidenceRef ${evidenceId} 数量为 ${matches.length}，要求唯一`;
    }
    const [ref] = matches;
    if (!ref.workspaceRoot) {
      return `EvidenceRef ${evidenceId} 缺少 workspaceRoot，不能由中央结算外部重锚`;
    }
    if (canonicalWorkspaceRoot(ref.workspaceRoot) !== settlementRoot) {
      return `EvidenceRef ${evidenceId} 的 workspaceRoot ${ref.workspaceRoot} 与中央结算 ${settlementWorkspaceRoot} 不一致`;
    }
  }
  return undefined;
}

function canonicalWorkspaceRoot(workspaceRoot: string): string {
  const resolved = nodePath.resolve(workspaceRoot);
  try {
    return normalizeEvidencePath(fs.realpathSync.native(resolved));
  } catch {
    return normalizeEvidencePath(resolved);
  }
}

function resolveStructuredArtifactTarget(
  task: AgentTask,
  workspaceRoot?: string,
): { target?: string; error?: string } {
  if (task.action !== 'create' && task.action !== 'modify') {
    return { error: `source-claim 交付要求 create/modify 动作，实际为 ${task.action}` };
  }
  const absoluteTarget = task.absPath?.trim();
  const fileTarget = task.file?.trim();
  if (absoluteTarget && fileTarget) {
    const normalizedFileTarget = fileTarget.replace(/\\/g, '/');
    const allowsBasenameFallback = nodePath.posix.basename(normalizedFileTarget) === normalizedFileTarget;
    const compatible = evidencePathsMatch(absoluteTarget, fileTarget, workspaceRoot)
      || (allowsBasenameFallback && nodePath.basename(absoluteTarget) === normalizedFileTarget);
    if (!compatible) {
      return { error: `任务结构化目标冲突：absPath=${absoluteTarget} file=${fileTarget}` };
    }
    return { target: absoluteTarget };
  }
  if (absoluteTarget || fileTarget) return { target: absoluteTarget || fileTarget };
  const visibleTarget = task.visibleTarget?.trim();
  if (visibleTarget && /\.(?:md|markdown)$/i.test(visibleTarget)) return { target: visibleTarget };
  return {};
}

function evidenceRefContentMatchesHash(ref: EvidenceRef): boolean {
  return typeof ref.content === 'string'
    && typeof ref.contentHash === 'string'
    && createHash('sha256').update(ref.content).digest('hex') === ref.contentHash;
}

function hashCurrentEvidenceFile(filePath: string, workspaceRoot?: string): string | undefined {
  const absolutePath = nodePath.isAbsolute(filePath)
    ? filePath
    : nodePath.resolve(workspaceRoot || '', filePath);
  try {
    return createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
  } catch {
    return undefined;
  }
}

function evidencePathsMatch(left: string, right: string, workspaceRoot?: string): boolean {
  const normalizedLeft = normalizeEvidencePath(left);
  const normalizedRight = normalizeEvidencePath(right);
  if (normalizedLeft === normalizedRight) return true;
  const root = normalizeEvidencePath(workspaceRoot || '');
  const absoluteLeft = root && !nodePath.isAbsolute(normalizedLeft)
    ? normalizeEvidencePath(nodePath.join(root, normalizedLeft))
    : normalizedLeft;
  const absoluteRight = root && !nodePath.isAbsolute(normalizedRight)
    ? normalizeEvidencePath(nodePath.join(root, normalizedRight))
    : normalizedRight;
  return absoluteLeft === absoluteRight;
}

function hasFinalTaskCompletionEvidence(
  task: AgentTask,
  evidence: FinalTaskEvidence,
  writtenFiles: WrittenFileEvidence[],
): boolean {
  if (isReadOnlyAgentTaskAction(task.action)) {
    const taskEvidence: TaskEvidence = {
      action: task.action,
      raw: hasSuccessfulFinalTerminalEvidence(evidence.terminalEvidence) ? 'final terminal evidence' : undefined,
      taskComplete: hasSuccessfulFinalTerminalEvidence(evidence.terminalEvidence),
      terminalEvidence: evidence.terminalEvidence,
      writtenFiles,
      workspaceRoot: evidence.workspaceRoot,
    };
    return getTaskMissingCompletionEvidence(task, taskEvidence).length === 0
      && taskRuntimeCanDeliver(taskEvidence);
  }

  return hasWrittenEvidenceForTask(task, writtenFiles, evidence.workspaceRoot);
}

function taskRuntimeCanDeliver(evidence: TaskEvidence): boolean {
  const validationPassed = hasValidatedTaskCompletionEvidence(evidence);
  const settlement = settleAgentRuntimeState({
    taskAction: evidence.action,
    providerText: runtimeProviderTextForTask(evidence, validationPassed),
    writtenEvidenceCount: countWrittenTaskEvidence(evidence),
    terminalEvidenceCount: evidence.terminalEvidence?.length ?? 0,
    validationPassed,
    failedReason: evidence.failedReason,
  });
  return runtimeStateCanDeliver(settlement);
}

function hasValidatedTaskCompletionEvidence(evidence: TaskEvidence): boolean {
  if (!isReadOnlyAgentTaskAction(evidence.action)) {
    return Boolean(evidence.applied && (evidence.path || evidence.writtenFiles?.length));
  }
  return hasSuccessfulTerminalCompletionEvidence(evidence.terminalEvidence);
}

function runtimeProviderTextForTask(evidence: TaskEvidence, validationPassed: boolean): string {
  const raw = stripToolCallBlocks(evidence.raw ?? '').trim();
  if (raw) return raw;
  if (!validationPassed) return evidence.raw ?? '';
  if (!isReadOnlyAgentTaskAction(evidence.action)) {
    return '已完成：文件写入证据已记录。';
  }
  return '结论：本地运行或验证已完成。依据：终端命令返回成功证据。';
}

function countWrittenTaskEvidence(evidence: TaskEvidence): number {
  if (evidence.writtenFiles?.length) return evidence.writtenFiles.length;
  return evidence.applied && evidence.path ? 1 : 0;
}

function sumOptional(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => typeof value === 'number');
  return present.length > 0
    ? present.reduce((sum, value) => sum + value, 0)
    : undefined;
}

function hasSuccessfulFinalTerminalEvidence(evidence: TerminalEvidence[] | undefined): boolean {
  return Boolean(evidence?.some(item =>
    item.ok && (item.kind === 'compile' || item.kind === 'run' || item.kind === 'test' || item.kind === 'compile-run'),
  ));
}

function isConditionalFailureRecoveryTask(task: AgentTask): boolean {
  const text = `${task.desc || ''} ${task.file || ''} ${task.visibleTarget || ''}`.toLowerCase();
  const hasCondition = /(?:若|如果|如若|假如|倘若|当|一旦|if|when|whenever|unless)/i.test(text);
  const hasFailureSignal = /(?:失败|报错|错误|异常|未通过|不通过|出错|故障|fail(?:ed|ure|s)?|error|broken|invalid|not\s+pass)/i.test(text);
  const hasRecoveryAction = /(?:修复|修正|更正|补全|处理|解决|恢复|fix|repair|recover|correct|resolve|patch)/i.test(text);
  return hasCondition && hasFailureSignal && hasRecoveryAction;
}

function hasWrittenEvidenceForTask(
  task: AgentTask,
  writtenFiles: WrittenFileEvidence[],
  workspaceRoot?: string,
): boolean {
  if (writtenFiles.length === 0) return false;
  const taskPath = normalizeEvidencePath(task.absPath || task.file || task.visibleTarget || '');
  const taskBase = taskPath ? taskPath.slice(taskPath.lastIndexOf('/') + 1) : '';
  if (taskPath) {
    const directMatch = writtenFiles.some(file => {
      const writtenPath = normalizeEvidencePath(file.path);
      const writtenBase = writtenPath.slice(writtenPath.lastIndexOf('/') + 1);
      return writtenPath === taskPath || writtenPath.endsWith(`/${taskPath}`) || Boolean(taskBase && writtenBase === taskBase);
    });
    if (directMatch) return true;
  }

  const tokens = extractTaskFileTokens(task.file, task.visibleTarget, task.desc);
  if (tokens.size > 0) {
    return writtenFiles.some(file => taskFileTokensMatchWrittenEvidence(tokens, file, workspaceRoot));
  }

  return true;
}

function buildTaskSettlementFailureDetail(
  task: AgentTask,
  result: { applied?: boolean; raw?: string; failedReason?: string; terminalEvidence?: TerminalEvidence[]; writtenFiles?: WrittenFileEvidence[]; workspaceRoot?: string; taskComplete?: boolean },
): string {
  if (result.failedReason) return result.failedReason;
  const terminalFailure = findBlockingTerminalFailureEvidence(result.terminalEvidence);
  if (terminalFailure) return buildTaskTerminalFailureDetail(terminalFailure);
  const missingEvidence = getTaskMissingCompletionEvidence(task, {
    action: task.action,
    applied: result.applied,
    raw: result.raw,
    terminalEvidence: result.terminalEvidence,
    writtenFiles: result.writtenFiles,
    workspaceRoot: result.workspaceRoot,
    taskComplete: result.taskComplete,
  });
  if (missingEvidence.length > 0) {
    return `任务缺少必要完成证据：${missingEvidence.join('、')}。不能仅凭文字说明或构建命令标记完成。`;
  }
  if (!isReadOnlyAgentTaskAction(task.action) && !result.applied) {
    return '任务缺少本地写盘证据，不能标记为完成。请继续生成可应用补丁或完整文件内容。';
  }
  return '任务缺少本地验证证据，不能标记为完成。';
}

function getTaskDisplayTarget(task: Pick<AgentTask, 'file' | 'visibleTarget'>): string {
  if (task.visibleTarget) return task.visibleTarget;
  if (!task.file) return 'Agent 任务';
  const normalized = task.file.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'Agent 任务';
}

function taskTodoItem(task: AgentTask, index: number, status: TodoStatus): TodoItem {
  return {
    id: index + 1,
    title: summarizeAgentTodoTitle(task.desc, getTaskDisplayTarget(task)),
    status,
    __agentState: true,
  };
}

export function summarizeAgentTodoTitle(title: string | undefined, fallback = 'Agent 任务'): string {
  const normalized = String(title || fallback || 'Agent 任务')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return fallback;

  const firstClause = normalized
    .split(/[。；;，,\n]/)
    .map(part => part.trim())
    .find(part => part.length >= 4);
  if (firstClause && firstClause.length <= TODO_TITLE_MAX) return firstClause;
  if (normalized.length <= TODO_TITLE_MAX) return normalized;

  const filenameMatch = normalized.match(/(?:^|[\s"'`])([A-Za-z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|cpp|cc|cxx|h|hpp|py|md|json|txt|cmake|css|html))(?:$|[\s"'`])/i);
  const actionMatch = normalized.match(/^(创建|修改|更新|删除|分析|检查|验证|编译|运行|修复|重构|实现|添加|新增|create|modify|update|delete|analyze|check|verify|compile|run|fix|refactor|implement|add)\b/i);
  if (filenameMatch) {
    const prefix = actionMatch ? actionMatch[0] : '处理';
    const candidate = `${prefix} ${filenameMatch[1]}`;
    if (candidate.length <= TODO_TITLE_MAX) return candidate;
  }

  return `${normalized.slice(0, TODO_TITLE_MAX - 1).trimEnd()}…`;
}

function isTaskIndex(index: number, tasks: AgentTask[]): boolean {
  return Number.isInteger(index) && index >= 0 && index < tasks.length;
}

function isTerminalStatus(status: TodoStatus): boolean {
  return status === 'completed' || status === 'failed';
}

function findValidationTaskIndex(tasks: AgentTask[]): number {
  return tasks.findIndex(task => isAutomaticValidationTodoTitle(
    `${task.desc || ''} ${task.file || ''}`,
  ));
}

function isAutomaticValidationTodoTitle(title: string): boolean {
  return /(?:编译|运行|执行|测试|type(?:script)?|tsc|compile|build|test|run|execute|validate|qualitygate)/i.test(title);
}

function isFileFactVerificationTodoTitle(title: string): boolean {
  return /(?:文件|内容|大小|存在|创建成功|读取|检查|确认|校验|验证)/i.test(title)
    && !isAutomaticValidationTodoTitle(title);
}

function nextTodoId(todos: TodoItem[]): number {
  return Math.max(0, ...todos.map(todo => Number(todo.id) || 0)) + 1;
}
