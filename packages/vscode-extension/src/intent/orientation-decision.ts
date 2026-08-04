import { routeTaskIntent, type TaskIntentFamily, type TaskIntentRoute } from '../task-intent-router';
import type { ExecutionMode } from './intent-types';
import type { TaskSemanticResolutionContext } from './task-semantic-contract-service';

export type OrientationRisk = 'low' | 'medium' | 'high' | 'destructive';
export type OrientationStatus = 'ready' | 'needs-clarification' | 'needs-confirmation' | 'blocked';

export interface OrientationEvidence {
  kind:
    | 'canonical-route'
    | 'mixed-language-input'
    | 'ambiguous-action-alternatives'
    | 'target-path-known'
    | 'target-path-missing'
    | 'external-effect-authorized'
    | 'external-effect-unconfirmed'
    | 'local-confirmation-required';
  source: 'prompt' | 'route' | 'context' | 'authorization';
  value: string;
}

export interface OrientationDecisionInput {
  prompt: string;
  knownPaths?: string[];
  authorizedExternalEffects?: boolean;
  route?: TaskIntentRoute;
  semanticContext?: TaskSemanticResolutionContext;
}

export interface OrientationDecision {
  version: 'devseek.orientation-decision/v1';
  prompt: string;
  mode: ExecutionMode;
  family: TaskIntentFamily;
  risk: OrientationRisk;
  confidence: number;
  status: OrientationStatus;
  evidence: OrientationEvidence[];
  blockers: string[];
  requiresClarification: boolean;
  requiresConfirmation: boolean;
  allowedToExecute: boolean;
  route: TaskIntentRoute;
  reason: string;
}

const MENTIONED_PATH_RE = /(?:^|[^A-Za-z0-9_.@+~/-])((?:(?:\.{0,2}\/)?[\w.@+~-]+(?:\/[\w.@+~-]+)+|[\w.@+~-]+\.(?:cxx|cpp|cc|c|hxx|hpp|hh|h|tsx|ts|jsx|js|mjs|cjs|py|json|ya?ml|toml|xml|txt|log|csv|ini|conf|cfg|proto|graphql|sh|bash|zsh|ps1|sql|cmake|gradle|markdown|md)))(?=$|[^A-Za-z0-9_.@+~/-])/gi;
const CJK_RE = /[\u3400-\u9fff]/;
const LATIN_WORD_RE = /\b[A-Za-z][A-Za-z-]*\b/;
const ALTERNATIVE_RE = /(?:\bmaybe\b|\bor\b|或者|还是|或是|按你判断|你决定|either)/i;
const MUTATION_ALTERNATIVE_RE = /(?:修复|修改|改|实现|写|创建|生成|删除|发布|推送|fix|change|modify|write|create|generate|delete|release|push)/i;
const READ_ONLY_ALTERNATIVE_RE = /(?:解释|说明|分析|审查|查看|只读|告诉我|explain|review|inspect|analy[sz]e|tell\s+me|just\s+explain)/i;

export function buildOrientationDecision(input: OrientationDecisionInput): OrientationDecision {
  const prompt = String(input.prompt || '').trim();
  const route = input.route ?? routeTaskIntent(prompt, input.semanticContext);
  const evidence: OrientationEvidence[] = [{
    kind: 'canonical-route',
    source: 'route',
    value: `${route.family}:${route.mode}`,
  }];
  const blockers: string[] = [];

  if (hasMixedLanguageInput(prompt)) {
    evidence.push({ kind: 'mixed-language-input', source: 'prompt', value: 'cjk+latin' });
  }

  if (hasAmbiguousActionAlternatives(prompt)) {
    evidence.push({ kind: 'ambiguous-action-alternatives', source: 'prompt', value: 'mutation-or-read-only' });
    blockers.push('orientation-ambiguous-intent');
  }

  const missingPathBlockers = collectPathEvidence({
    prompt,
    route,
    knownPaths: input.knownPaths,
    evidence,
  });
  blockers.push(...missingPathBlockers);

  const externalEffect = route.family === 'release-external-effect'
    || route.semanticContract.kind === 'destructive'
    || route.semanticContract.taskContract.taskShapes.includes('destructive');
  const needsExternalAuthorization = route.family === 'release-external-effect'
    && input.authorizedExternalEffects !== true;
  if (route.family === 'release-external-effect') {
    evidence.push({
      kind: needsExternalAuthorization ? 'external-effect-unconfirmed' : 'external-effect-authorized',
      source: 'authorization',
      value: input.authorizedExternalEffects === true ? 'authorized' : 'missing',
    });
  }
  if (needsExternalAuthorization) {
    blockers.push('orientation-external-effect-authorization-required');
  }

  if (route.requiresConfirmation && !needsExternalAuthorization) {
    evidence.push({ kind: 'local-confirmation-required', source: 'route', value: route.family });
  }

  const risk = resolveRisk(route, blockers, externalEffect);
  const requiresClarification = blockers.includes('orientation-ambiguous-intent')
    || blockers.some(blocker => blocker.startsWith('orientation-target-path-not-found:'))
    || route.blockers.includes('semantic-clarification-needed');
  const requiresConfirmation = needsExternalAuthorization || route.requiresConfirmation;
  const status = resolveStatus({ blockers, requiresClarification, requiresConfirmation });
  const confidence = resolveConfidence(route, blockers, requiresClarification);

  return {
    version: 'devseek.orientation-decision/v1',
    prompt,
    mode: route.mode,
    family: route.family,
    risk,
    confidence,
    status,
    evidence,
    blockers: [...new Set(blockers)],
    requiresClarification,
    requiresConfirmation,
    allowedToExecute: status === 'ready',
    route,
    reason: buildReason(route, risk, blockers),
  };
}

function collectPathEvidence(input: {
  prompt: string;
  route: TaskIntentRoute;
  knownPaths: string[] | undefined;
  evidence: OrientationEvidence[];
}): string[] {
  if (!input.knownPaths || input.knownPaths.length === 0) return [];
  if (!requiresExistingPathEvidence(input.route)) return [];

  const known = new Set(input.knownPaths.map(normalizeEvidencePath));
  const mentioned = collectMentionedPaths(input.prompt);
  const blockers: string[] = [];
  for (const targetPath of mentioned) {
    const normalized = normalizeEvidencePath(targetPath);
    if (known.has(normalized)) {
      input.evidence.push({ kind: 'target-path-known', source: 'context', value: targetPath });
    } else {
      input.evidence.push({ kind: 'target-path-missing', source: 'context', value: targetPath });
      blockers.push(`orientation-target-path-not-found:${targetPath}`);
    }
  }
  return blockers;
}

function requiresExistingPathEvidence(route: TaskIntentRoute): boolean {
  return route.family === 'read-only-advisory'
    || route.family === 'review'
    || route.family === 'terminal-validation'
    || route.mode === 'inspect'
    || route.mode === 'plan'
    || route.mode === 'run';
}

function collectMentionedPaths(prompt: string): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  MENTIONED_PATH_RE.lastIndex = 0;
  while ((match = MENTIONED_PATH_RE.exec(prompt)) !== null) {
    const value = stripTrailingPunctuation(match[1]);
    if (value && !paths.includes(value)) paths.push(value);
  }
  return paths.slice(0, 12);
}

function normalizeEvidencePath(value: string): string {
  return stripTrailingPunctuation(value)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}

function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.,;:!?，。；：！？）)\]]+$/g, '');
}

function hasMixedLanguageInput(prompt: string): boolean {
  return CJK_RE.test(prompt) && LATIN_WORD_RE.test(prompt);
}

function hasAmbiguousActionAlternatives(prompt: string): boolean {
  return ALTERNATIVE_RE.test(prompt)
    && MUTATION_ALTERNATIVE_RE.test(prompt)
    && READ_ONLY_ALTERNATIVE_RE.test(prompt);
}

function resolveRisk(
  route: TaskIntentRoute,
  blockers: string[],
  externalEffect: boolean,
): OrientationRisk {
  if (route.family === 'destructive' || route.mode === 'destructive') return 'destructive';
  if (externalEffect || blockers.includes('orientation-external-effect-authorization-required')) return 'high';
  if (blockers.length > 0 || route.requiresConfirmation) return 'medium';
  if (route.family === 'simple-file' || route.family === 'file-artifact' || route.family === 'standalone-program') return 'medium';
  if (route.family === 'existing-project-edit' || route.family === 'general-edit' || route.family === 'terminal-validation') return 'medium';
  return 'low';
}

function resolveStatus(input: {
  blockers: string[];
  requiresClarification: boolean;
  requiresConfirmation: boolean;
}): OrientationStatus {
  if (input.blockers.some(blocker => blocker.startsWith('orientation-target-path-not-found:'))) return 'blocked';
  if (input.requiresClarification) return 'needs-clarification';
  if (input.requiresConfirmation) return 'needs-confirmation';
  return 'ready';
}

function resolveConfidence(
  route: TaskIntentRoute,
  blockers: string[],
  requiresClarification: boolean,
): number {
  const routeConfidence = Math.max(0, Math.min(1, route.classification.confidence));
  const penalty = (requiresClarification ? 0.25 : 0)
    + (blockers.some(blocker => blocker.startsWith('orientation-target-path-not-found:')) ? 0.2 : 0)
    + (blockers.includes('orientation-external-effect-authorization-required') ? 0.1 : 0);
  return Math.max(0.05, Number((routeConfidence - penalty).toFixed(3)));
}

function buildReason(route: TaskIntentRoute, risk: OrientationRisk, blockers: string[]): string {
  if (blockers.length > 0) return `orientation:${route.family}:${risk}:${blockers.join(',')}`;
  return `orientation:${route.family}:${risk}:ready`;
}
