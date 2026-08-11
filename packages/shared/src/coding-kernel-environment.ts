import type { PlatformProfile } from './agent-protocol';
import type { CodingTaskMode } from './coding-conformance';
import {
  CanonicalDirtyWorktreePolicyService,
  createCleanCodingWorktreeSnapshot,
  observeGitWorktreeSync,
  type CodingWorktreeSnapshot,
  type DirtyWorktreePolicySessionPort,
} from './coding-dirty-worktree';
import {
  CanonicalPlatformAdapterConformanceService,
  type CodingPlatformAdapterConformanceReport,
  type CodingPlatformBoundaryObservation,
} from './coding-platform-conformance';
import {
  CanonicalProviderCapabilityService,
  knownCodingProviderAdvertisement,
  type CodingProviderAdvertisement,
  type CodingProviderCapabilityDecision,
  type ProviderCapabilitySessionPort,
} from './coding-provider-capability';
import {
  CanonicalSecretRedactionService,
  type SecretRedactionPort,
} from './coding-secret-redaction';
import type { LLMProviderType } from './llm-types';
import { detectPlatformProfile } from './platform-runtime';

export const CODING_KERNEL_ENVIRONMENT_VERSION = 'devseek.coding-kernel-environment/v1' as const;

export interface CodingKernelEnvironmentInput {
  readonly version: typeof CODING_KERNEL_ENVIRONMENT_VERSION;
  readonly provider: CodingProviderAdvertisement;
  readonly worktree: CodingWorktreeSnapshot;
  readonly platform: {
    readonly profile: PlatformProfile;
    readonly boundaries: readonly CodingPlatformBoundaryObservation[];
  };
}

export interface CodingKernelEnvironmentPreparationInput {
  readonly runId: string;
  readonly mode: CodingTaskMode;
  readonly signalProvided: boolean;
  readonly environment: CodingKernelEnvironmentInput;
}

export interface CodingKernelEnvironmentRuntime {
  readonly providerCapabilities: ProviderCapabilitySessionPort;
  readonly providerCapabilityDecision: CodingProviderCapabilityDecision;
  readonly dirtyWorktree: DirtyWorktreePolicySessionPort;
  readonly platformConformance: CodingPlatformAdapterConformanceReport;
  readonly secretRedaction: SecretRedactionPort;
  readonly ready: boolean;
  readonly blockers: readonly string[];
}

export interface CodingKernelEnvironmentPort {
  prepare(input: CodingKernelEnvironmentPreparationInput): CodingKernelEnvironmentRuntime;
}

export interface CreateCodingKernelEnvironmentOptions {
  readonly workspaceRoot: string;
  readonly provider: LLMProviderType;
  readonly platformProfile?: PlatformProfile;
  readonly worktreeSnapshot?: CodingWorktreeSnapshot;
  readonly env?: Record<string, string | undefined>;
  readonly shellPath?: string;
}

export class CanonicalCodingKernelEnvironmentService implements CodingKernelEnvironmentPort {
  prepare(input: CodingKernelEnvironmentPreparationInput): CodingKernelEnvironmentRuntime {
    assertEnvironmentInput(input.environment);
    const providerCapabilities = new CanonicalProviderCapabilityService().bind(input.environment.provider);
    const providerCapabilityDecision = providerCapabilities.negotiate({
      requestKind: requestKindForMode(input.mode),
      cancellationRequired: input.signalProvided,
      correlationRequired: input.environment.provider.provider === 'bridge',
    });
    const dirtyWorktree = new CanonicalDirtyWorktreePolicyService().bind({
      runId: input.runId,
      snapshot: input.environment.worktree,
    });
    const platformConformance = new CanonicalPlatformAdapterConformanceService().certify(
      input.environment.platform,
    );
    const blockers = Object.freeze([
      ...(providerCapabilityDecision.decision === 'blocked'
        ? providerCapabilityDecision.missingCapabilities.map(item => `provider-capability:${item}`)
        : []),
      ...(!platformConformance.supported
        ? [
            ...platformConformance.runtime.unsupported.map(item => `platform-runtime:${item.kind}:${item.reason ?? 'unsupported'}`),
            ...platformConformance.unsupportedBoundaries.map(item => `platform-boundary:${item.kind}:${item.reason ?? 'unsupported'}`),
            ...platformConformance.deferredBoundaries.map(item => `platform-boundary:${item.kind}:${item.reason ?? 'deferred'}`),
          ]
        : []),
    ]);
    return Object.freeze({
      providerCapabilities,
      providerCapabilityDecision,
      dirtyWorktree,
      platformConformance,
      secretRedaction: new CanonicalSecretRedactionService(),
      ready: blockers.length === 0,
      blockers,
    });
  }
}

/** Node composition adapter. Policy remains owned by the canonical services above. */
export function createCodingKernelEnvironmentSync(
  options: CreateCodingKernelEnvironmentOptions,
): CodingKernelEnvironmentInput {
  const profile = options.platformProfile ?? detectPlatformProfile({
    platform: process.platform,
    env: options.env ?? process.env,
    shellPath: options.shellPath,
  });
  return Object.freeze({
    version: CODING_KERNEL_ENVIRONMENT_VERSION,
    provider: knownCodingProviderAdvertisement(options.provider),
    worktree: options.worktreeSnapshot ?? observeGitWorktreeSync({ workspaceRoot: options.workspaceRoot }),
    platform: Object.freeze({
      profile: Object.freeze({ ...profile }),
      boundaries: canonicalPlatformBoundaryObservations(),
    }),
  });
}

export function createFixtureCodingKernelEnvironment(
  workspaceRoot: string,
  provider: LLMProviderType = 'bridge',
): CodingKernelEnvironmentInput {
  return createCodingKernelEnvironmentSync({
    workspaceRoot,
    provider,
    worktreeSnapshot: createCleanCodingWorktreeSnapshot(workspaceRoot),
    platformProfile: {
      os: 'linux',
      shell: 'posix',
      pathStyle: 'posix',
      lineEnding: 'lf',
      caseSensitive: true,
      workspaceKind: 'local',
    },
  });
}

function canonicalPlatformBoundaryObservations(): readonly CodingPlatformBoundaryObservation[] {
  return Object.freeze([
    Object.freeze({
      kind: 'sandbox' as const,
      adapterId: 'canonical-tool-authority-and-safety-policy/v1',
      status: 'supported' as const,
      evidenceRefs: Object.freeze(['platform-boundary:canonical-sandbox-policy']),
    }),
    Object.freeze({
      kind: 'workspace-mutation' as const,
      adapterId: 'canonical-workspace-mutation-transaction/v1',
      status: 'supported' as const,
      evidenceRefs: Object.freeze(['platform-boundary:canonical-workspace-mutation']),
    }),
    Object.freeze({
      kind: 'external-effect' as const,
      adapterId: 'canonical-external-effect/v1',
      status: 'supported' as const,
      evidenceRefs: Object.freeze(['platform-boundary:canonical-external-effect']),
    }),
  ]);
}

function requestKindForMode(mode: CodingTaskMode): CodingProviderCapabilityDecision['requestKind'] {
  if (mode === 'release') return 'release';
  if (mode === 'change') return 'code-change';
  return 'chat';
}

function assertEnvironmentInput(environment: CodingKernelEnvironmentInput): void {
  if (!environment || environment.version !== CODING_KERNEL_ENVIRONMENT_VERSION) {
    throw new Error('coding-kernel-environment:unsupported-version');
  }
  if (!environment.provider || !environment.worktree || !environment.platform?.profile) {
    throw new Error('coding-kernel-environment:incomplete-input');
  }
  if (!Array.isArray(environment.platform.boundaries)) {
    throw new Error('coding-kernel-environment:missing-platform-boundaries');
  }
}
