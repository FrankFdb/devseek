import type { BridgeRuntimeAdvertisement } from '@devseek-netai/shared';

export interface ExpectedBridgeBuild {
  appVersion?: string;
  buildId?: string;
}

export type BridgeRuntimePreparationDecision =
  | 'reuse'
  | 'restart'
  | 'preserve-known'
  | 'blocked-unknown'
  | 'start';

/** Owns the identity contract between one extension host and its Bridge process. */
export class BridgeRuntimeContinuity {
  private advertisement?: BridgeRuntimeAdvertisement;
  private verified = false;

  get isVerified(): boolean {
    return this.verified;
  }

  get runtimeInstanceId(): string | undefined {
    return this.advertisement?.runtimeInstanceId;
  }

  observe(advertisement: BridgeRuntimeAdvertisement): 'initial' | 'same' | 'changed' {
    const priorId = this.advertisement?.runtimeInstanceId;
    this.advertisement = advertisement;
    this.verified = true;
    if (!priorId) return 'initial';
    return priorId === advertisement.runtimeInstanceId ? 'same' : 'changed';
  }

  markUnverified(): void {
    this.verified = false;
  }

  clear(): void {
    this.advertisement = undefined;
    this.verified = false;
  }
}

export function decideBridgeRuntimePreparation(input: {
  forceRestart: boolean;
  reachable: boolean;
  runtime?: BridgeRuntimeAdvertisement;
  knownRuntimeInstanceId?: string;
  expectedBuild: ExpectedBridgeBuild;
}): BridgeRuntimePreparationDecision {
  if (input.forceRestart) return 'restart';
  if (input.runtime) {
    return bridgeRuntimeMatchesBuild(input.runtime, input.expectedBuild) ? 'reuse' : 'restart';
  }
  if (input.reachable) {
    return input.knownRuntimeInstanceId ? 'preserve-known' : 'blocked-unknown';
  }
  return 'start';
}

export function bridgeRuntimeMatchesBuild(
  runtime: BridgeRuntimeAdvertisement,
  expected: ExpectedBridgeBuild,
): boolean {
  if (!expected.buildId && !expected.appVersion) return true;
  if (expected.buildId) return runtime.buildId === expected.buildId;
  return runtime.appVersion === expected.appVersion;
}

export class BridgeRuntimeChangedError extends Error {
  constructor(readonly currentRuntimeInstanceId?: string) {
    super('BRIDGE_RUNTIME_CHANGED');
    this.name = 'BridgeRuntimeChangedError';
  }
}

export function bridgeRuntimeChangedErrorFromPayload(
  payload: unknown,
): BridgeRuntimeChangedError | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  if (record.error !== 'BRIDGE_RUNTIME_CHANGED') return undefined;
  return new BridgeRuntimeChangedError(
    typeof record.runtimeInstanceId === 'string' ? record.runtimeInstanceId : undefined,
  );
}

export function isBridgeRuntimeChangedError(error: unknown): error is BridgeRuntimeChangedError {
  return error instanceof BridgeRuntimeChangedError
    || (error instanceof Error && error.message === 'BRIDGE_RUNTIME_CHANGED');
}
