import { CodingKernelExecutionError } from '@devseek-netai/shared';
import {
  assertCompletedCliCodingKernelOutput,
  CliCodingKernelTerminalError,
  type CliProductCodingKernelOutput,
} from './cli-product-coding-kernel';
import type { CliRunEvidence } from './cli-run-evidence';
import type { CliRunLifecycleStatus, CliSurfaceAdapter } from './cli-surface-adapter';

export type CliRunTerminalStatus = Exclude<CliRunLifecycleStatus, 'running' | 'completed'>;

type CliRunEvidenceLifecyclePort = Pick<
  CliRunEvidence,
  'retainLifecycle' | 'settle' | 'waitForBridgeProviderTerminals'
>;

export interface CliRunFailureSettlementInput {
  readonly error: unknown;
  readonly cancellation: { readonly cancelled: boolean; readonly exitCode: number };
  readonly usesBridge: boolean;
  readonly evidence: CliRunEvidenceLifecyclePort;
  readonly surface: Pick<CliSurfaceAdapter, 'flush'>;
  readonly renderLifecycle: (
    status: CliRunTerminalStatus,
    exitCode: number,
  ) => void | Promise<void>;
}

export interface CliRunFailureSettlement {
  readonly error: unknown;
  readonly status: CliRunTerminalStatus;
  readonly exitCode: number;
}

export function acceptCliCodingKernelOutput(
  evidence: Pick<CliRunEvidence, 'retainLifecycle'>,
  output: CliProductCodingKernelOutput,
): void {
  evidence.retainLifecycle(output.lifecycle);
  assertCompletedCliCodingKernelOutput(output);
}

export async function settleCliRunFailure(
  input: CliRunFailureSettlementInput,
): Promise<CliRunFailureSettlement> {
  if (input.error instanceof CodingKernelExecutionError) {
    input.evidence.retainLifecycle(input.error.lifecycle);
  }
  const status = resolveCliRunTerminalStatus(input.error, input.cancellation.cancelled);
  const exitCode = input.cancellation.cancelled ? input.cancellation.exitCode : 1;
  let terminalError = input.error;

  try {
    await input.surface.flush();
  } catch (error) {
    terminalError = error;
  }
  if (input.cancellation.cancelled && input.usesBridge) {
    await input.evidence.waitForBridgeProviderTerminals();
  }
  try {
    await input.renderLifecycle(status, exitCode);
    await input.surface.flush();
  } catch (error) {
    terminalError = error;
  }
  input.evidence.settle(status);
  return Object.freeze({ error: terminalError, status, exitCode });
}

export function resolveCliRunTerminalStatus(
  error: unknown,
  cancelled: boolean,
): CliRunTerminalStatus {
  if (cancelled) return 'cancelled';
  if (error instanceof CliCodingKernelTerminalError) return error.status;
  if (error instanceof CodingKernelExecutionError) {
    const status = error.settlement.status;
    if (status === 'blocked' || status === 'cancelled') return status;
  }
  return 'failed';
}
