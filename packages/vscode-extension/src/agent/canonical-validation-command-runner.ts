import {
  buildCodingToolAction,
  type CodingToolAuthoritySessionPort,
  type CodingToolExecutionSessionPort,
} from '@devseek-netai/shared';
import type {
  ValidationCommandInvocation,
  ValidationCommandResult,
  ValidationCommandRunner,
} from '../workspace/validation-service';

export interface CanonicalValidationActionIdentity {
  readonly actionId: string;
  readonly sequence: number;
}

/** Records host-owned validation commands in the same canonical tool timeline as model tools. */
export class CanonicalValidationCommandRunner {
  private latest?: CanonicalValidationActionIdentity;

  constructor(
    private readonly host: ValidationCommandRunner,
    private readonly authority: CodingToolAuthoritySessionPort,
    private readonly execution: CodingToolExecutionSessionPort,
    private readonly scopePaths: readonly string[],
  ) {}

  readonly run: ValidationCommandRunner = async invocation => {
    const input = canonicalValidationInput(invocation);
    const context = this.execution.nextAction({
      tool: 'run_terminal',
      purpose: 'verify',
      effects: ['process'],
      input,
    });
    const authorization = this.authority.authorize({
      actionId: context.actionId,
      tool: 'run_terminal',
      purpose: 'verify',
      effects: ['process'],
      input,
      risk: 'medium',
      targetPaths: this.scopePaths,
      surfaceConstraint: {
        decision: 'allow',
        reason: 'vscode-host-validation',
        evidenceRefs: [`vscode-host-validation:${context.actionId}:allow`],
      },
    });
    const action = buildCodingToolAction({
      ...context,
      tool: 'run_terminal',
      purpose: 'verify',
      effects: ['process'],
      input,
      authority: authorization.receipt,
    });
    const outcome = await this.execution.execute<
      typeof input,
      ValidationCommandResult
    >(action, {
      execute: async () => {
        const result = await this.host(invocation);
        return {
          status: canonicalValidationStatus(result),
          result,
          ...(!result.ran || !result.ok || result.exitCode !== 0 ? {
            errorCode: result.ran
              ? `validation-exit-${result.exitCode ?? 'unknown'}`
              : 'validation-not-run',
          } : {}),
          evidenceRefs: [
            `vscode-host-validation:${context.actionId}:${result.ran
              ? `exit-${result.exitCode ?? 'unknown'}`
              : 'not-run'}`,
          ],
        };
      },
    }, this.authority);
    this.latest = Object.freeze({ actionId: context.actionId, sequence: context.sequence });
    return outcome.receipt.result ?? unavailableValidationResult(
      invocation,
      outcome.receipt.status,
      outcome.receipt.status === 'denied'
        ? outcome.receipt.permission.reason
        : outcome.receipt.errorCode ?? 'canonical-validation-result-missing',
    );
  };

  latestActionIdentity(): CanonicalValidationActionIdentity | undefined {
    return this.latest;
  }
}

function canonicalValidationInput(invocation: ValidationCommandInvocation): Readonly<ValidationCommandInvocation> {
  return Object.freeze({
    command: invocation.command,
    cwd: invocation.cwd,
    timeoutMs: invocation.timeoutMs,
  });
}

function canonicalValidationStatus(
  result: ValidationCommandResult,
): 'completed' | 'failed' | 'indeterminate' {
  if (!result.ran) return 'failed';
  if (result.exitCode === null) return 'indeterminate';
  return result.ok && result.exitCode === 0 ? 'completed' : 'failed';
}

function unavailableValidationResult(
  invocation: ValidationCommandInvocation,
  status: 'completed' | 'failed' | 'denied' | 'indeterminate',
  reason: string,
): ValidationCommandResult {
  return {
    ran: false,
    ok: false,
    command: invocation.command,
    exitCode: null,
    stdout: '',
    stderr: '',
    output: status === 'denied'
      ? `Canonical validation command was denied: ${reason}`
      : `Canonical validation command did not produce a result (${status}): ${reason}`,
    cwd: invocation.cwd,
  };
}
