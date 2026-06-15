import { parseGeneratedArtifacts } from './generated-file-parser';
import { classifyIntent } from './intent/intent-classifier';
import { ExecutionMode, ToolKind } from './intent/intent-types';

export type ChatIntentKind = 'chat' | 'code-change';
export type AutoApplyPolicy = 'conservative' | 'balanced' | 'aggressive';
export { ExecutionMode, ToolKind };

export interface ChatIntentDecision {
  kind: ChatIntentKind;
  mode: ExecutionMode;
  addStructuredHint: boolean;
  autoApplyEligible: boolean;
  confidence: number;
  score: number;
  signals: string[];
  blockers: string[];
  reason: string;
  requiresConfirmation: boolean;
  allowedToolKinds: ToolKind[];
}

/**
 * Intent Router — compatibility facade.
 *
 * Product routing now starts with an explicit execution mode:
 * smalltalk, qa, inspect, plan, edit, run, destructive.
 * This file keeps the historical public API used by extension.ts while the
 * application layer is being split into smaller services.
 */

/** A concrete file path in the prompt is a structural fact about what the user is working with. */
const EXPLICIT_PATH_RE = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql))/i;

/** LLM response quality gate — used to skip auto-apply for example/disclaimer responses. */
const RESPONSE_DECLINE_RE = /(无法|不能|抱歉|仅供参考|示例|example|伪代码|不建议直接使用)/i;

/**
 * Decide the product execution mode for a user prompt.
 * Backward compatibility:
 * - edit/run/destructive are exposed as historical "code-change".
 * - smalltalk/qa/inspect/plan are exposed as historical "chat" to prevent
 *   accidental auto-apply while read-only agent workflows are introduced.
 */
export function decideChatIntent(prompt: string): ChatIntentDecision {
  const classification = classifyIntent(prompt);
  const mutatingMode = classification.mode === 'edit'
    || classification.mode === 'run'
    || classification.mode === 'destructive';

  return {
    kind: mutatingMode ? 'code-change' : 'chat',
    mode: classification.mode,
    addStructuredHint: mutatingMode,
    autoApplyEligible: classification.mode === 'edit',
    confidence: classification.confidence,
    score: classification.score,
    signals: classification.signals,
    blockers: classification.blockers,
    reason: classification.reason,
    requiresConfirmation: classification.requiresConfirmation,
    allowedToolKinds: classification.allowedToolKinds,
  };
}

export function shouldAutoApplyFromResponse(
  intent: ChatIntentDecision,
  response: string,
  policy: AutoApplyPolicy = 'conservative',
): boolean {
  if (!intent.autoApplyEligible) return false;
  if (intent.kind !== 'code-change') return false;
  const raw = (response || '').trim();
  if (!raw) return false;

  const artifacts = parseGeneratedArtifacts(raw);
  if (artifacts.length === 0) return false;

  // Structural artifact detection only — no vocabulary matching.
  const hasPath = EXPLICIT_PATH_RE.test(raw);
  const hasCodeFence = /```[\s\S]*?```/.test(raw);
  const hasFileSection = /(文件\s*\d+\s*[:：])|(^\s*\d+[.)]\s+[A-Za-z0-9_./-]+\.)/m.test(raw);
  const hasDiff = /(^|\n)(diff --git|@@\s+-\d+[,\d]*\s+\+\d+[,\d]*\s+@@)/m.test(raw);
  // Skip auto-apply if the response is a disclaimer/example only (structural quality check).
  const looksExampleOnly = RESPONSE_DECLINE_RE.test(raw);

  if (looksExampleOnly && artifacts.length <= 1) return false;

  if (policy === 'aggressive') {
    return artifacts.length > 0;
  }

  if (policy === 'balanced') {
    return artifacts.length > 0 && (hasCodeFence || hasFileSection || hasDiff || hasPath) && !looksExampleOnly;
  }

  // Conservative: require stronger, structured evidence (code fence or diff present).
  if (!hasCodeFence && !hasDiff) return false;
  return artifacts.length > 0 && (hasFileSection || hasDiff || hasPath);
}

/**
 * Determines whether the request should use the two-phase Agent Loop
 * (Architect + Editor) instead of a single-turn chat.
 *
 * Product-mode gate for the current two-phase Agent Loop.
 * Plain smalltalk and QA must never enter agent mode. Read-only modes can use
 * the agent only when there is concrete workspace context to inspect.
 */
export function shouldUseAgentMode(
  intent: ChatIntentDecision,
  files: string[],
): boolean {
  if (intent.blockers.includes('empty-prompt')) return false;
  if (intent.blockers.includes('explicit-no-change')) return false;
  if (intent.requiresConfirmation) return false;

  if (intent.mode === 'smalltalk' || intent.mode === 'qa') return false;

  if (intent.mode === 'inspect' || intent.mode === 'plan') {
    return files.length > 0 || intent.signals.includes('explicit-file-path');
  }

  if (intent.kind === 'chat') return false;
  return intent.kind === 'code-change';
}
