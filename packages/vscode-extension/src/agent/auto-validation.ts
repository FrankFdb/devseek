import type {
  BuildOrchestrationPort,
  CodingVerificationCriterion,
  CodingVerificationReceipt,
  CodingVerificationSessionPort,
  CodingKernelTaskContract,
  CodingWorkspaceMutationReceipt,
  CodingToolAuthoritySessionPort,
  CodingToolExecutionSessionPort,
  DiagnosticPort,
  RegressionSelectionPort,
  VerifierSelectionPort,
} from '@devseek-netai/shared';
import { codingWorkspaceTargetMatchesScope } from '@devseek-netai/shared';
import type { AgentStatusEvent } from './events';
import {
  type TerminalEvidence,
  type WrittenFileEvidence,
} from './completion-evidence';
import {
  ValidationService,
  projectAutoValidationResult,
  type AutoValidationResult,
  type ValidationCommandRunner,
} from '../workspace/validation-service';
import {
  buildValidationFailureDiagnosis,
  type FailureDiagnosis,
} from '../app/failure-diagnosis';
import {
  normalizeVerificationResult,
  shouldEmitTerminalEvidenceForVerification,
  verificationResultIsCompletionCandidate,
  type VerificationAuthorityResult,
  type VerificationResultStatus,
} from '../app/verification-result-authority';
import { evaluateCodingRequirementQualityGate } from '../app/coding-requirement-quality-gate';
import {
  VsCodeVerificationAdapter,
  type VsCodeVerificationExecution,
} from '../app/coding-verification-adapter';
import { validationResultToTerminalEvidence } from './validation-terminal-evidence';
import { workspaceRelativeVerificationPaths } from './verification-scope';
import { CanonicalValidationCommandRunner } from './canonical-validation-command-runner';
import { buildStructuralCompileFailureRecoveryProtocol } from '../app/structural-compile-failure';
import { isCodeArtifactPathValue } from '../artifact-path-kind';
import { projectDiagnosticOutputExcerpt } from '../app/diagnostic-output-projection';

export interface AgentAutoValidationCallbacks {
  onAgentStatus: (status: AgentStatusEvent) => void | Promise<void>;
  onToolActivity?: (kind: 'terminal', label: string) => void;
  /** Evidence-aware authority for every automatic validation process. */
  onValidationCommand: ValidationCommandRunner;
  traceRunId?: string;
  signal?: AbortSignal;
  canonicalVerification?: CodingVerificationSessionPort;
  canonicalToolAuthority?: CodingToolAuthoritySessionPort;
  canonicalToolExecution?: CodingToolExecutionSessionPort;
  canonicalVerifierSelection?: VerifierSelectionPort;
  canonicalBuildOrchestration?: BuildOrchestrationPort;
  canonicalRegressionSelection?: RegressionSelectionPort;
  canonicalDiagnostics?: DiagnosticPort;
  canonicalTaskContract?: CodingKernelTaskContract;
  canonicalVerificationAcceptance?: readonly CodingVerificationCriterion[];
}

export interface AgentAutoValidationResult {
  verificationReceipt?: CodingVerificationReceipt;
  evidenceOperationId?: string;
  evidence?: TerminalEvidence;
  feedbackForAI?: string;
  repairBlockedReason?: string;
  qualityGate?: {
    status: 'pass' | 'fail' | 'blocked';
    summary: string;
    risks?: string[];
    evidenceRefs?: string[];
    failureDiagnosis?: FailureDiagnosis;
    alternativeChecks?: string[];
    requiredActions?: string[];
  };
}

export interface AgentAutoValidationOptions {
  validationService?: Pick<ValidationService, 'discover' | 'execute'>;
  verificationScopeWrittenFiles?: readonly WrittenFileEvidence[];
  verificationAdapter?: Pick<VsCodeVerificationAdapter, 'verify'>;
  verificationPorts?: {
    readonly selection: VerifierSelectionPort;
    readonly orchestration: BuildOrchestrationPort;
    readonly regressionSelection: RegressionSelectionPort;
    readonly verification: CodingVerificationSessionPort;
    readonly diagnostics: DiagnosticPort;
  };
  verificationAcceptance?: readonly CodingVerificationCriterion[];
  verificationEvidenceRefs?: readonly string[];
  priorVerificationReceipts?: readonly CodingVerificationReceipt[];
  changeReceipts?: readonly CodingWorkspaceMutationReceipt<unknown>[];
}

export interface ReusableVerificationReceiptInput {
  readonly runId?: string;
  readonly changedPaths: readonly string[];
  readonly acceptance: readonly CodingVerificationCriterion[];
  readonly verificationReceipts: readonly CodingVerificationReceipt[];
  readonly changeReceipts: readonly CodingWorkspaceMutationReceipt<unknown>[];
}

let autoValidationOperationSequence = 0;
const DEFAULT_WORKSPACE_VALIDATION_ACCEPTANCE: readonly CodingVerificationCriterion[] = Object.freeze([{
  id: 'workspace-validation',
  statement: 'Applicable workspace validation and quality checks pass.',
}]);
const READBACK_ONLY_ARTIFACT_RE = /\.(?:csv|ini|jsonc?|md|markdown|toml|tsv|txt|xml|ya?ml)$/iu;

function nextAutoValidationOperationId(changedPaths: readonly string[]): string {
  autoValidationOperationSequence += 1;
  const scope = changedPaths.join('|').replace(/[^0-9A-Za-z._/-]+/g, '-').slice(0, 160) || 'workspace';
  return `auto-validation-${autoValidationOperationSequence}-${scope}`.slice(0, 512);
}

/** Selects only the latest current-run receipt that post-dates the full write cohort. */
export function selectReusableVerificationReceipt(
  input: ReusableVerificationReceiptInput,
): CodingVerificationReceipt | undefined {
  if (input.acceptance.length === 0 || input.changedPaths.length === 0) return undefined;
  const latestMutationSequence = input.changeReceipts
    .filter(receipt => receipt.status === 'committed'
      && receipt.paths.some(path => input.changedPaths.some(changedPath => (
        codingWorkspaceTargetMatchesScope(path, changedPath)
          || codingWorkspaceTargetMatchesScope(changedPath, path)
      ))))
    .reduce((latest, receipt) => Math.max(latest, receipt.sequence), 0);
  const acceptanceIds = new Set(input.acceptance.map(criterion => criterion.id));
  const latest = input.verificationReceipts
    .filter(receipt => (
      (!input.runId || receipt.runId === input.runId)
        && receipt.sequence > latestMutationSequence
        && receiptCoversPaths(receipt, input.changedPaths)
        && [...acceptanceIds].every(id => receipt.acceptance.some(result => result.criterionId === id))
    ))
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1);
  return latest?.status === 'passed'
    && latest.acceptance.length > 0
    && latest.acceptance.every(result => result.status === 'passed')
    ? latest
    : undefined;
}

function receiptCoversPaths(
  receipt: CodingVerificationReceipt,
  changedPaths: readonly string[],
): boolean {
  return changedPaths.every(path => receipt.scopePaths.some(scope => (
    scope === 'workspace' || codingWorkspaceTargetMatchesScope(path, scope)
  )));
}

function qualityGateStatusToAgentState(
  status: NonNullable<AgentAutoValidationResult['qualityGate']>['status'],
): AgentStatusEvent['state'] {
  if (status === 'pass') return 'completed';
  if (status === 'blocked') return 'skipped';
  return 'failed';
}

function qualityGateStatusToValidationState(
  status: NonNullable<AgentAutoValidationResult['qualityGate']>['status'] | undefined,
): AgentStatusEvent['state'] {
  if (!status) return 'skipped';
  if (status === 'pass') return 'completed';
  if (status === 'blocked') return 'skipped';
  return 'failed';
}

async function emitAutoValidationQualityGateStatus(
  callbacks: AgentAutoValidationCallbacks,
  evidenceOperationId: string,
  verificationScopePaths: readonly string[],
  qualityGate: NonNullable<AgentAutoValidationResult['qualityGate']>,
): Promise<void> {
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'quality',
    state: 'started',
    evidenceOperationId,
    verificationScopePaths,
    title: '评估自动验证 QualityGate',
    detail: qualityGate.summary,
  });
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'quality',
    state: qualityGateStatusToAgentState(qualityGate.status),
    evidenceOperationId,
    verificationScopePaths,
    title: qualityGate.status === 'pass'
      ? '自动验证 QualityGate 通过'
      : qualityGate.status === 'blocked'
        ? '自动验证 QualityGate 阻塞'
        : '自动验证 QualityGate 未通过',
    detail: qualityGate.summary,
  });
}

function formatAutoValidationFeedback(
  result: AutoValidationResult,
  changedPaths: readonly string[] = [],
): string {
  const verification = normalizeVerificationResult(result);
  const structuralRecovery = result.ok ? '' : buildStructuralCompileFailureRecoveryProtocol({
    output: result.output,
    changedPaths,
  });
  return [
    `[verification_result: ${verification.status}]`,
    `[auto_validation: ${result.command}]`,
    `cwd=${result.cwd}`,
    `exitCode=${result.exitCode ?? 'unknown'}`,
    result.reason ? `reason=${result.reason}` : '',
    result.output ? projectDiagnosticOutputExcerpt(result.output, 4000) : '',
    result.risks?.length ? `risks:\n${result.risks.map((risk) => `- ${risk}`).join('\n')}` : '',
    result.alternativeChecks?.length ? `alternativeChecks:\n${result.alternativeChecks.map((check) => `- ${check}`).join('\n')}` : '',
    result.ok ? '' : '自动验证命令未通过，不能把编译/运行/测试标记为完成。',
    structuralRecovery,
    result.ok ? '' : failedValidationRepairProtocol(),
  ].filter(Boolean).join('\n');
}

function failedValidationRepairProtocol(): string {
  return [
    '修复闭环要求：',
    '- 下一轮先用 read_file 重新读取当前落盘源码和相关测试入口；不要只依据上一轮回复、write 工具回显、旧日志或猜测继续改。',
    '- 从首个失败断言/错误行构造最小失败路径：输入状态、期望结果、当前源码执行分支、会被改变的状态容器或字段。',
    '- 如果相同断言再次失败，必须改变定位策略；优先检查状态索引同步、排序/遍历方向、边界条件、生命周期/移动后使用、错误/拒绝分支是否与正常成功可区分。',
    '- 可用只读查询或项目验证命令辅助定位，但不得修改受保护测试/构建文件；只有下一轮自动验证通过后才可以 task_complete。',
  ].join('\n');
}

function formatBlockedAutoValidationFeedback(result: AutoValidationResult): string {
  const verification = normalizeVerificationResult(result);
  return [
    `[verification_result: ${verification.status}]`,
    '[auto_validation: blocked]',
    `reason=${verification.reason ?? result.reason ?? 'no-auto-validation-target'}`,
    result.output ? projectDiagnosticOutputExcerpt(result.output, 1600) : '',
    result.risks?.length ? `risks:\n${result.risks.map((risk) => `- ${risk}`).join('\n')}` : '',
    result.alternativeChecks?.length ? `alternativeChecks:\n${result.alternativeChecks.map((check) => `- ${check}`).join('\n')}` : '',
    'QualityGate 阻塞：没有可自动运行的验证目标，不能把结果标记为已验证通过；不要发明 build/test 脚本或用失败命令反复修复。',
  ].filter(Boolean).join('\n');
}

function validationEvidenceRef(status: VerificationResultStatus, result: AutoValidationResult): string {
  return `validation:${status}:${result.command || result.reason || 'unknown'}`;
}

function buildAutoValidationQualityGate(
  result: AutoValidationResult,
  changedPaths: string[] = [],
): NonNullable<AgentAutoValidationResult['qualityGate']> {
  const verification = normalizeVerificationResult(result);
  if (!shouldEmitTerminalEvidenceForVerification(verification)) {
    const evidenceRef = validationEvidenceRef(verification.status, result);
    const diagnosisStatus = verification.status === 'missing' ? 'missing' : 'blocked';
    return {
      status: 'blocked',
      summary: `QualityGate 阻塞：${verification.reason || verification.status}。`,
      evidenceRefs: [evidenceRef],
      failureDiagnosis: buildValidationFailureDiagnosis({
        status: diagnosisStatus,
        changedPaths,
        command: result.command,
        exitCode: result.exitCode,
        output: result.output,
        reason: verification.reason || verification.status,
        mode: result.mode,
        evidenceRef,
      }),
      risks: verification.risks.length
        ? verification.risks
        : ['没有自动验证证据，不能证明变更后的行为正确。'],
      alternativeChecks: verification.alternativeChecks.length
        ? verification.alternativeChecks
        : ['人工检查变更文件内容是否符合用户请求。'],
      requiredActions: ['补充可运行验证，或由用户明确接受剩余风险。'],
    };
  }

  if (verificationResultIsCompletionCandidate(verification)) {
    return {
      status: 'pass',
      summary: `QualityGate 通过：${result.command || '自动验证'} 已通过。`,
      evidenceRefs: [validationEvidenceRef('passed', result)],
      risks: result.risks ?? [],
      alternativeChecks: result.alternativeChecks ?? [],
    };
  }

  const evidenceRef = validationEvidenceRef('failed', result);
  return {
    status: 'fail',
    summary: `QualityGate 未通过：自动验证失败（exitCode=${result.exitCode ?? 'null'}）。`,
    evidenceRefs: [evidenceRef],
    failureDiagnosis: buildValidationFailureDiagnosis({
      status: 'failed',
      changedPaths,
      command: result.command,
      exitCode: result.exitCode,
      output: result.output,
      reason: result.reason,
      mode: result.mode,
      evidenceRef,
    }),
    risks: [
      ...(result.risks || []),
      '自动验证命令失败，不能把任务标记为完成。',
    ],
    alternativeChecks: result.alternativeChecks || [],
    requiredActions: ['修复自动验证失败后重新运行 QualityGate。'],
  };
}

function buildReadbackOnlyQualityGate(
  changedPaths: readonly string[],
): NonNullable<AgentAutoValidationResult['qualityGate']> {
  return {
    status: 'pass',
    summary: `QualityGate 通过：${changedPaths.length} 个文档/配置交付物已完成文件读回检查。`,
    evidenceRefs: changedPaths.map(path => `file-readback:${path}`),
    risks: [],
    alternativeChecks: [],
    requiredActions: [],
  };
}

function buildReadbackOnlyEvidence(changedPaths: readonly string[]): TerminalEvidence {
  return {
    command: `file-readback ${changedPaths.join(' ')}`,
    kind: 'other',
    ok: true,
    exitCode: 0,
    detail: `${changedPaths.length} 个文档/配置交付物已由宿主读取并通过规范需求门禁。`,
  };
}

function isReadbackOnlyValidationScope(changedPaths: readonly string[]): boolean {
  return changedPaths.length > 0 && changedPaths.every(path => (
    !isCodeArtifactPathValue(path) && READBACK_ONLY_ARTIFACT_RE.test(path)
  ));
}

function formatReadbackOnlyFeedback(changedPaths: readonly string[]): string {
  return [
    '[workspace_readback: passed]',
    `files=${changedPaths.join(', ')}`,
    '文档/配置交付物不需要编译、运行或测试命令；本轮自动验证以文件读回和规范需求门禁作为完成证据。',
  ].join('\n');
}

function evaluateCanonicalRequirementQuality(
  userPrompt: string,
  workspaceRoot: string,
  targetPaths: readonly string[],
  taskContract?: CodingKernelTaskContract,
): AgentAutoValidationResult | undefined {
  const promptText = userPrompt.trim();
  if (!promptText) return undefined;
  const acceptance = evaluateCodingRequirementQualityGate({
    prompt: promptText,
    workspaceRoot,
    targetPaths,
    taskContract,
  });
  if (acceptance.status === 'accepted') return undefined;
  const status = acceptance.status === 'adverse' ? 'fail' : 'blocked';
  const reason = acceptance.reason || acceptance.status;
  return {
    feedbackForAI: [
      '[canonical_requirement_decision]',
      `status=${acceptance.status}`,
      `reason=${reason}`,
      acceptance.risks?.length ? `risks:\n${acceptance.risks.map(risk => `- ${risk}`).join('\n')}` : '',
      acceptance.requiredActions?.length ? `requiredActions:\n${acceptance.requiredActions.map(action => `- ${action}`).join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    qualityGate: {
      status,
      summary: status === 'fail'
        ? `QualityGate 未通过：${reason}。`
        : `QualityGate 阻塞：${reason}。`,
      risks: acceptance.risks ?? [],
      evidenceRefs: acceptance.evidenceRefs ?? [`contract:${acceptance.status}:${reason}`],
      alternativeChecks: acceptance.alternativeChecks ?? [],
      requiredActions: acceptance.requiredActions ?? ['补齐可执行 acceptance 证据后重新验证。'],
    },
  };
}

export async function runAgentAutoValidationForWrites(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
  userPrompt: string,
  callbacks: AgentAutoValidationCallbacks,
  options: AgentAutoValidationOptions = {},
): Promise<AgentAutoValidationResult> {
  const triggerPaths = workspaceRelativeVerificationPaths(writtenFiles, workspaceRootFsPath);
  if (triggerPaths.length === 0 || callbacks.signal?.aborted) return {};
  const changedPaths = workspaceRelativeVerificationPaths(
    options.verificationScopeWrittenFiles ?? writtenFiles,
    workspaceRootFsPath,
  );
  if (changedPaths.length === 0) return {};
  const evidenceOperationId = nextAutoValidationOperationId(changedPaths);
  const canonicalVerificationAcceptance = callbacks.canonicalVerificationAcceptance;
  const suppliedVerificationAcceptance = canonicalVerificationAcceptance !== undefined
    ? canonicalVerificationAcceptance
    : options.verificationAcceptance ?? [];
  const readbackOnlyScope = isReadbackOnlyValidationScope(changedPaths);
  const acceptance = canonicalVerificationAcceptance !== undefined
    || suppliedVerificationAcceptance.length > 0
    ? suppliedVerificationAcceptance
    : DEFAULT_WORKSPACE_VALIDATION_ACCEPTANCE;
  const verificationContext = {
    runId: callbacks.traceRunId?.trim() || evidenceOperationId,
    sequence: autoValidationOperationSequence,
    actionId: evidenceOperationId,
    scopePaths: changedPaths,
    acceptance,
    evidenceRefs: [
      ...(options.verificationEvidenceRefs ?? []),
      `verification-operation:${evidenceOperationId}`,
    ],
  };
  let execution: VsCodeVerificationExecution | undefined;
  try {
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'started',
      evidenceOperationId,
      verificationScopePaths: changedPaths,
      title: '自动验证写入结果',
      detail: changedPaths.join('\n'),
    });
    const requirementQuality = evaluateCanonicalRequirementQuality(
      userPrompt,
      workspaceRootFsPath,
      changedPaths,
      callbacks.canonicalTaskContract,
    );
    const policyQuality = requirementQuality;
    const policyQualityTitle = requirementQuality ? '需求质量门禁未通过' : undefined;
    const reusableVerification = selectReusableVerificationReceipt({
      runId: callbacks.traceRunId,
      changedPaths,
      acceptance: suppliedVerificationAcceptance,
      verificationReceipts: options.priorVerificationReceipts ?? [],
      changeReceipts: options.changeReceipts ?? [],
    });
    if (reusableVerification) {
      const qualityGate = policyQuality?.qualityGate ?? {
        status: 'pass' as const,
        summary: '已复用当前写入批次之后通过的终端验证证据。',
        evidenceRefs: [...reusableVerification.evidenceRefs],
      };
      const feedbackForAI = [
        policyQuality?.feedbackForAI,
        policyQuality ? '' : '当前代码写入已由同一运行中的后续终端命令验证，无需重复启动自动验证器。',
      ].filter(Boolean).join('\n\n');
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: qualityGateStatusToValidationState(qualityGate.status),
        evidenceOperationId,
        verificationScopePaths: changedPaths,
        title: policyQualityTitle ?? '已复用终端验证结果',
        detail: projectDiagnosticOutputExcerpt(feedbackForAI, 1200),
      });
      await emitAutoValidationQualityGateStatus(callbacks, evidenceOperationId, changedPaths, qualityGate);
      return {
        evidenceOperationId,
        feedbackForAI,
        qualityGate,
      };
    }
    const policyCheckId = policyQuality ? `${evidenceOperationId}:policy-quality` : undefined;
    if (suppliedVerificationAcceptance.length === 0 && readbackOnlyScope) {
      const qualityGate = policyQuality?.qualityGate ?? buildReadbackOnlyQualityGate(changedPaths);
      const feedbackForAI = [policyQuality?.feedbackForAI, formatReadbackOnlyFeedback(changedPaths)]
        .filter(Boolean)
        .join('\n\n');
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: qualityGateStatusToValidationState(qualityGate.status),
        evidenceOperationId,
        verificationScopePaths: changedPaths,
        title: policyQualityTitle ?? '文件读回验证通过',
        detail: projectDiagnosticOutputExcerpt(feedbackForAI, 1200),
      });
      await emitAutoValidationQualityGateStatus(callbacks, evidenceOperationId, changedPaths, qualityGate);
      const settled: AgentAutoValidationResult = {
        evidenceOperationId,
        ...(qualityGate.status === 'pass' ? { evidence: buildReadbackOnlyEvidence(changedPaths) } : {}),
        feedbackForAI,
        qualityGate,
      };
      return settleAgentAutoValidation(settled, execution);
    }
    const canonicalCommandRunner = callbacks.canonicalToolAuthority && callbacks.canonicalToolExecution
      ? new CanonicalValidationCommandRunner(
          callbacks.onValidationCommand,
          callbacks.canonicalToolAuthority,
          callbacks.canonicalToolExecution,
          changedPaths,
        )
      : undefined;
    const validationService = options.validationService ?? new ValidationService({
      commandRunner: canonicalCommandRunner?.run ?? callbacks.onValidationCommand,
      ...(policyCheckId ? {
        hostChecks: {
          [policyCheckId]: async () => ({
            status: policyQuality?.qualityGate?.status === 'fail' ? 'failed' : 'unavailable',
            summary: policyQuality?.qualityGate?.summary ?? 'Policy quality check is unavailable.',
            evidenceRefs: policyQuality?.qualityGate?.evidenceRefs
              ?? [`host-check:${policyCheckId}:unavailable`],
          }),
        },
      } : {}),
    });
    const ports = options.verificationPorts ?? (
      callbacks.canonicalVerifierSelection
      && callbacks.canonicalBuildOrchestration
      && callbacks.canonicalRegressionSelection
      && callbacks.canonicalVerification
      && callbacks.canonicalDiagnostics
        ? {
            selection: callbacks.canonicalVerifierSelection,
            orchestration: callbacks.canonicalBuildOrchestration,
            regressionSelection: callbacks.canonicalRegressionSelection,
            verification: callbacks.canonicalVerification,
            diagnostics: callbacks.canonicalDiagnostics,
          }
        : undefined
    );
    if (!ports) throw new Error('Canonical verifier selection and build orchestration ports are unavailable.');
    const adapter = options.verificationAdapter ?? new VsCodeVerificationAdapter(validationService);
    execution = await adapter.verify({
      runId: verificationContext.runId,
      sequence: verificationContext.sequence,
      actionId: verificationContext.actionId,
      workspaceRoot: workspaceRootFsPath,
      scopePaths: verificationContext.scopePaths,
      acceptance: verificationContext.acceptance,
      evidenceRefs: verificationContext.evidenceRefs,
      ...(policyCheckId ? {
        hostChecks: [{
          id: policyCheckId,
          evidenceRefs: policyQuality?.qualityGate?.evidenceRefs ?? [`host-check:${policyCheckId}`],
        }],
      } : {}),
      ...(canonicalCommandRunner ? {
        resolveActionIdentity: () => canonicalCommandRunner.latestActionIdentity(),
      } : {}),
    }, ports);
    const result = projectAutoValidationResult(execution.selection, execution.orchestration);
    if (!result) {
      const unavailableQuality = policyQuality?.qualityGate ?? {
        status: 'blocked' as const,
        summary: 'No applicable automatic verifier was available.',
        risks: ['The changed scope has no configured project or language verifier.'],
        evidenceRefs: verificationContext.evidenceRefs,
        alternativeChecks: ['Configure devseek.verify.json or a project test script.'],
        requiredActions: ['Add an applicable verifier and run verification again.'],
      };
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: qualityGateStatusToValidationState(policyQuality?.qualityGate?.status),
        evidenceOperationId,
        verificationScopePaths: changedPaths,
        title: policyQualityTitle ?? '未识别到自动验证目标',
        detail: projectDiagnosticOutputExcerpt(
          [changedPaths.join('\n'), policyQuality?.feedbackForAI].filter(Boolean).join('\n\n'),
          1200,
        ),
      });
      await emitAutoValidationQualityGateStatus(callbacks, evidenceOperationId, changedPaths, unavailableQuality);
      const settled = {
        evidenceOperationId,
        feedbackForAI: policyQuality?.feedbackForAI ?? unavailableQuality.summary,
        qualityGate: unavailableQuality,
      };
      return settleAgentAutoValidation(settled, execution);
    }
    const verification = normalizeVerificationResult(result);
    if (!shouldEmitTerminalEvidenceForVerification(verification)) {
      const feedbackForAI = formatBlockedAutoValidationFeedback(result);
      const qualityGate = policyQuality?.qualityGate ?? buildAutoValidationQualityGate(result, changedPaths);
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: policyQuality
          ? qualityGateStatusToValidationState(policyQuality.qualityGate?.status)
          : 'skipped',
        evidenceOperationId,
        verificationScopePaths: changedPaths,
        title: policyQualityTitle ?? '自动验证阻塞',
        detail: projectDiagnosticOutputExcerpt(
          [feedbackForAI, policyQuality?.feedbackForAI].filter(Boolean).join('\n\n'),
          1200,
        ),
      });
      await emitAutoValidationQualityGateStatus(callbacks, evidenceOperationId, changedPaths, qualityGate);
      const settled = {
        evidenceOperationId,
        feedbackForAI: [feedbackForAI, policyQuality?.feedbackForAI].filter(Boolean).join('\n\n'),
        qualityGate,
      };
      return settleAgentAutoValidation(settled, execution);
    }
    callbacks.onToolActivity?.('terminal', `自动验证: ${result.command}`);
    const feedbackForAI = formatAutoValidationFeedback(result, changedPaths);
    const finalFeedbackForAI = [feedbackForAI, policyQuality?.feedbackForAI]
      .filter(Boolean)
      .join('\n\n');
    const finalQualityGate = policyQuality?.qualityGate ?? buildAutoValidationQualityGate(result, changedPaths);
    const validationPassed = verificationResultIsCompletionCandidate(verification) && !policyQuality;
    const evidence = validationResultToTerminalEvidence(result);
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: validationPassed ? 'completed' : qualityGateStatusToValidationState(finalQualityGate.status),
      evidenceOperationId,
      verificationScopePaths: changedPaths,
      title: validationPassed
        ? '自动验证通过'
        : policyQuality
          ? policyQualityTitle ?? '需求质量门禁未通过'
          : '自动验证失败',
      detail: projectDiagnosticOutputExcerpt(finalFeedbackForAI, 1200),
    });
    await emitAutoValidationQualityGateStatus(callbacks, evidenceOperationId, changedPaths, finalQualityGate);
    const settled = {
      evidenceOperationId,
      ...(evidence ? { evidence } : {}),
      feedbackForAI: finalFeedbackForAI,
      qualityGate: finalQualityGate,
    };
    return settleAgentAutoValidation(settled, execution);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'failed',
      evidenceOperationId,
      verificationScopePaths: changedPaths,
      title: '自动验证异常',
      detail: message,
    });
    const settled: AgentAutoValidationResult = {
      evidenceOperationId,
      evidence: {
        command: 'automatic workspace validation',
        kind: 'other',
        ok: false,
        exitCode: null,
        detail: `自动验证异常：${message}`,
      },
      feedbackForAI: `自动验证异常：${message}\n自动验证命令未通过，不能把编译/运行/测试标记为完成。`,
    };
    return settleAgentAutoValidation(settled, execution);
  }
}

function settleAgentAutoValidation(
  result: AgentAutoValidationResult,
  execution: VsCodeVerificationExecution | undefined,
): AgentAutoValidationResult {
  return execution
    ? { ...result, verificationReceipt: execution.outcome.receipt }
    : result;
}
