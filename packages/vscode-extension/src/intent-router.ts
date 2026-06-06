import { parseGeneratedArtifacts } from './generated-file-parser';

export type ChatIntentKind = 'chat' | 'code-change';
export type AutoApplyPolicy = 'conservative' | 'balanced' | 'aggressive';

export interface ChatIntentDecision {
  kind: ChatIntentKind;
  addStructuredHint: boolean;
  autoApplyEligible: boolean;
  confidence: number;
  score: number;
  signals: string[];
  blockers: string[];
  reason: string;
}

/**
 * Intent Router — Structural Signals Only (no vocabulary/keyword matching).
 *
 * Design principle (same as Copilot/Claude Code):
 * Keyword lists are brittle — they break with language variation, paraphrasing,
 * and mixed-language prompts. The LLM (decomposer, Phase-0) is the authoritative
 * judge of intent. The router's sole job is:
 *   1. Gate "explicit no-change" requests (user commanded it — structural signal).
 *   2. Default everything else to code-change → let the LLM decide the actual plan.
 *
 * "Explicit no-change" is detected via a COMMAND pattern, not vocabulary inference.
 * The user must explicitly opt out using phrases that are unambiguous commands
 * regardless of language (不要修改 / only discuss / just chat / etc.).
 */

/** User explicitly commands: do NOT modify files — only discuss. */
const NO_CHANGE_RE = /(不要修改|无需修改|只讨论|仅讨论|只分析|仅分析|不要落地|先不要改|不需要代码|不要apply|不做变更|just\s+(?:chat|talk|discuss|explain)|only\s+(?:explain|discuss|answer))/i;

/** A concrete file path in the prompt is a structural fact about what the user is working with. */
const EXPLICIT_PATH_RE = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql))/i;

/** LLM response quality gate — used to skip auto-apply for example/disclaimer responses. */
const RESPONSE_DECLINE_RE = /(无法|不能|抱歉|仅供参考|示例|example|伪代码|不建议直接使用)/i;

/**
 * Decide the intent of a user prompt using structural signals only.
 *
 * Default: code-change (agent mode always active; LLM corrects if it's a discussion).
 * Exception: explicit "don't change files" command → chat.
 *
 * This replaces the former keyword-scoring approach.  Keyword scoring was the wrong
 * abstraction — the same meaning can be expressed in infinite ways across languages.
 * The decomposer (LLM, Phase-0) is responsible for classifying intent with full semantic
 * understanding.  The router just ensures we enter the agent loop.
 */
export function decideChatIntent(prompt: string): ChatIntentDecision {
  const text = (prompt || '').trim();
  if (!text) {
    return {
      kind: 'chat',
      addStructuredHint: false,
      autoApplyEligible: false,
      confidence: 0,
      score: 0,
      signals: [],
      blockers: ['empty-prompt'],
      reason: 'empty-prompt',
    };
  }

  // Structural gate: user explicitly commands no file changes.
  if (NO_CHANGE_RE.test(text)) {
    return {
      kind: 'chat',
      addStructuredHint: false,
      autoApplyEligible: false,
      confidence: 0.9,
      score: -5,
      signals: [],
      blockers: ['explicit-no-change'],
      reason: 'explicit-no-change',
    };
  }

  // Structural signal: prompt contains a file path → slightly higher confidence.
  const hasPath = EXPLICIT_PATH_RE.test(text);
  const confidence = hasPath ? 0.85 : 0.70;

  // Default: code-change. The LLM (decomposer) will decide whether to modify files,
  // explain, analyze, or explore — with full semantic understanding of the request.
  return {
    kind: 'code-change',
    addStructuredHint: true,
    autoApplyEligible: true,
    confidence,
    score: hasPath ? 4 : 2,
    signals: hasPath ? ['explicit-file-path'] : ['default-agent'],
    blockers: [],
    reason: hasPath ? 'file-path-detected' : 'default-agent-mode',
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
 * Plan A: Default-agent approach (mirrors Claude Code's always-agent design).
 * ALL requests enter the agent loop unless the user explicitly opts out with
 * a "don't change" phrase (NO_CHANGE_RE). The agent Architect phase decides
 * whether to read/write files or just answer conversationally — this is more
 * reliable than regex-based intent guessing.
 *
 * Rationale vs Copilot/Claude Code:
 *  - Copilot: uses separate UI entry points (Edit/Chat/Inline) to route intent
 *  - Claude Code: all prompts → agent loop, LLM decides which tools to call
 *  - This plugin: no separate UI modes → default-agent is the closest equivalent
 *
 * Only exception: explicit "don't change" (NO_CHANGE_RE blocker) → chat mode.
 */
export function shouldUseAgentMode(
  intent: ChatIntentDecision,
  _files: string[],
): boolean {
  if (intent.blockers.includes('explicit-no-change')) return false;
  return true;
}
