import type { AgentSurfaceKind } from './agent-protocol';
import { codingSemanticDigest } from './coding-semantic-digest';
import {
  CODING_CANCELLATION_RECEIPT_VERSION,
  CODING_STEERING_RECEIPT_VERSION,
} from './coding-run-control';

export const CODING_USER_COLLABORATION_DECISION_VERSION = 'devseek.coding-user-collaboration-decision/v1' as const;
export const CODING_SURFACE_ACCESSIBILITY_DECISION_VERSION = 'devseek.coding-surface-accessibility-decision/v1' as const;

export type CodingCollaborationInteraction =
  | 'clarification'
  | 'progress'
  | 'plan-review'
  | 'diff-review'
  | 'permission-decision'
  | 'steering'
  | 'cancellation'
  | 'resume'
  | 'error-explanation';

export interface CodingUserCollaborationManifest {
  readonly surface: Extract<AgentSurfaceKind, 'vscode' | 'cli' | 'jsonl' | 'headless'>;
  readonly interactions: readonly CodingCollaborationInteraction[];
  readonly eventTypes: readonly string[];
  readonly traceBound: boolean;
  readonly cancellationProtocol: typeof CODING_CANCELLATION_RECEIPT_VERSION;
  readonly steeringProtocol?: typeof CODING_STEERING_RECEIPT_VERSION;
  readonly evidenceRefs: readonly string[];
}

export interface CodingUserCollaborationDecision {
  readonly version: typeof CODING_USER_COLLABORATION_DECISION_VERSION;
  readonly surface: CodingUserCollaborationManifest['surface'];
  readonly status: 'conformant' | 'non-conformant';
  readonly missingInteractions: readonly CodingCollaborationInteraction[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly decisionSha256: string;
}

export interface UserCollaborationPort {
  assess(manifest: CodingUserCollaborationManifest): CodingUserCollaborationDecision;
}

export type CodingAccessibilityChannel =
  | 'keyboard'
  | 'screen-reader'
  | 'text-status'
  | 'programmatic';

export interface CodingSurfaceAccessibilityManifest {
  readonly surface: CodingUserCollaborationManifest['surface'];
  readonly channels: readonly CodingAccessibilityChannel[];
  readonly statusNotColorOnly: boolean;
  readonly cancellationReachable: boolean;
  readonly recoveryReachable: boolean;
  readonly evidenceRefs: readonly string[];
}

export interface CodingSurfaceAccessibilityDecision {
  readonly version: typeof CODING_SURFACE_ACCESSIBILITY_DECISION_VERSION;
  readonly surface: CodingSurfaceAccessibilityManifest['surface'];
  readonly status: 'conformant' | 'non-conformant';
  readonly missingChannels: readonly CodingAccessibilityChannel[];
  readonly reasonCodes: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly decisionSha256: string;
}

export interface SurfaceAccessibilityPort {
  assess(manifest: CodingSurfaceAccessibilityManifest): CodingSurfaceAccessibilityDecision;
}

const REQUIRED_INTERACTIONS: Readonly<Record<CodingUserCollaborationManifest['surface'], readonly CodingCollaborationInteraction[]>> = {
  vscode: [
    'clarification',
    'progress',
    'plan-review',
    'diff-review',
    'permission-decision',
    'steering',
    'cancellation',
    'resume',
    'error-explanation',
  ],
  cli: ['progress', 'cancellation', 'resume', 'error-explanation'],
  jsonl: ['progress', 'cancellation', 'resume', 'error-explanation'],
  headless: ['progress', 'cancellation', 'resume', 'error-explanation'],
};

const REQUIRED_CHANNELS: Readonly<Record<CodingSurfaceAccessibilityManifest['surface'], readonly CodingAccessibilityChannel[]>> = {
  vscode: ['keyboard', 'screen-reader', 'text-status'],
  cli: ['keyboard', 'text-status'],
  jsonl: ['programmatic', 'text-status'],
  headless: ['programmatic'],
};

/** Certifies that each Surface projects the shared control lifecycle through its native interaction model. */
export class CanonicalUserCollaborationService implements UserCollaborationPort {
  assess(candidate: CodingUserCollaborationManifest): CodingUserCollaborationDecision {
    const manifest = snapshotCollaborationManifest(candidate);
    const missingInteractions = REQUIRED_INTERACTIONS[manifest.surface]
      .filter(interaction => !manifest.interactions.includes(interaction));
    const reasonCodes = [
      ...missingInteractions.map(interaction => `interaction-missing:${interaction}`),
      ...(manifest.traceBound ? [] : ['same-trace-projection-missing']),
      ...(manifest.eventTypes.length > 0 ? [] : ['event-projection-missing']),
      ...(manifest.evidenceRefs.length > 0 ? [] : ['collaboration-evidence-missing']),
      ...(manifest.interactions.includes('steering') && !manifest.steeringProtocol
        ? ['steering-protocol-missing']
        : []),
    ];
    return snapshotCollaborationDecision({
      surface: manifest.surface,
      status: reasonCodes.length === 0 ? 'conformant' : 'non-conformant',
      missingInteractions,
      reasonCodes,
      evidenceRefs: manifest.evidenceRefs,
    });
  }
}

/** Certifies reachability without assuming that every Surface has a visual UI. */
export class CanonicalSurfaceAccessibilityService implements SurfaceAccessibilityPort {
  assess(candidate: CodingSurfaceAccessibilityManifest): CodingSurfaceAccessibilityDecision {
    const manifest = snapshotAccessibilityManifest(candidate);
    const missingChannels = REQUIRED_CHANNELS[manifest.surface]
      .filter(channel => !manifest.channels.includes(channel));
    const reasonCodes = [
      ...missingChannels.map(channel => `accessibility-channel-missing:${channel}`),
      ...(manifest.statusNotColorOnly ? [] : ['status-color-only']),
      ...(manifest.cancellationReachable ? [] : ['cancellation-unreachable']),
      ...(manifest.recoveryReachable ? [] : ['recovery-unreachable']),
      ...(manifest.evidenceRefs.length > 0 ? [] : ['accessibility-evidence-missing']),
    ];
    return snapshotAccessibilityDecision({
      surface: manifest.surface,
      status: reasonCodes.length === 0 ? 'conformant' : 'non-conformant',
      missingChannels,
      reasonCodes,
      evidenceRefs: manifest.evidenceRefs,
    });
  }
}

function snapshotCollaborationManifest(input: CodingUserCollaborationManifest): CodingUserCollaborationManifest {
  const surface = requireSurface(input?.surface);
  if (input.cancellationProtocol !== CODING_CANCELLATION_RECEIPT_VERSION) {
    throw new Error('coding-user-collaboration:unsupported-cancellation-protocol');
  }
  if (input.steeringProtocol && input.steeringProtocol !== CODING_STEERING_RECEIPT_VERSION) {
    throw new Error('coding-user-collaboration:unsupported-steering-protocol');
  }
  return Object.freeze({
    surface,
    interactions: uniqueValues(input.interactions),
    eventTypes: uniqueText(input.eventTypes),
    traceBound: input.traceBound === true,
    cancellationProtocol: input.cancellationProtocol,
    ...(input.steeringProtocol ? { steeringProtocol: input.steeringProtocol } : {}),
    evidenceRefs: uniqueText(input.evidenceRefs),
  });
}

function snapshotAccessibilityManifest(input: CodingSurfaceAccessibilityManifest): CodingSurfaceAccessibilityManifest {
  return Object.freeze({
    surface: requireSurface(input?.surface),
    channels: uniqueValues(input.channels),
    statusNotColorOnly: input.statusNotColorOnly === true,
    cancellationReachable: input.cancellationReachable === true,
    recoveryReachable: input.recoveryReachable === true,
    evidenceRefs: uniqueText(input.evidenceRefs),
  });
}

function snapshotCollaborationDecision(
  input: Omit<CodingUserCollaborationDecision, 'version' | 'decisionSha256'>,
): CodingUserCollaborationDecision {
  const value = {
    version: CODING_USER_COLLABORATION_DECISION_VERSION,
    ...input,
    missingInteractions: Object.freeze([...input.missingInteractions]),
    reasonCodes: Object.freeze([...input.reasonCodes]),
    evidenceRefs: Object.freeze([...input.evidenceRefs]),
  };
  return Object.freeze({ ...value, decisionSha256: codingSemanticDigest(value) });
}

function snapshotAccessibilityDecision(
  input: Omit<CodingSurfaceAccessibilityDecision, 'version' | 'decisionSha256'>,
): CodingSurfaceAccessibilityDecision {
  const value = {
    version: CODING_SURFACE_ACCESSIBILITY_DECISION_VERSION,
    ...input,
    missingChannels: Object.freeze([...input.missingChannels]),
    reasonCodes: Object.freeze([...input.reasonCodes]),
    evidenceRefs: Object.freeze([...input.evidenceRefs]),
  };
  return Object.freeze({ ...value, decisionSha256: codingSemanticDigest(value) });
}

function requireSurface(value: unknown): CodingUserCollaborationManifest['surface'] {
  if (!['vscode', 'cli', 'jsonl', 'headless'].includes(String(value))) {
    throw new Error('coding-user-collaboration:unsupported-surface');
  }
  return value as CodingUserCollaborationManifest['surface'];
}

function uniqueText(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...new Set((values ?? []).map(value => String(value).trim()).filter(Boolean))]);
}

function uniqueValues<T extends string>(values: readonly T[] | undefined): readonly T[] {
  return Object.freeze([...new Set(values ?? [])]);
}
