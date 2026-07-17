import * as vscode from 'vscode';
import * as crypto from 'crypto';
import {
  createDevSeekTraceLogger,
  PRODUCT_RUNTIME_OBSERVATION_TRUST,
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type RunEvidenceJson,
} from '@devseek-netai/shared';
import { decideTerminalCommandPermission, type TerminalCommandRiskClass } from './terminal-command-policy';
import { buildToolPolicy, decideToolPermission, type ToolPolicy } from './permission-service';
import { shouldUseManualReviewLaunchMode } from './terminal-launch-classifier';
import {
  createDevSeekRunContext,
  type DevSeekRunContext,
  type RunContextStatus,
} from './run-context';
import type { ExecutionMode } from '../intent/intent-types';
import type { ValidationCommandRunner } from '../workspace/validation-service';
import {
  cleanupLegacyCppBuildDirsForCommand,
  normalizeLegacyCppBuildCommandForRun,
} from '../workspace/cpp-build-cleanup-service';

type TerminalConfirmResolver = (allow: boolean, alwaysAllow?: boolean) => void;

export interface TerminalConfirmationResult {
  allow: boolean;
  alwaysAllow?: boolean;
  reason?: string;
}

export interface RunTerminalWithPermissionInput {
  webview?: vscode.Webview;
  command: string;
  workdir?: string;
  workspaceRoot?: string;
  mode: string;
  toolPolicy: ToolPolicy;
  traceRunId?: string;
  traceEvidenceParticipantToken?: string;
  onTraceEvidenceError?: (error: unknown) => void;
  /** True only when this exact command was explicitly accepted in a user-owned input surface. */
  userConfirmed?: boolean;
  /** True only when the product execution policy explicitly authorizes this exact command. */
  policyPreauthorized?: boolean;
  forceConfirmation?: boolean;
  onAlwaysAllow?: () => void | Promise<void>;
  presentation?: 'captured' | 'visible';
  terminalName?: string;
  reuseTerminal?: boolean;
  timeoutMs?: number;
  executionProfile?: 'interactive' | 'validation';
  /** The caller owns explicit recovery evidence for this command attempt. */
  manageRecoveryExternally?: boolean;
  /** Correlates this retry side effect with a previously detected recovery. */
  recoveryOperationId?: string;
}

export interface RunOwnedTerminalWithPermissionInput {
  command: string;
  workdir?: string;
  workspaceRoot: string;
  mode: ExecutionMode;
  source: string;
  webview?: vscode.Webview;
  userConfirmed?: boolean;
  policyPreauthorized?: boolean;
  presentation?: 'captured' | 'visible';
  terminalName?: string;
  reuseTerminal?: boolean;
  timeoutMs?: number;
  runId?: string;
}

export interface OwnedTerminalCommandResult {
  output: string;
  outcome: TerminalCommandOutcome;
  settlementStatus: RunContextStatus;
  runId: string;
  operationId: string;
}

interface TerminalRunEvidenceContext {
  operationId: string;
  session?: ProductRunEvidenceSession;
}

export type TerminalCommandOutcome = 'committed' | 'failed' | 'indeterminate';

export interface TerminalCommandExecutionResult {
  output: string;
  outcome: TerminalCommandOutcome;
  operationId: string;
  executed: boolean;
  executionOutput?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  reviewRequired?: boolean;
}

export interface TerminalCommandRecoveryInput {
  workspaceRoot: string;
  runId: string;
  traceEvidenceParticipantToken: string;
  targetOperationIds: string[];
  onTraceEvidenceError?: (error: unknown) => void;
}

export interface FinishTerminalCommandRecoveryInput extends TerminalCommandRecoveryInput {
  recoveryOperationId: string;
  status: 'completed' | 'failed';
  verificationOperationId?: string;
  reason?: string;
}

export type ResolveTerminalCommandRecoveryInput = Omit<TerminalCommandRecoveryInput, 'targetOperationIds'>;

export interface ValidationCommandAuthorityInput {
  webview?: vscode.Webview;
  workspaceRoot: string;
  mode: string;
  toolPolicy: ToolPolicy;
  traceRunId: string;
  traceEvidenceParticipantToken: string;
  onTraceEvidenceError?: (error: unknown) => void;
}

export class TerminalPermissionCoordinator {
  private readonly pendingConfirms = new Map<string, TerminalConfirmResolver>();
  private readonly trustedRiskClasses = new Set<TerminalCommandRiskClass>();
  private readonly adverseCommandOperationsByRun = new Map<string, Set<string>>();
  private readonly activeCommandRecoveryByRun = new Map<string, {
    operationId: string;
    targetOperationIds: string[];
  }>();

  requestInlineConfirmation(
    webview: vscode.Webview,
    command: string,
    workdir = '',
    timeoutMs = 60000,
  ): Promise<TerminalConfirmationResult> {
    const confirmId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    return new Promise((resolve) => {
      this.pendingConfirms.set(confirmId, (allow, alwaysAllow) => resolve({ allow, alwaysAllow }));
      webview.postMessage({ type: 'terminalConfirm', command, workdir, confirmId });
      setTimeout(() => {
        if (this.pendingConfirms.delete(confirmId)) {
          resolve({ allow: false, reason: '您未在 60 秒内确认，命令未执行。' });
        }
      }, timeoutMs);
    });
  }

  handleConfirmReply(confirmId: string, allow: boolean, alwaysAllow?: boolean): boolean {
    const resolve = this.pendingConfirms.get(confirmId);
    if (!resolve) return false;
    this.pendingConfirms.delete(confirmId);
    resolve(allow, alwaysAllow);
    return true;
  }

  beginCommandRecovery(input: TerminalCommandRecoveryInput): string {
    const recoveryOperationId = `vscode-terminal-recovery-${crypto.randomUUID()}`;
    const session = attachTerminalRecoveryEvidence(input);
    if (!session || !recordTerminalRecoveryEvidence(session, input, 'recovery.detected', recoveryOperationId, {
      target_operation_ids: [...new Set(input.targetOperationIds)],
    })) {
      throw new Error('Terminal recovery evidence could not be durably detected');
    }
    return recoveryOperationId;
  }

  finishCommandRecovery(input: FinishTerminalCommandRecoveryInput): boolean {
    const session = attachTerminalRecoveryEvidence(input);
    if (!session) return false;
    if (input.status === 'completed') {
      const verificationOperationId = input.verificationOperationId?.trim();
      if (!verificationOperationId || !hasStrictRecoveryProof(session, input, verificationOperationId)) {
        reportTerminalEvidenceError(input, new Error(
          'Terminal recovery completion requires adverse < detected < correlated mutation lifecycle < matching verification < quality gate',
        ));
        return false;
      }
    }
    return recordTerminalRecoveryEvidence(
      session,
      input,
      input.status === 'completed' ? 'recovery.completed' : 'recovery.failed',
      input.recoveryOperationId,
      input.status === 'completed'
        ? {
            resolves_operation_ids: [...new Set(input.targetOperationIds)],
            verification_operation_id: input.verificationOperationId!,
          }
        : { reason: input.reason ?? 'terminal-retry-failed' },
    );
  }

  /**
   * Resolve coordinator-owned failures only after replay proves that a later,
   * captured terminal command committed and its verification/quality gate passed.
   * Merely dispatching a repair command is deliberately insufficient.
   */
  resolveCommandFailuresAfterQualityGate(input: ResolveTerminalCommandRecoveryInput): boolean {
    const tracked = this.adverseCommandOperationsByRun.get(input.runId);
    if (!tracked || tracked.size === 0) return false;
    const activeRecovery = this.activeCommandRecoveryByRun.get(input.runId);
    if (!activeRecovery) return false;
    const recoveryInput = { ...input, targetOperationIds: activeRecovery.targetOperationIds };
    const session = attachTerminalRecoveryEvidence(recoveryInput);
    if (!session) return false;
    try {
      const events = session.readEvents();
      const alreadyResolved = new Set<string>();
      for (const event of events) {
        if (event.type !== 'recovery.completed') continue;
        const payload = evidencePayloadObject(event.payload);
        const resolved = payload?.resolves_operation_ids;
        if (!Array.isArray(resolved)) continue;
        for (const operationId of resolved) {
          if (typeof operationId === 'string') alreadyResolved.add(operationId);
        }
      }

      const targetOperationIds = activeRecovery.targetOperationIds.filter(operationId => !alreadyResolved.has(operationId));
      if (targetOperationIds.length === 0) {
        this.adverseCommandOperationsByRun.delete(input.runId);
        this.activeCommandRecoveryByRun.delete(input.runId);
        return true;
      }
      const verificationOperationIds = events
        .filter(event => event.type === 'quality_gate.passed')
        .map(event => evidencePayloadObject(event.payload)?.operation_id)
        .filter((operationId): operationId is string => typeof operationId === 'string')
        .reverse();
      const verificationOperationId = verificationOperationIds.find(operationId => (
        hasStrictRecoveryProof(session, {
          ...recoveryInput,
          targetOperationIds,
          recoveryOperationId: activeRecovery.operationId,
          status: 'completed',
        }, operationId)
      ));
      if (!verificationOperationId) return false;
      if (!this.finishCommandRecovery({
        ...recoveryInput,
        targetOperationIds,
        recoveryOperationId: activeRecovery.operationId,
        status: 'completed',
        verificationOperationId,
        reason: 'captured-terminal-retry-and-quality-gate-passed',
      })) return false;
      this.adverseCommandOperationsByRun.delete(input.runId);
      this.activeCommandRecoveryByRun.delete(input.runId);
      return true;
    } catch (error) {
      reportTerminalEvidenceError(input, error);
      return false;
    }
  }

  forgetRun(runId: string): void {
    this.adverseCommandOperationsByRun.delete(runId);
    this.activeCommandRecoveryByRun.delete(runId);
  }

  hasPendingCommandFailures(runId: string): boolean {
    return (this.adverseCommandOperationsByRun.get(runId)?.size ?? 0) > 0;
  }

  completeRunContext(
    runContext: DevSeekRunContext,
    requestedStatus: RunContextStatus,
    data: Record<string, unknown> = {},
  ): RunContextStatus {
    let status = requestedStatus;
    let completionData = data;
    if (
      requestedStatus === 'completed'
      && this.hasPendingCommandFailures(runContext.runId)
      && !this.resolveCommandFailuresAfterQualityGate({
        workspaceRoot: runContext.workspaceRoot,
        runId: runContext.runId,
        traceEvidenceParticipantToken: runContext.evidenceParticipantToken,
        onTraceEvidenceError: error => runContext.markEvidenceDegraded(error),
      })
    ) {
      status = 'failed';
      completionData = {
        ...data,
        reason: 'unresolved-terminal-failure',
        requestedStatus,
      };
    }
    status = runContext.complete(status, completionData);
    this.forgetRun(runContext.runId);
    return status;
  }

  createValidationCommandRunner(input: ValidationCommandAuthorityInput): ValidationCommandRunner {
    return async invocation => {
      try {
        const result = await this.runCommandWithPermissionDetailed({
          ...input,
          command: invocation.command,
          workdir: invocation.cwd,
          timeoutMs: invocation.timeoutMs,
          policyPreauthorized: true,
          presentation: 'captured',
          executionProfile: 'validation',
        });
        recordTerminalValidationLifecycle(input, invocation, result);
        return {
          ran: result.executed,
          ok: result.outcome === 'committed',
          command: invocation.command,
          exitCode: result.exitCode ?? null,
          stdout: result.stdout ?? '',
          stderr: result.stderr ?? '',
          output: result.executionOutput ?? result.output,
          cwd: invocation.cwd,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ran: true,
          ok: false,
          command: invocation.command,
          exitCode: null,
          stdout: '',
          stderr: message,
          output: message,
          cwd: invocation.cwd,
        };
      }
    };
  }

  async runCommandWithPermission(input: RunTerminalWithPermissionInput): Promise<string> {
    return (await this.runCommandWithPermissionDetailed(input)).output;
  }

  async runOwnedCommandWithPermission(
    input: RunOwnedTerminalWithPermissionInput,
  ): Promise<OwnedTerminalCommandResult> {
    const runContext = createDevSeekRunContext({
      workspaceRoot: input.workspaceRoot,
      source: input.source,
      userPrompt: input.command,
      mode: input.mode,
      runId: input.runId,
      traceLevel: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
    });

    try {
      const result = await this.runCommandWithPermissionDetailed({
        ...input,
        toolPolicy: buildToolPolicy(input.mode),
        traceRunId: runContext.runId,
        traceEvidenceParticipantToken: runContext.evidenceParticipantToken,
        onTraceEvidenceError: error => runContext.markEvidenceDegraded(error),
      });
      const settlementStatus = this.completeRunContext(
        runContext,
        result.outcome === 'committed'
          ? 'completed'
          : result.outcome === 'indeterminate'
            ? 'cancelled'
            : 'failed',
        { terminalOutcome: result.outcome },
      );
      return { ...result, settlementStatus, runId: runContext.runId };
    } catch (error) {
      this.completeRunContext(runContext, 'failed', { reason: 'terminal-execution-error' });
      throw error;
    }
  }

  async runCommandWithPermissionDetailed(
    input: RunTerminalWithPermissionInput,
  ): Promise<TerminalCommandExecutionResult> {
    input = this.attachPendingRecoveryToCommand(input);
    const { webview, command, workdir, workspaceRoot, mode, toolPolicy, traceRunId } = input;
    const normalizedCommand = normalizeLegacyCppBuildCommandForRun({ command, workdir, workspaceRoot }).command;
    const runEvidence = attachTerminalRunEvidence(input);
    recordTerminalRunEvidence(runEvidence, input, 'side_effect.requested', {
      command: summarizeTraceText(normalizedCommand),
      workdir: workdir ?? null,
      mode,
    });
    const trace = traceRunId && workspaceRoot
      ? createDevSeekTraceLogger({
          workspaceRoot,
          source: 'vscode-extension.terminal',
          level: vscode.workspace.getConfiguration('devseek').get<string>('traceLevel', 'debug'),
          runId: traceRunId,
        })
      : undefined;
    trace?.info('terminal', 'command-requested', {
      command: summarizeTraceText(normalizedCommand),
      workdir,
      mode,
    });
    const terminalPermission = decideToolPermission(toolPolicy, 'terminal');
    if (terminalPermission.action === 'deny') {
      recordTerminalRunEvidence(runEvidence, input, 'side_effect.failed', {
        reason: terminalPermission.reason,
        failure_phase: 'policy',
        execution_started: false,
      });
      this.trackAdverseCommandOperation(input, runEvidence.operationId);
      trace?.info('terminal', 'command-skipped', {
        reason: terminalPermission.reason,
        command: summarizeTraceText(normalizedCommand),
        workdir,
      });
      return {
        output: `（命令未执行：当前 ${mode} 模式不允许终端工具：${terminalPermission.reason}）`,
        outcome: 'failed',
        operationId: runEvidence.operationId,
        executed: false,
      };
    }

    const terminalDecision = decideTerminalCommandPermission({
      command: normalizedCommand,
      workdir,
      workspaceRoot,
    });
    const isAutopilot = vscode.workspace.getConfiguration('devseek').get<boolean>('autopilotMode', false);
    const remembered = terminalDecision.canRememberDecision && this.trustedRiskClasses.has(terminalDecision.risk);
    let confirmedByUser = input.userConfirmed === true;
    const preauthorizedByPolicy = input.policyPreauthorized === true;

    if (
      !isAutopilot
      && terminalPermission.action === 'requireConfirm'
      && (terminalDecision.requiresConfirmation || input.forceConfirmation === true)
      && !remembered
      && !confirmedByUser
      && !preauthorizedByPolicy
    ) {
      const confirmResult = webview
        ? await this.requestInlineConfirmation(webview, normalizedCommand, workdir ?? '')
        : { allow: false, reason: '当前入口无法展示命令确认，命令未执行。' };
      if (confirmResult.alwaysAllow && terminalDecision.canRememberDecision) {
        this.trustedRiskClasses.add(terminalDecision.risk);
      }
      if (confirmResult.alwaysAllow) await input.onAlwaysAllow?.();
      if (!confirmResult.allow) {
        recordTerminalRunEvidence(runEvidence, input, 'side_effect.failed', {
          reason: confirmResult.reason ?? '用户拒绝',
          failure_phase: 'confirmation',
          execution_started: false,
        });
        this.trackAdverseCommandOperation(input, runEvidence.operationId);
        trace?.info('terminal', 'command-skipped', {
          reason: confirmResult.reason ?? '用户拒绝',
          command: summarizeTraceText(normalizedCommand),
          workdir,
        });
        return {
          output: `（命令未执行：${confirmResult.reason ?? '用户拒绝'}）`,
          outcome: 'failed',
          operationId: runEvidence.operationId,
          executed: false,
        };
      }
      confirmedByUser = true;
    }

    recordTerminalRunEvidence(runEvidence, input, 'side_effect.authorized', {
      authorization: confirmedByUser
        ? 'user-confirmed'
        : remembered
          ? 'remembered-user-confirmation'
          : preauthorizedByPolicy
            ? 'execution-policy-preauthorized'
          : 'tool-policy',
      risk: terminalDecision.risk,
    });
    recordTerminalRunEvidence(runEvidence, input, 'side_effect.started', {
      risk: terminalDecision.risk,
    });

    if (input.presentation === 'visible') {
      try {
        cleanupLegacyCppBuildDirsForCommand({ command: normalizedCommand, workdir, workspaceRoot });
        const terminalName = input.terminalName ?? 'DevSeek Run';
        const terminal = (input.reuseTerminal
          ? vscode.window.terminals.find(candidate => candidate.name === terminalName)
          : undefined) ?? vscode.window.createTerminal({
            name: terminalName,
            cwd: workdir || undefined,
          });
        terminal.show(true);
        terminal.sendText(normalizedCommand);
      } catch (error) {
        try {
          recordTerminalRunEvidence(runEvidence, input, 'side_effect.indeterminate', {
            reason: error instanceof Error ? error.message : String(error),
            failure_phase: 'visible-terminal-launch',
            execution_started: true,
          });
        } finally {
          this.trackAdverseCommandOperation(input, runEvidence.operationId);
        }
        throw error;
      }
      try {
        recordTerminalRunEvidence(runEvidence, input, 'side_effect.indeterminate', {
          reason: 'visible-terminal-exit-is-not-observable-by-extension-host',
          failure_phase: 'manual-observation-required',
          execution_started: true,
        });
      } finally {
        this.trackAdverseCommandOperation(input, runEvidence.operationId);
      }
      return {
        output: `（命令已发送到可见终端；退出状态需要人工观察：${normalizedCommand}）`,
        outcome: 'indeterminate',
        operationId: runEvidence.operationId,
        executed: true,
        exitCode: null,
        reviewRequired: true,
      };
    }

    let terminalTools: typeof import('../tools/terminal');
    let result: Awaited<ReturnType<typeof import('../tools/terminal')['runCommand']>>;
    try {
      terminalTools = await import('../tools/terminal');
      const manualReviewOnLongRunning = shouldUseManualReviewLaunchMode({ command: normalizedCommand, workdir, workspaceRoot });
      cleanupLegacyCppBuildDirsForCommand({ command, workdir, workspaceRoot });
      result = await terminalTools.runCommand({
        command: normalizedCommand,
        cwd: workdir,
        timeoutMs: input.timeoutMs,
        visible: false,
        allowRisky: confirmedByUser || remembered,
        manualReviewOnLongRunning,
        executionProfile: input.executionProfile,
      });
    } catch (error) {
      try {
        recordTerminalRunEvidence(runEvidence, input, 'side_effect.indeterminate', {
          reason: error instanceof Error ? error.message : String(error),
          failure_phase: 'execution',
          execution_started: true,
        });
      } finally {
        this.trackAdverseCommandOperation(input, runEvidence.operationId);
      }
      throw error;
    }

    const terminalEvidenceType = result.reviewRequired || result.exitCode === null
      ? 'side_effect.indeterminate'
      : result.ok
        ? 'side_effect.committed'
        : 'side_effect.failed';
    try {
      recordTerminalRunEvidence(runEvidence, input, terminalEvidenceType, {
        exit_code: result.exitCode,
        review_required: result.reviewRequired === true,
        output: summarizeTraceText(result.output),
      });
    } catch (error) {
      if (terminalEvidenceType === 'side_effect.committed') {
        try {
          recordTerminalRunEvidence(runEvidence, input, 'side_effect.indeterminate', {
            failure_phase: 'terminal-evidence',
            execution_started: true,
            reason: 'committed terminal evidence could not be durably appended',
          });
        } catch {
          // The degradation callback already records that even the fail-closed
          // terminal marker was unavailable.
        }
      }
      this.trackAdverseCommandOperation(input, runEvidence.operationId);
      throw error;
    }
    if (terminalEvidenceType !== 'side_effect.committed') {
      this.trackAdverseCommandOperation(input, runEvidence.operationId);
    }
    const outputPreview = result.output.slice(0, 4000);
    trace?.info('terminal', 'command-complete', {
      command: summarizeTraceText(normalizedCommand),
      workdir,
      exitCode: result.exitCode,
      output: summarizeTraceText(outputPreview),
    });
    trace?.payload('terminal', 'terminal.output', outputPreview);
    webview?.postMessage({
      type: 'terminalRanNotice',
      command: normalizedCommand,
      workdir: workdir ?? '',
      exitCode: result.exitCode,
      output: outputPreview,
    });
    return {
      output: terminalTools.formatTerminalOutputForPrompt(normalizedCommand, result),
      outcome: terminalEvidenceType === 'side_effect.committed'
        ? 'committed'
        : terminalEvidenceType === 'side_effect.indeterminate'
          ? 'indeterminate'
          : 'failed',
      operationId: runEvidence.operationId,
      executed: true,
      executionOutput: result.output,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      reviewRequired: result.reviewRequired === true,
    };
  }

  private trackAdverseCommandOperation(input: RunTerminalWithPermissionInput, operationId: string): void {
    const runId = input.traceRunId?.trim();
    if (!runId || input.manageRecoveryExternally === true) return;
    const recovery = this.activeCommandRecoveryByRun.get(runId);
    if (recovery && input.recoveryOperationId === recovery.operationId) {
      this.finishCommandRecovery({
        workspaceRoot: input.workspaceRoot ?? '',
        runId,
        traceEvidenceParticipantToken: input.traceEvidenceParticipantToken ?? '',
        targetOperationIds: recovery.targetOperationIds,
        recoveryOperationId: recovery.operationId,
        status: 'failed',
        reason: 'terminal-retry-failed-or-indeterminate',
        onTraceEvidenceError: input.onTraceEvidenceError,
      });
      this.activeCommandRecoveryByRun.delete(runId);
    }
    const operations = this.adverseCommandOperationsByRun.get(runId) ?? new Set<string>();
    operations.add(operationId);
    this.adverseCommandOperationsByRun.set(runId, operations);
  }

  private attachPendingRecoveryToCommand(input: RunTerminalWithPermissionInput): RunTerminalWithPermissionInput {
    if (input.manageRecoveryExternally === true || input.recoveryOperationId) return input;
    const runId = input.traceRunId?.trim();
    if (!runId) return input;
    const tracked = this.adverseCommandOperationsByRun.get(runId);
    if (!tracked || tracked.size === 0) return input;
    let recovery = this.activeCommandRecoveryByRun.get(runId);
    if (!recovery) {
      const targetOperationIds = [...tracked];
      recovery = {
        operationId: this.beginCommandRecovery({
          workspaceRoot: input.workspaceRoot ?? '',
          runId,
          traceEvidenceParticipantToken: input.traceEvidenceParticipantToken ?? '',
          targetOperationIds,
          onTraceEvidenceError: input.onTraceEvidenceError,
        }),
        targetOperationIds,
      };
      this.activeCommandRecoveryByRun.set(runId, recovery);
    }
    return { ...input, recoveryOperationId: recovery.operationId };
  }
}

function recordTerminalValidationLifecycle(
  input: ValidationCommandAuthorityInput,
  invocation: Parameters<ValidationCommandRunner>[0],
  result: TerminalCommandExecutionResult,
): void {
  const operationId = result.operationId;
  if (!operationId) return;
  const terminalState = result.outcome === 'committed' ? 'completed' : 'failed';
  const gateTerminalType = result.outcome === 'committed' ? 'quality_gate.passed' : 'quality_gate.failed';
  const gateTerminalStatus = result.outcome === 'committed' ? 'passed' : 'failed';
  const details = {
    command: summarizeTraceText(invocation.command),
    cwd: invocation.cwd,
    exit_code: result.exitCode ?? null,
    output: summarizeTraceText(result.executionOutput ?? result.output),
  };
  recordTerminalValidationEvidence(input, operationId, 'verification.started', {
    ...details,
    status: 'started',
  });
  recordTerminalValidationEvidence(input, operationId, terminalState === 'completed'
    ? 'verification.completed'
    : 'verification.failed', {
    ...details,
    status: terminalState,
  });
  recordTerminalValidationEvidence(input, operationId, 'quality_gate.started', {
    ...details,
    status: 'started',
  });
  recordTerminalValidationEvidence(input, operationId, gateTerminalType, {
    ...details,
    status: gateTerminalStatus,
  });
}

function recordTerminalValidationEvidence(
  input: ValidationCommandAuthorityInput,
  operationId: string,
  type: 'verification.started'
    | 'verification.completed'
    | 'verification.failed'
    | 'quality_gate.started'
    | 'quality_gate.passed'
    | 'quality_gate.failed',
  details: Record<string, RunEvidenceJson>,
): void {
  try {
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot: input.workspaceRoot,
      runId: input.traceRunId,
      surface: 'vscode-terminal',
      authority: { role: 'participant', token: input.traceEvidenceParticipantToken },
    });
    session.record({
      type,
      idempotencyKey: productRunEvidenceIdempotencyKey(`vscode-terminal-${type}`, {
        runId: input.traceRunId,
        operationId,
      }),
      payload: {
        operation_id: operationId,
        boundary: 'vscode-terminal-validation-runner',
        trust: PRODUCT_RUNTIME_OBSERVATION_TRUST,
        ...details,
      },
    });
  } catch (error) {
    reportTerminalEvidenceError(input, error);
  }
}

function evidencePayloadObject(payload: RunEvidenceJson): Record<string, RunEvidenceJson> | undefined {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload
    : undefined;
}

function attachTerminalRunEvidence(input: RunTerminalWithPermissionInput): TerminalRunEvidenceContext {
  const operationId = `vscode-terminal-${crypto.randomUUID()}`;
  const runId = input.traceRunId?.trim();
  const workspaceRoot = input.workspaceRoot?.trim();
  if (!runId || !workspaceRoot) {
    const error = new Error('Terminal mutation requires an owned run id and workspace evidence root');
    reportTerminalEvidenceError(input, error);
    throw error;
  }

  const participantToken = input.traceEvidenceParticipantToken?.trim();
  if (!participantToken) {
    const error = new Error('Run evidence participant authority is missing');
    reportTerminalEvidenceError(input, error);
    throw error;
  }

  try {
    return {
      operationId,
      session: ProductRunEvidenceSession.forWorkspace({
        workspaceRoot,
        runId,
        surface: 'vscode-terminal',
        authority: { role: 'participant', token: participantToken },
      }),
    };
  } catch (error) {
    reportTerminalEvidenceError(input, error);
    throw error;
  }
}

function recordTerminalRunEvidence(
  context: TerminalRunEvidenceContext,
  input: RunTerminalWithPermissionInput,
  type: 'side_effect.requested'
    | 'side_effect.authorized'
    | 'side_effect.started'
    | 'side_effect.committed'
    | 'side_effect.failed'
    | 'side_effect.indeterminate',
  details: Record<string, RunEvidenceJson>,
): void {
  if (!context.session) {
    const error = new Error('Terminal mutation evidence session is unavailable');
    reportTerminalEvidenceError(input, error);
    throw error;
  }
  try {
    context.session.record({
      type,
      idempotencyKey: productRunEvidenceIdempotencyKey(`vscode-terminal-${type}`, {
        runId: context.session.runId,
        operationId: context.operationId,
      }),
      payload: {
        operation_id: context.operationId,
        boundary: 'vscode-terminal-coordinator',
        status: type.slice('side_effect.'.length),
        trust: PRODUCT_RUNTIME_OBSERVATION_TRUST,
        ...(input.recoveryOperationId ? { recovery_operation_id: input.recoveryOperationId } : {}),
        ...details,
      },
    });
  } catch (error) {
    reportTerminalEvidenceError(input, error);
    throw error;
  }
}

function attachTerminalRecoveryEvidence(
  input: TerminalCommandRecoveryInput,
): ProductRunEvidenceSession | undefined {
  if (input.targetOperationIds.length === 0) {
    reportTerminalEvidenceError(input, new Error('Terminal recovery requires at least one adverse operation'));
    return undefined;
  }
  try {
    return ProductRunEvidenceSession.forWorkspace({
      workspaceRoot: input.workspaceRoot,
      runId: input.runId,
      surface: 'vscode-terminal',
      authority: { role: 'participant', token: input.traceEvidenceParticipantToken },
    });
  } catch (error) {
    reportTerminalEvidenceError(input, error);
    return undefined;
  }
}

function recordTerminalRecoveryEvidence(
  session: ProductRunEvidenceSession | undefined,
  input: TerminalCommandRecoveryInput,
  type: 'recovery.detected' | 'recovery.completed' | 'recovery.failed',
  recoveryOperationId: string,
  details: Record<string, RunEvidenceJson>,
): boolean {
  if (!session) return false;
  try {
    session.record({
      type,
      idempotencyKey: productRunEvidenceIdempotencyKey(`vscode-terminal-${type}`, {
        runId: session.runId,
        recoveryOperationId,
      }),
      payload: {
        operation_id: recoveryOperationId,
        boundary: 'vscode-terminal-coordinator',
        status: type.slice('recovery.'.length),
        trust: PRODUCT_RUNTIME_OBSERVATION_TRUST,
        ...details,
      },
    });
    return true;
  } catch (error) {
    reportTerminalEvidenceError(input, error);
    return false;
  }
}

function hasStrictRecoveryProof(
  session: ProductRunEvidenceSession,
  input: FinishTerminalCommandRecoveryInput,
  verificationOperationId: string,
): boolean {
  const events = session.readEvents();
  const detected = events.find(event => (
    event.type === 'recovery.detected'
    && evidencePayloadObject(event.payload)?.operation_id === input.recoveryOperationId
  ));
  if (!detected) return false;
  const targetSet = new Set(input.targetOperationIds);
  if (targetSet.size === 0) return false;
  const adverseBeforeDetection = new Set(events
    .filter(event => (
      event.sequence < detected.sequence
      && (event.type === 'side_effect.failed' || event.type === 'side_effect.indeterminate')
    ))
    .map(event => evidencePayloadObject(event.payload)?.operation_id)
    .filter((operationId): operationId is string => typeof operationId === 'string'));
  if ([...targetSet].some(operationId => !adverseBeforeDetection.has(operationId))) return false;

  const verificationStarted = events.find(event => (
    event.type === 'verification.started'
    && evidencePayloadObject(event.payload)?.operation_id === verificationOperationId
  ));
  if (!verificationStarted) return false;
  const verification = events.find(event => (
    event.type === 'verification.completed'
    && event.sequence > verificationStarted.sequence
    && evidencePayloadObject(event.payload)?.operation_id === verificationOperationId
  ));
  if (!verification) return false;
  const hasOrderedRecoveryCommand = events.some(commit => {
    const commitPayload = evidencePayloadObject(commit.payload);
    if (
      commit.type !== 'side_effect.committed'
      || commitPayload?.recovery_operation_id !== input.recoveryOperationId
      || typeof commitPayload.operation_id !== 'string'
    ) return false;
    const lifecycle = ['side_effect.requested', 'side_effect.authorized', 'side_effect.started']
      .map(type => events.find(event => {
        const payload = evidencePayloadObject(event.payload);
        return event.type === type
          && payload?.operation_id === commitPayload.operation_id
          && payload.recovery_operation_id === input.recoveryOperationId;
      }));
    const [requested, authorized, started] = lifecycle;
    return requested !== undefined
      && authorized !== undefined
      && started !== undefined
      && detected.sequence < requested.sequence
      && requested.sequence < authorized.sequence
      && authorized.sequence < started.sequence
      && started.sequence < commit.sequence
      && (
        commit.sequence < verificationStarted.sequence
        || (
          verificationStarted.sequence < detected.sequence
          && commit.sequence < verification.sequence
        )
      );
  });
  if (!hasOrderedRecoveryCommand) return false;
  const gateStarted = events.find(event => (
    event.type === 'quality_gate.started'
    && event.sequence > verification.sequence
    && evidencePayloadObject(event.payload)?.operation_id === verificationOperationId
  ));
  if (!gateStarted) return false;
  return events.some(event => (
    event.type === 'quality_gate.passed'
    && event.sequence > gateStarted.sequence
    && evidencePayloadObject(event.payload)?.operation_id === verificationOperationId
  ));
}

function reportTerminalEvidenceError(
  input: { onTraceEvidenceError?: (error: unknown) => void },
  error: unknown,
): void {
  try {
    input.onTraceEvidenceError?.(error);
  } catch {
    // Diagnostic delivery is fail-soft and must never replace the command result or exception.
  }
}
