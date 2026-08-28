import type {
  RequirementReviewDecision,
  RequirementReviewFinding,
} from './requirement-review-ledger';

const MIN_REVIEW_CONFIDENCE = 0.8;
const MAX_FINDING_TITLE_CHARS = 80;
const MIN_REPORTED_EVIDENCE_QUOTE_CHARS = 24;
const MAX_REPORTED_EVIDENCE_QUOTE_CHARS = 4_000;

export interface RequirementReviewInvocationResult {
  text: string;
  toolCount: number;
}

export interface RequirementReviewSourceSnapshot {
  path: string;
  absolutePath: string;
  content: string;
  lineCount: number;
}

interface RequirementClause {
  id: string;
  quote: string;
}

interface RawRequirementCheck {
  requirement_id?: unknown;
  status?: unknown;
  evidence?: unknown;
}

interface RawReviewFinding {
  requirement_id?: unknown;
  evidence_authority?: unknown;
  evidence_quote?: unknown;
  title?: unknown;
  observed_behavior?: unknown;
  expected_behavior?: unknown;
  counterexample?: unknown;
  priority?: unknown;
  confidence_score?: unknown;
  code_location?: {
    absolute_file_path?: unknown;
    line_range?: { start?: unknown; end?: unknown };
  };
}

interface RawReviewResult {
  requirement_checks?: unknown;
  findings?: unknown;
  overall_correctness?: unknown;
  overall_explanation?: unknown;
  overall_confidence_score?: unknown;
}

interface NormalizedRequirementCheck {
  requirement: RequirementClause;
  status: 'satisfied' | 'violated';
  evidence: string;
}

type FindingNormalizationResult =
  | { ok: true; findings: RequirementReviewFinding[] }
  | { ok: false; diagnostic: string };

type FindingValidationResult =
  | { ok: true; finding: RequirementReviewFinding }
  | { ok: false; errors: string[] };

export const REQUIREMENT_REVIEW_SCHEMA = [
  '{',
  '  "requirement_checks": [{',
  '    "requirement_id": "R1",',
  '    "status": "satisfied" | "violated",',
  '    "evidence": "concise source path/line or validation fact and execution path"',
  '  }],',
  '  "findings": [{',
  '    "requirement_id": "R1",',
  '    "evidence_authority": "source-snapshot" | "reported-validation",',
  '    "evidence_quote": "exact contiguous quote from original requirements or validation fact; empty for source-snapshot",',
  '    "title": "imperative finding title, <= 80 chars",',
  '    "observed_behavior": "caller-observable behavior reached in final source",',
  '    "expected_behavior": "behavior required by the quoted requirement",',
  '    "counterexample": "concrete input/state sequence and actual versus required result",',
  '    "priority": 0,',
  '    "confidence_score": 0.8,',
  '    "code_location": {',
  '      "absolute_file_path": "/absolute/path/to/supplied/file",',
  '      "line_range": {"start": 1, "end": 1}',
  '    }',
  '  }],',
  '  "overall_correctness": "patch is correct" | "patch is incorrect",',
  '  "overall_explanation": "1-3 sentences",',
  '  "overall_confidence_score": 0.8',
  '}',
].join('\n');

/**
 * The local layer treats the user's text as opaque evidence. Semantic
 * decomposition belongs to the reviewer model, so typos and languages do not
 * change which requirements reach it.
 */
export function renderRequirementInventory(userPrompt: string): string {
  return JSON.stringify(requirementInventory(userPrompt).map(requirement => ({
    requirement_id: requirement.id,
    requirement_quote: requirement.quote,
  })), null, 2);
}

/**
 * Accepts or rejects a model-authored review proposal. This boundary validates
 * structure and concrete evidence references only; it never infers source
 * semantics from words in the prompt, response, file name, or source text.
 */
export function parseIndependentReviewResponse(
  response: RequirementReviewInvocationResult,
  snapshots: readonly RequirementReviewSourceSnapshot[],
  userPrompt = '',
  validationSummary = '',
): RequirementReviewDecision {
  if (response.toolCount > 0) {
    return indeterminateDecision('隔离审查者违反只读协议并请求了工具。');
  }
  if (snapshots.length === 0) {
    return indeterminateDecision('隔离审查缺少最终源码快照。');
  }

  const requirements = requirementInventory(userPrompt);
  if (requirements.length === 0) {
    return indeterminateDecision('原始用户需求为空，无法形成可追溯审查。');
  }

  const raw = parseStrictReviewJson(response.text);
  if (!raw) {
    return indeterminateDecision('隔离审查输出不是单一严格 JSON 对象。');
  }

  const checks = normalizeRequirementChecks(raw.requirement_checks, requirements);
  if (!checks) {
    return indeterminateDecision('隔离审查未按原始需求清单逐项、原文返回有效检查。');
  }

  const normalizedFindings = normalizeFindings(
    raw.findings,
    snapshots,
    checks,
    [userPrompt, validationSummary],
  );
  if (!normalizedFindings.ok) {
    return indeterminateDecision([
      '隔离审查 finding 缺少有效的需求引用、源码位置或可复现证据。',
      normalizedFindings.diagnostic,
    ].join(' '));
  }
  const findings = normalizedFindings.findings;

  const explanation = nonEmptyString(raw.overall_explanation);
  if (!explanation || !isReviewConfidence(raw.overall_confidence_score)) {
    return indeterminateDecision('隔离审查缺少可信的总体解释或置信度。');
  }
  if (raw.overall_correctness !== 'patch is correct'
    && raw.overall_correctness !== 'patch is incorrect') {
    return indeterminateDecision('隔离审查缺少有效的 overall_correctness。');
  }

  const violatedIds = [...checks.values()]
    .filter(check => check.status === 'violated')
    .map(check => check.requirement.id);
  const findingIds = findings.map(finding => finding.requirementId);
  if (!sameStringSet(violatedIds, findingIds)) {
    return indeterminateDecision('隔离审查的 violated 清单与 findings 引用不一致。');
  }

  const shouldPass = violatedIds.length === 0;
  if ((raw.overall_correctness === 'patch is correct') !== shouldPass) {
    return indeterminateDecision('隔离审查总体结论与逐项检查不一致。');
  }

  return {
    status: shouldPass ? 'passed' : 'failed',
    explanation,
    findings,
  };
}

function requirementInventory(userPrompt: string): RequirementClause[] {
  const quote = userPrompt.trim();
  return quote ? [{ id: 'R1', quote }] : [];
}

function parseStrictReviewJson(text: string): RawReviewResult | undefined {
  return parseSingleJsonObjectDocument(text) as RawReviewResult | undefined;
}

export function parseSingleJsonObjectDocument(text: string): Record<string, unknown> | undefined {
  const candidate = unwrapSingleJsonDocument(text);
  if (!candidate || !candidate.startsWith('{') || !candidate.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function unwrapSingleJsonDocument(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fences = [...trimmed.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/giu)];
  if (fences.length !== 1) return undefined;
  const fence = fences[0];
  const start = fence.index ?? 0;
  const outside = `${trimmed.slice(0, start)}${trimmed.slice(start + fence[0].length)}`;
  if (/```|[\[\]{}]/u.test(outside)) return undefined;
  return fence[1]?.trim() || undefined;
}

function normalizeRequirementChecks(
  rawChecks: unknown,
  requirements: readonly RequirementClause[],
): Map<string, NormalizedRequirementCheck> | undefined {
  if (!Array.isArray(rawChecks) || rawChecks.length !== requirements.length) return undefined;
  const checks = new Map<string, NormalizedRequirementCheck>();
  for (let index = 0; index < requirements.length; index += 1) {
    const raw = rawChecks[index] as RawRequirementCheck | undefined;
    const requirement = requirements[index];
    if (!raw
      || raw.requirement_id !== requirement.id
      || (raw.status !== 'satisfied' && raw.status !== 'violated')) {
      return undefined;
    }
    const evidence = nonEmptyString(raw.evidence);
    if (!evidence) return undefined;
    checks.set(requirement.id, {
      requirement,
      status: raw.status,
      evidence,
    });
  }
  return checks;
}

function normalizeFindings(
  rawFindings: unknown,
  snapshots: readonly RequirementReviewSourceSnapshot[],
  checks: ReadonlyMap<string, NormalizedRequirementCheck>,
  reportedEvidenceSources: readonly string[],
): FindingNormalizationResult {
  if (!Array.isArray(rawFindings)) {
    return { ok: false, diagnostic: 'findings 必须是 JSON 数组。' };
  }
  const findings: RequirementReviewFinding[] = [];
  for (let index = 0; index < rawFindings.length; index += 1) {
    const result = normalizeFinding(
      rawFindings[index] as RawReviewFinding,
      snapshots,
      checks,
      reportedEvidenceSources,
    );
    if (!result.ok) {
      return {
        ok: false,
        diagnostic: `finding #${index + 1} 无效：${result.errors.join('；')}。`,
      };
    }
    findings.push(result.finding);
  }
  return { ok: true, findings };
}

function normalizeFinding(
  raw: RawReviewFinding,
  snapshots: readonly RequirementReviewSourceSnapshot[],
  checks: ReadonlyMap<string, NormalizedRequirementCheck>,
  reportedEvidenceSources: readonly string[],
): FindingValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['必须是 JSON 对象'] };
  }
  const errors: string[] = [];
  const requirementId = typeof raw.requirement_id === 'string' ? raw.requirement_id : '';
  const check = checks.get(requirementId);
  if (!check || check.status !== 'violated') {
    errors.push('requirement_id 必须引用 status=violated 的现有 requirement_check');
  }

  const title = normalizeFindingTitle(raw.title);
  const evidenceAuthority = raw.evidence_authority;
  const evidenceQuote = nonEmptyString(raw.evidence_quote);
  const observedBehavior = nonEmptyString(raw.observed_behavior);
  const expectedBehavior = nonEmptyString(raw.expected_behavior);
  const counterexample = nonEmptyString(raw.counterexample);
  if (!title) errors.push('title 必须是非空字符串');
  if (evidenceAuthority !== 'source-snapshot' && evidenceAuthority !== 'reported-validation') {
    errors.push('evidence_authority 必须是 source-snapshot 或 reported-validation');
  }
  if (evidenceAuthority === 'reported-validation') {
    if (!evidenceQuote
        || evidenceQuote.length < MIN_REPORTED_EVIDENCE_QUOTE_CHARS
        || evidenceQuote.length > MAX_REPORTED_EVIDENCE_QUOTE_CHARS
        || !reportedEvidenceSources.some(source => source.includes(evidenceQuote))) {
      errors.push('reported-validation 的 evidence_quote 必须逐字引用已提供的原始需求或验证事实');
    }
  } else if (evidenceQuote) {
    errors.push('source-snapshot 的 evidence_quote 必须为空');
  }
  if (!observedBehavior) errors.push('observed_behavior 必须是非空字符串');
  if (!expectedBehavior) errors.push('expected_behavior 必须是非空字符串');
  if (!counterexample) errors.push('counterexample 必须是非空字符串');

  if (!isPriority(raw.priority)) errors.push('priority 必须是 0..3 的整数');
  if (!isReviewConfidence(raw.confidence_score)) {
    errors.push(`confidence_score 必须是 ${MIN_REVIEW_CONFIDENCE}..1 的有限数字`);
  }
  const absolutePath = nonEmptyString(raw.code_location?.absolute_file_path);
  const snapshot = absolutePath
    ? snapshots.find(candidate => candidate.absolutePath === absolutePath)
    : undefined;
  const start = raw.code_location?.line_range?.start;
  const end = raw.code_location?.line_range?.end;
  if (!snapshot) {
    errors.push('code_location.absolute_file_path 必须精确匹配一个已提供源码快照');
  } else if (!Number.isInteger(start)
      || !Number.isInteger(end)
      || (start as number) < 1
      || (end as number) < (start as number)
      || (end as number) > snapshot.lineCount) {
    errors.push(`code_location.line_range 必须是 1..${snapshot.lineCount} 内有界的整数行号`);
  }
  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    finding: {
      requirementId,
      requirement: check!.requirement.quote,
      evidenceAuthority: evidenceAuthority as RequirementReviewFinding['evidenceAuthority'],
      ...(evidenceQuote ? { evidenceQuote } : {}),
      title: title!,
      observedBehavior: observedBehavior!,
      expectedBehavior: expectedBehavior!,
      counterexample: counterexample!,
      priority: raw.priority as 0 | 1 | 2 | 3,
      confidence: raw.confidence_score as number,
      path: snapshot!.path,
      line: start as number,
    },
  };
}

function normalizeFindingTitle(value: unknown): string | undefined {
  const title = nonEmptyString(value);
  return title
    ? Array.from(title).slice(0, MAX_FINDING_TITLE_CHARS).join('')
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function isReviewConfidence(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= MIN_REVIEW_CONFIDENCE
    && value <= 1;
}

function isPriority(value: unknown): value is 0 | 1 | 2 | 3 {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0 && value <= 3;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size
    && [...leftSet].every(value => rightSet.has(value));
}

function indeterminateDecision(explanation: string): RequirementReviewDecision {
  return { status: 'indeterminate', explanation, findings: [] };
}
