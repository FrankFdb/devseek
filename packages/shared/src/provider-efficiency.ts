import type { ChatMessage, ContentPart } from './llm-types';
import type { RunEvidenceJson } from './run-evidence-protocol';

export const PROVIDER_PROMPT_BUDGET_PROTOCOL = 'devseek.provider-prompt-budget/v1' as const;
export const PROVIDER_EFFICIENCY_PROTOCOL = 'devseek.provider-efficiency/v1' as const;

/** Diagnostic transport budget. It never authorizes truncating user intent. */
export const DEFAULT_PROVIDER_PROMPT_BUDGET_BYTES = 192 * 1024;
export const DEFAULT_PROVIDER_PROMPT_WARNING_RATIO = 0.75;

export type ProviderPromptBudgetStatus = 'within' | 'warning' | 'exceeded';
export type ProviderEfficiencyOutcome = 'completed' | 'failed' | 'cancelled';
export type ProviderEfficiencyLayer = 'vscode-provider-client' | 'bridge-server';
export type ProviderEfficiencyPhase =
  | 'admission'
  | 'initialization'
  | 'prompt-preparation'
  | 'sampling'
  | 'retry-wait'
  | 'settlement';

export interface ProviderPromptBudgetSnapshot {
  readonly protocol: typeof PROVIDER_PROMPT_BUDGET_PROTOCOL;
  readonly budgetBytes: number;
  readonly warningBytes: number;
  readonly totalBytes: number;
  readonly contentBytes: number;
  readonly framingBytes: number;
  readonly messageCount: number;
  readonly largestMessageBytes: number;
  readonly roleBytes: Readonly<{
    system: number;
    user: number;
    assistant: number;
  }>;
  readonly status: ProviderPromptBudgetStatus;
}

export interface ProviderEfficiencyIdentity {
  readonly layer: ProviderEfficiencyLayer;
  readonly samplingId: string;
  readonly operationId: string;
  readonly transportAttempt: number;
}

export interface ProviderEfficiencyProfile extends ProviderEfficiencyIdentity {
  readonly protocol: typeof PROVIDER_EFFICIENCY_PROTOCOL;
  readonly outcome: ProviderEfficiencyOutcome;
  readonly totalMs: number;
  readonly timeToFirstOutputMs: number | null;
  readonly phasesMs: Readonly<Record<ProviderEfficiencyPhase, number>>;
  readonly attemptCount: number;
  readonly retryCount: number;
  readonly streamBytesObserved: number;
  readonly outputBytes: number | null;
  readonly promptBudget: ProviderPromptBudgetSnapshot;
}

export interface ProviderEfficiencyProfilerOptions {
  readonly now?: () => number;
  readonly promptBudget: ProviderPromptBudgetSnapshot;
}

const PHASES: readonly ProviderEfficiencyPhase[] = Object.freeze([
  'admission',
  'initialization',
  'prompt-preparation',
  'sampling',
  'retry-wait',
  'settlement',
]);

/**
 * Monotonic request profiler shared by provider adapters. Each layer records
 * only milestones it owns; the common identity joins those observations.
 */
export class ProviderEfficiencyProfiler {
  private readonly now: () => number;
  private readonly startedAt: number;
  private lastTransitionAt: number;
  private activePhase: ProviderEfficiencyPhase = 'admission';
  private readonly phaseDurations = new Map<ProviderEfficiencyPhase, number>();
  private firstOutputAt?: number;
  private streamBytesObserved = 0;
  private attemptCount = 0;
  private retryCount = 0;
  private promptBudget: ProviderPromptBudgetSnapshot;
  private completedProfile?: ProviderEfficiencyProfile;

  constructor(
    private readonly identity: ProviderEfficiencyIdentity,
    options: ProviderEfficiencyProfilerOptions,
  ) {
    this.identity = normalizeProviderEfficiencyIdentity(identity);
    this.now = options.now ?? (() => performance.now());
    this.startedAt = requireMonotonicTime(this.now(), 'startedAt');
    this.lastTransitionAt = this.startedAt;
    this.promptBudget = requireProviderPromptBudget(options.promptBudget);
    for (const phase of PHASES) this.phaseDurations.set(phase, 0);
  }

  transition(phase: ProviderEfficiencyPhase): void {
    if (this.completedProfile) throw new Error('provider-efficiency:already-completed');
    if (!PHASES.includes(phase)) throw new Error('provider-efficiency:invalid-phase');
    const now = requireMonotonicTime(this.now(), 'transition');
    this.advance(now);
    this.activePhase = phase;
  }

  markAttemptStarted(attempt: number): void {
    const normalized = requireProviderAttempt(attempt);
    if (normalized < this.attemptCount) throw new Error('provider-efficiency:attempt-regressed');
    this.attemptCount = Math.max(this.attemptCount, normalized);
  }

  markRetryScheduled(): void {
    if (this.completedProfile) throw new Error('provider-efficiency:already-completed');
    this.retryCount += 1;
    this.transition('retry-wait');
  }

  updatePromptBudget(promptBudget: ProviderPromptBudgetSnapshot): void {
    if (this.completedProfile) throw new Error('provider-efficiency:already-completed');
    this.promptBudget = requireProviderPromptBudget(promptBudget);
  }

  observeOutput(delta = ''): void {
    if (this.completedProfile) return;
    const bytes = utf8ByteLength(delta);
    if (bytes <= 0) return;
    const now = requireMonotonicTime(this.now(), 'firstOutput');
    if (this.firstOutputAt === undefined) this.firstOutputAt = now;
    this.streamBytesObserved = safeAdd(this.streamBytesObserved, bytes);
  }

  finish(
    outcome: ProviderEfficiencyOutcome,
    output?: string,
  ): ProviderEfficiencyProfile {
    if (this.completedProfile) return this.completedProfile;
    if (!['completed', 'failed', 'cancelled'].includes(outcome)) {
      throw new Error('provider-efficiency:invalid-outcome');
    }
    const completedAt = requireMonotonicTime(this.now(), 'completedAt');
    this.advance(completedAt);
    const totalMs = durationMs(this.startedAt, completedAt);
    const phasesMs = Object.freeze(Object.fromEntries(PHASES.map(phase => [
      phase,
      Math.round(this.phaseDurations.get(phase) ?? 0),
    ])) as Record<ProviderEfficiencyPhase, number>);
    const profile: ProviderEfficiencyProfile = Object.freeze({
      protocol: PROVIDER_EFFICIENCY_PROTOCOL,
      ...this.identity,
      outcome,
      totalMs,
      timeToFirstOutputMs: this.firstOutputAt === undefined
        ? null
        : durationMs(this.startedAt, this.firstOutputAt),
      phasesMs,
      attemptCount: Math.max(1, this.attemptCount),
      retryCount: this.retryCount,
      streamBytesObserved: this.streamBytesObserved,
      outputBytes: output === undefined ? null : utf8ByteLength(output),
      promptBudget: this.promptBudget,
    });
    this.completedProfile = profile;
    return profile;
  }

  private advance(now: number): void {
    if (now < this.lastTransitionAt) throw new Error('provider-efficiency:clock-regressed');
    const elapsed = now - this.lastTransitionAt;
    this.phaseDurations.set(
      this.activePhase,
      (this.phaseDurations.get(this.activePhase) ?? 0) + elapsed,
    );
    this.lastTransitionAt = now;
  }
}

export function measureProviderMessagePrompt(
  messages: readonly ChatMessage[],
  budgetBytes = DEFAULT_PROVIDER_PROMPT_BUDGET_BYTES,
): ProviderPromptBudgetSnapshot {
  const normalizedBudget = requirePositiveInteger(budgetBytes, 'budgetBytes');
  const roleBytes = { system: 0, user: 0, assistant: 0 };
  let largestMessageBytes = 0;
  for (const message of messages) {
    const contentBytes = utf8ByteLength(providerMessageContentText(message.content));
    roleBytes[message.role] = safeAdd(roleBytes[message.role], contentBytes);
    largestMessageBytes = Math.max(largestMessageBytes, contentBytes);
  }
  const contentBytes = safeAdd(safeAdd(roleBytes.system, roleBytes.user), roleBytes.assistant);
  const totalBytes = utf8ByteLength(JSON.stringify(messages));
  return createPromptBudgetSnapshot({
    budgetBytes: normalizedBudget,
    totalBytes,
    contentBytes,
    messageCount: messages.length,
    largestMessageBytes,
    roleBytes,
  });
}

export function measureProviderTextPrompt(
  prompt: string,
  budgetBytes = DEFAULT_PROVIDER_PROMPT_BUDGET_BYTES,
): ProviderPromptBudgetSnapshot {
  const normalizedBudget = requirePositiveInteger(budgetBytes, 'budgetBytes');
  const totalBytes = utf8ByteLength(prompt);
  return createPromptBudgetSnapshot({
    budgetBytes: normalizedBudget,
    totalBytes,
    contentBytes: totalBytes,
    messageCount: 1,
    largestMessageBytes: totalBytes,
    roleBytes: { system: 0, user: totalBytes, assistant: 0 },
  });
}

export function providerPromptBudgetEvidence(
  snapshot: ProviderPromptBudgetSnapshot,
): Record<string, RunEvidenceJson> {
  const value = requireProviderPromptBudget(snapshot);
  return {
    protocol: value.protocol,
    budget_bytes: value.budgetBytes,
    warning_bytes: value.warningBytes,
    total_bytes: value.totalBytes,
    content_bytes: value.contentBytes,
    framing_bytes: value.framingBytes,
    message_count: value.messageCount,
    largest_message_bytes: value.largestMessageBytes,
    role_bytes: { ...value.roleBytes },
    status: value.status,
  };
}

export function providerEfficiencyEvidence(
  profile: ProviderEfficiencyProfile,
): Record<string, RunEvidenceJson> {
  return {
    protocol: profile.protocol,
    layer: profile.layer,
    sampling_id: profile.samplingId,
    operation_id: profile.operationId,
    transport_attempt: profile.transportAttempt,
    outcome: profile.outcome,
    total_ms: profile.totalMs,
    time_to_first_output_ms: profile.timeToFirstOutputMs,
    phases_ms: Object.fromEntries(Object.entries(profile.phasesMs).map(([key, value]) => [
      key.replace(/-/g, '_'),
      value,
    ])),
    attempt_count: profile.attemptCount,
    retry_count: profile.retryCount,
    stream_bytes_observed: profile.streamBytesObserved,
    output_bytes: profile.outputBytes,
    prompt_budget: providerPromptBudgetEvidence(profile.promptBudget),
  };
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(String(value ?? '')).byteLength;
}

/** Returns a valid Unicode prefix whose UTF-8 representation fits maxBytes. */
export function truncateUtf8ToByteLength(value: string, maxBytes: number): string {
  const text = String(value ?? '');
  const limit = Math.max(0, Math.trunc(maxBytes));
  if (utf8ByteLength(text) <= limit) return text;
  let used = 0;
  let output = '';
  for (const codePoint of text) {
    const bytes = utf8ByteLength(codePoint);
    if (used + bytes > limit) break;
    output += codePoint;
    used += bytes;
  }
  return output;
}

export function requireProviderAttempt(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 32) {
    throw new Error('provider-efficiency:invalid-attempt');
  }
  return value;
}

export function requireProviderCorrelationId(value: string, name: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized.length > 256 || /[\r\n\0]/u.test(normalized)) {
    throw new Error(`provider-efficiency:invalid-${name}`);
  }
  return normalized;
}

function createPromptBudgetSnapshot(input: {
  budgetBytes: number;
  totalBytes: number;
  contentBytes: number;
  messageCount: number;
  largestMessageBytes: number;
  roleBytes: { system: number; user: number; assistant: number };
}): ProviderPromptBudgetSnapshot {
  const warningBytes = Math.floor(input.budgetBytes * DEFAULT_PROVIDER_PROMPT_WARNING_RATIO);
  const status: ProviderPromptBudgetStatus = input.totalBytes > input.budgetBytes
    ? 'exceeded'
    : input.totalBytes >= warningBytes
      ? 'warning'
      : 'within';
  return Object.freeze({
    protocol: PROVIDER_PROMPT_BUDGET_PROTOCOL,
    budgetBytes: input.budgetBytes,
    warningBytes,
    totalBytes: input.totalBytes,
    contentBytes: input.contentBytes,
    framingBytes: Math.max(0, input.totalBytes - input.contentBytes),
    messageCount: input.messageCount,
    largestMessageBytes: input.largestMessageBytes,
    roleBytes: Object.freeze({ ...input.roleBytes }),
    status,
  });
}

function requireProviderPromptBudget(
  value: ProviderPromptBudgetSnapshot,
): ProviderPromptBudgetSnapshot {
  if (!value || value.protocol !== PROVIDER_PROMPT_BUDGET_PROTOCOL) {
    throw new Error('provider-efficiency:invalid-prompt-budget');
  }
  for (const number of [
    value.budgetBytes,
    value.warningBytes,
    value.totalBytes,
    value.contentBytes,
    value.framingBytes,
    value.messageCount,
    value.largestMessageBytes,
    value.roleBytes.system,
    value.roleBytes.user,
    value.roleBytes.assistant,
  ]) {
    if (!Number.isSafeInteger(number) || number < 0) {
      throw new Error('provider-efficiency:invalid-prompt-budget-number');
    }
  }
  return value;
}

function normalizeProviderEfficiencyIdentity(
  identity: ProviderEfficiencyIdentity,
): ProviderEfficiencyIdentity {
  if (!identity || !['vscode-provider-client', 'bridge-server'].includes(identity.layer)) {
    throw new Error('provider-efficiency:invalid-layer');
  }
  return Object.freeze({
    layer: identity.layer,
    samplingId: requireProviderCorrelationId(identity.samplingId, 'sampling-id'),
    operationId: requireProviderCorrelationId(identity.operationId, 'operation-id'),
    transportAttempt: requireProviderAttempt(identity.transportAttempt),
  });
}

function providerMessageContentText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(providerContentPartText).join('\n');
}

function providerContentPartText(part: ContentPart): string {
  if (part.type === 'text') return part.text ?? '';
  return part.image_url?.url ?? '';
}

function requireMonotonicTime(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`provider-efficiency:invalid-clock-${name}`);
  }
  return value;
}

function durationMs(start: number, end: number): number {
  if (end < start) throw new Error('provider-efficiency:clock-regressed');
  return Math.round(end - start);
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`provider-efficiency:invalid-${name}`);
  }
  return value;
}

function safeAdd(left: number, right: number): number {
  const total = left + right;
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error('provider-efficiency:numeric-overflow');
  }
  return total;
}
