import type { CodingTaskMode } from './coding-conformance';
import { isUnsafeSecretHarvestingImplementationRequest } from './coding-safety-intent';

export const CODING_ORIENTATION_DECISION_VERSION = 'devseek.coding-orientation-decision/v2' as const;

export type CodingOrientationSource =
  | 'safety-policy'
  | 'mode-hint'
  | 'read-only-default';

export interface CodingOrientationDecisionInput {
  readonly prompt: string;
  readonly modeHint?: CodingTaskMode;
  readonly confirmedWorkspaceMutation?: boolean;
}

export interface CodingOrientationDecision {
  readonly version: typeof CODING_ORIENTATION_DECISION_VERSION;
  readonly prompt: string;
  readonly mode: CodingTaskMode;
  readonly mutating: boolean;
  readonly externalEffectRequested: boolean;
  readonly source: CodingOrientationSource;
  readonly reasonCodes: readonly string[];
}

export interface OrientationDecisionPort {
  decide(input: CodingOrientationDecisionInput): CodingOrientationDecision;
}

/**
 * Unique authority for cross-Surface coding orientation. Natural-language
 * prompt content is retained as the goal, but only a typed model/Surface hint
 * can select an effectful mode. Local prompt inspection is safety narrowing.
 */
export class CanonicalOrientationDecisionService implements OrientationDecisionPort {
  decide(input: CodingOrientationDecisionInput): CodingOrientationDecision {
    const prompt = normalizePrompt(input.prompt);
    const hint = validateModeHint(input.modeHint);
    const resolved = resolveMode(prompt, hint);
    return freezeDecision({
      version: CODING_ORIENTATION_DECISION_VERSION,
      prompt,
      mode: resolved.mode,
      mutating: resolved.mode === 'change' || resolved.mode === 'release',
      externalEffectRequested: resolved.mode === 'release',
      source: resolved.source,
      reasonCodes: resolved.reasonCodes,
    });
  }
}

const ORIENTATION = new CanonicalOrientationDecisionService();

export function resolveCodingOrientationDecision(
  input: CodingOrientationDecisionInput,
): CodingOrientationDecision {
  return ORIENTATION.decide(input);
}

export function assertCodingOrientationDecision(value: CodingOrientationDecision): CodingOrientationDecision {
  if (!value || typeof value !== 'object') orientationFailure('missing-decision');
  if (value.version !== CODING_ORIENTATION_DECISION_VERSION) orientationFailure('unsupported-version');
  const prompt = normalizePrompt(value.prompt);
  if (prompt !== value.prompt) orientationFailure('non-canonical-prompt');
  const mode = validateMode(value.mode, 'invalid-mode');
  if (value.mutating !== (mode === 'change' || mode === 'release')) {
    orientationFailure('mutating-flag-mismatch');
  }
  if (value.externalEffectRequested !== (mode === 'release')) {
    orientationFailure('external-effect-flag-mismatch');
  }
  if (!['safety-policy', 'mode-hint', 'read-only-default'].includes(value.source)) {
    orientationFailure('invalid-source');
  }
  if (!Array.isArray(value.reasonCodes) || value.reasonCodes.length === 0) {
    orientationFailure('missing-reason-codes');
  }
  return freezeDecision({ ...value, prompt, mode, reasonCodes: uniqueReasons(value.reasonCodes) });
}

export function assertCodingOrientationPrompt(
  decision: CodingOrientationDecision,
  prompt: string,
): void {
  const canonical = assertCodingOrientationDecision(decision);
  if (canonical.prompt !== normalizePrompt(prompt)) orientationFailure('prompt-mismatch');
}

function resolveMode(
  prompt: string,
  hint: CodingTaskMode | undefined,
): Pick<CodingOrientationDecision, 'mode' | 'source' | 'reasonCodes'> {
  if (isUnsafeSecretHarvestingImplementationRequest(prompt)) {
    return resolved('explain', 'safety-policy', 'unsafe-secret-harvesting-refusal');
  }
  if (hint) return resolved(hint, 'mode-hint', `mode-hint:${hint}`);
  return resolved('explain', 'read-only-default', 'default-read-only');
}

function resolved(
  mode: CodingTaskMode,
  source: CodingOrientationSource,
  reason: string,
): Pick<CodingOrientationDecision, 'mode' | 'source' | 'reasonCodes'> {
  return { mode, source, reasonCodes: [reason, `mode:${mode}`] };
}

function validateModeHint(value: unknown): CodingTaskMode | undefined {
  return value === undefined ? undefined : validateMode(value, 'invalid-mode-hint');
}

function validateMode(value: unknown, reason: string): CodingTaskMode {
  if (value !== 'explain' && value !== 'review' && value !== 'change' && value !== 'release') {
    orientationFailure(reason);
  }
  return value;
}

function normalizePrompt(value: unknown): string {
  if (typeof value !== 'string') orientationFailure('invalid-prompt');
  const prompt = value.replace(/\s+/g, ' ').trim();
  if (!prompt) orientationFailure('missing-prompt');
  return prompt;
}

function uniqueReasons(values: readonly string[]): readonly string[] {
  const reasons = [...new Set(values.map(value => String(value).trim()).filter(Boolean))];
  if (reasons.length === 0) orientationFailure('missing-reason-codes');
  return Object.freeze(reasons);
}

function freezeDecision(value: CodingOrientationDecision): CodingOrientationDecision {
  return Object.freeze({ ...value, reasonCodes: uniqueReasons(value.reasonCodes) });
}

function orientationFailure(reason: string): never {
  throw new Error(`coding-orientation:${reason}`);
}
