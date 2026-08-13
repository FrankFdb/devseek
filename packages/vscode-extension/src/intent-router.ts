import { parseGeneratedArtifacts } from './generated-file-parser';
import { ExecutionMode, ToolKind } from './intent/intent-types';
import { routeTaskIntent } from './task-intent-router';
import type { TaskSemanticContract } from './task-semantic-contract';
import type { TaskSemanticResolutionContext } from './intent/task-semantic-contract-service';
import { hasExplicitWorkspaceFilePath } from './workspace/path-patterns';

export type ChatIntentKind = 'chat' | 'code-change';
export type AutoApplyPolicy = 'conservative' | 'balanced' | 'aggressive';
export { ExecutionMode, ToolKind };

export interface ChatIntentDecision {
  semanticContract: TaskSemanticContract;
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

/** LLM response quality gate — used to skip auto-apply for example/disclaimer responses. */
const RESPONSE_DECLINE_RE = /(无法|不能|抱歉|仅供参考|示例|example|伪代码|不建议直接使用)/i;

/**
 * Decide the product execution mode for a user prompt.
 * Backward compatibility:
 * - edit/run/destructive are exposed as historical "code-change".
 * - smalltalk/qa/inspect/plan are exposed as historical "chat" to prevent
 *   accidental auto-apply while read-only agent workflows are introduced.
 */
export function decideChatIntent(
  prompt: string,
  semanticContext?: TaskSemanticResolutionContext,
): ChatIntentDecision {
  const route = routeTaskIntent(prompt, semanticContext);

  return {
    semanticContract: route.semanticContract,
    kind: route.chatKind,
    mode: route.mode,
    addStructuredHint: route.chatKind === 'code-change',
    autoApplyEligible: route.mode === 'edit',
    confidence: route.classification.confidence,
    score: route.classification.score,
    signals: route.signals,
    blockers: route.blockers,
    reason: route.classification.reason,
    requiresConfirmation: route.requiresConfirmation,
    allowedToolKinds: route.allowedToolKinds,
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
  const hasPath = hasExplicitWorkspaceFilePath(raw);
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
  if (intent.blockers.includes('explicit-no-change') && !['inspect', 'plan'].includes(intent.mode)) return false;
  if (intent.requiresConfirmation) return false;

  if (intent.mode === 'smalltalk' || intent.mode === 'qa') return false;

  if (intent.mode === 'inspect' || intent.mode === 'plan') {
    return files.length > 0
      || intent.signals.includes('explicit-file-path')
      || intent.signals.includes('artifact-path-query')
      || intent.signals.includes('workspace-diff-review');
  }

  if (intent.kind === 'chat') return false;
  return intent.kind === 'code-change';
}
