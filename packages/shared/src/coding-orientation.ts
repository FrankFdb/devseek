import type { CodingTaskMode } from './coding-conformance';
import { isUnsafeSecretHarvestingImplementationRequest } from './coding-safety-intent';

export const CODING_ORIENTATION_DECISION_VERSION = 'devseek.coding-orientation-decision/v1' as const;

export type CodingOrientationSource =
  | 'safety-policy'
  | 'prompt'
  | 'mode-hint'
  | 'read-only-default';

export interface CodingOrientationDecisionInput {
  readonly prompt: string;
  readonly modeHint?: CodingTaskMode;
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

const EXTERNAL_EFFECT_ACTION_RE = /(?:^(?:(?:please\s+|(?:could|can|would)\s+you\s+)?(?:release|publish|deploy|package(?!\.[A-Za-z0-9])|install|(?:git\s+)?(?:commit|push))\b|(?:please\s+)?(?:run\s+)?(?:npm|pnpm|yarn|bun|pip)\s+(?:install|add)\b)|\b(?:and|then|also|please|must|should|to)\s+(?:(?:release|publish|deploy|package(?!\.[A-Za-z0-9])|install|(?:git\s+)?(?:commit|push))\b|(?:run\s+)?(?:npm|pnpm|yarn|bun|pip)\s+(?:install|add)\b)|^(?:请|请帮我|帮我)?(?:发布|发版|打包|部署|提交|推送|安装)|(?:然后|并且|并|再|同时|接着|请|需要|必须|后再?)(?:发布|发版|打包|部署|提交|推送|安装))/iu;
const REVIEW_REQUEST_RE = /(?:\breview\b|\baudit\b|\binspect\b|\banaly[sz]e\b|\bsummari[sz]e\b|审查|审计|检查|分析|总结)/iu;
const CHANGE_REQUEST_RE = /(?:\badd\b|\bcreate\b|\bwrite\b|\bimplement\b|\bfix\b|\brepair\b|\brecover(?:y)?\b|\bmodify\b|\bupdate\b|\brefactor\b|\bapply\b|\bpatch\b|\binstall\b|添加|新增|创建|编写|实现|完善|修复|恢复|修改|更新|重构|应用|打补丁|安装)/iu;
const EXPLICIT_CHANGE_ACTION_RE = /(?:^(?:(?:please\s+|(?:could|can|would)\s+you\s+)?(?:add|create|write|implement|fix|repair|recover|modify|update|refactor|apply|patch)\b)|\b(?:and|then|also|please|must|should|to)\s+(?:add|create|write|implement|fix|repair|recover|modify|update|refactor|apply|patch)\b|^(?:请|请帮我|帮我)?(?:添加|新增|创建|编写|实现|完善|修复|恢复|修改|更新|重构|应用|打补丁)|(?:然后|并且|并|再|同时|接着|请|需要|必须|后再?)(?:添加|新增|创建|编写|实现|完善|修复|恢复|修改|更新|重构|应用|打补丁))/iu;
const EXPLAIN_REQUEST_RE = /(?:\bexplain\b|\bdescribe\b|\bhow\b|\bwhy\b|\bwhat\b|解释|说明|如何|为什么|什么)/iu;
const EXPLANATION_PREFIX_RE = /^(?:(?:please\s+)?(?:explain|describe|how|why|what)\b|(?:请)?(?:解释|说明|如何|为什么|什么))/iu;

/** Unique authority for the cross-Surface coding mode and effect orientation. */
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
  if (!['safety-policy', 'prompt', 'mode-hint', 'read-only-default'].includes(value.source)) {
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
  if (EXPLANATION_PREFIX_RE.test(prompt)) {
    return resolved('explain', 'prompt', 'explicit-explanation-prefix');
  }
  if (EXTERNAL_EFFECT_ACTION_RE.test(prompt)) {
    return resolved('release', 'prompt', 'explicit-external-effect-action');
  }
  const reviewRequested = REVIEW_REQUEST_RE.test(prompt);
  if (CHANGE_REQUEST_RE.test(prompt) && (!reviewRequested || EXPLICIT_CHANGE_ACTION_RE.test(prompt))) {
    return resolved('change', 'prompt', 'explicit-change-action');
  }
  if (reviewRequested) return resolved('review', 'prompt', 'explicit-review-action');
  if (EXPLAIN_REQUEST_RE.test(prompt)) return resolved('explain', 'prompt', 'explanation-signal');
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
