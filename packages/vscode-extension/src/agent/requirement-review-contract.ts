import type {
  RequirementReviewDecision,
  RequirementReviewFinding,
} from './requirement-review-ledger';

const MIN_FINDING_CONFIDENCE = 0.8;

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
  requirement_quote?: unknown;
  status?: unknown;
  evidence?: unknown;
}

interface RawReviewFinding {
  requirement_id?: unknown;
  requirement_quote?: unknown;
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

export const REQUIREMENT_REVIEW_SCHEMA = [
  '{',
  '  "requirement_checks": [{',
  '    "requirement_id": "R1",',
  '    "requirement_quote": "exact quote from the supplied inventory",',
  '    "status": "satisfied" | "violated",',
  '    "evidence": "concise source path/line or validation fact and execution path"',
  '  }],',
  '  "findings": [{',
  '    "requirement_id": "R1",',
  '    "requirement_quote": "exact quote from the supplied inventory",',
  '    "title": "imperative finding title, <= 80 chars",',
  '    "observed_behavior": "caller-observable behavior reached in final source",',
  '    "expected_behavior": "behavior required by the quoted requirement",',
  '    "counterexample": "concrete input/state sequence and actual versus required result",',
  '    "priority": 0,',
  '    "confidence_score": 0.0,',
  '    "code_location": {',
  '      "absolute_file_path": "/absolute/path/to/file",',
  '      "line_range": {"start": 1, "end": 1}',
  '    }',
  '  }],',
  '  "overall_correctness": "patch is correct" | "patch is incorrect",',
  '  "overall_explanation": "1-3 sentences",',
  '  "overall_confidence_score": 0.0',
  '}',
].join('\n');

export function renderRequirementInventory(userPrompt: string): string {
  const requirements = extractRequirementClauses(userPrompt);
  return requirements.length > 0
    ? requirements.map(requirement => `[${requirement.id}] ${requirement.quote}`).join('\n')
    : '(no auditable requirement clause found)';
}

export function parseIndependentReviewResponse(
  response: RequirementReviewInvocationResult,
  snapshots: readonly RequirementReviewSourceSnapshot[],
  userPrompt = '',
): RequirementReviewDecision {
  if (response.toolCount > 0) {
    return indeterminateDecision('隔离审查者违反只读协议并请求了工具。');
  }
  let raw: RawReviewResult;
  try {
    raw = JSON.parse(stripSingleJsonFence(response.text)) as RawReviewResult;
  } catch {
    return indeterminateDecision('隔离审查输出不是严格 JSON。');
  }
  if (raw.overall_correctness !== 'patch is correct'
    && raw.overall_correctness !== 'patch is incorrect') {
    return indeterminateDecision('隔离审查缺少有效的 overall_correctness。');
  }
  if (!Array.isArray(raw.findings) || typeof raw.overall_explanation !== 'string') {
    return indeterminateDecision('隔离审查缺少 findings 或 overall_explanation。');
  }
  if (!isConfidence(raw.overall_confidence_score) || !raw.overall_explanation.trim()) {
    return indeterminateDecision('隔离审查缺少可信的总体解释或置信度。');
  }

  const requirements = extractRequirementClauses(userPrompt);
  if (requirements.length === 0) {
    return indeterminateDecision('原始需求无法形成可追溯的审查清单。');
  }
  const checks = normalizeRequirementChecks(raw.requirement_checks, requirements);
  if (!checks) {
    return indeterminateDecision('隔离审查未逐条覆盖需求清单，或需求引用不是原文。');
  }

  const findings: RequirementReviewFinding[] = [];
  for (const item of raw.findings as RawReviewFinding[]) {
    const finding = normalizeFinding(item, snapshots, checks);
    if (!finding) {
      return indeterminateDecision('隔离审查 finding 缺少可追溯证据、包含推测，或反转了需求方向。');
    }
    findings.push(finding);
  }
  const violatedIds = [...checks.values()]
    .filter(check => check.status === 'violated')
    .map(check => check.requirement.id);
  if (!sameStringSet(violatedIds, findings.map(finding => finding.requirementId))) {
    return indeterminateDecision('隔离审查的 violated 清单与可执行 findings 不一致。');
  }
  const shouldPass = violatedIds.length === 0;
  if ((raw.overall_correctness === 'patch is correct') !== shouldPass) {
    return indeterminateDecision('隔离审查总体结论与逐条需求检查不一致。');
  }
  return {
    status: shouldPass ? 'passed' : 'failed',
    explanation: raw.overall_explanation.trim(),
    findings,
  };
}

function extractRequirementClauses(userPrompt: string): RequirementClause[] {
  const clauses: RequirementClause[] = [];
  let insideCodeFence = false;
  for (const rawLine of String(userPrompt || '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (insideCodeFence || !trimmed || /^#{1,6}\s+/.test(trimmed)) continue;
    const quote = trimmed
      .replace(/^>\s*/, '')
      .replace(/^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/, '')
      .trim();
    if (!quote || isRequirementSectionLabel(quote)) continue;
    clauses.push({ id: `R${clauses.length + 1}`, quote });
  }
  return clauses;
}

function isRequirementSectionLabel(value: string): boolean {
  return value.length <= 100
    && /[:：]$/.test(value)
    && !/[。.!?！？；;]/u.test(value.slice(0, -1));
}

function normalizeRequirementChecks(
  rawChecks: unknown,
  requirements: readonly RequirementClause[],
): Map<string, NormalizedRequirementCheck> | undefined {
  if (!Array.isArray(rawChecks) || rawChecks.length !== requirements.length) return undefined;
  const checks = new Map<string, NormalizedRequirementCheck>();
  for (let index = 0; index < requirements.length; index++) {
    const raw = rawChecks[index] as RawRequirementCheck;
    const requirement = requirements[index];
    if (!raw
      || raw.requirement_id !== requirement.id
      || normalizeRequirementText(raw.requirement_quote) !== normalizeRequirementText(requirement.quote)
      || (raw.status !== 'satisfied' && raw.status !== 'violated')
      || typeof raw.evidence !== 'string'
      || !raw.evidence.trim()) {
      return undefined;
    }
    checks.set(requirement.id, {
      requirement,
      status: raw.status,
      evidence: raw.evidence.trim(),
    });
  }
  return checks;
}

function normalizeFinding(
  raw: RawReviewFinding,
  snapshots: readonly RequirementReviewSourceSnapshot[],
  checks: ReadonlyMap<string, NormalizedRequirementCheck>,
): RequirementReviewFinding | undefined {
  const requirementId = typeof raw?.requirement_id === 'string' ? raw.requirement_id : '';
  const check = checks.get(requirementId);
  const location = raw?.code_location;
  const requestedPath = typeof location?.absolute_file_path === 'string'
    ? location.absolute_file_path
    : '';
  const snapshot = snapshots.find(item => sameSourcePath(item, requestedPath));
  const start = location?.line_range?.start;
  const end = location?.line_range?.end;
  const priority = raw?.priority;
  const confidence = raw?.confidence_score;
  if (!check
    || check.status !== 'violated'
    || normalizeRequirementText(raw.requirement_quote) !== normalizeRequirementText(check.requirement.quote)
    || !snapshot
    || typeof raw?.title !== 'string'
    || typeof raw?.observed_behavior !== 'string'
    || typeof raw?.expected_behavior !== 'string'
    || typeof raw?.counterexample !== 'string'
    || !Number.isInteger(start)
    || Number(start) < 1
    || Number(start) > snapshot.lineCount
    || !Number.isInteger(end)
    || Number(end) < Number(start)
    || Number(end) > snapshot.lineCount
    || Number(end) - Number(start) > 10
    || !Number.isInteger(priority)
    || Number(priority) < 0
    || Number(priority) > 3
    || !isConfidence(confidence)
    || confidence < MIN_FINDING_CONFIDENCE
    || !raw.title.trim()
    || !raw.observed_behavior.trim()
    || !raw.expected_behavior.trim()
    || !raw.counterexample.trim()
    || isExplicitNonFinding(raw)
    || isSpeculativeFinding(raw)
    || findingReversesExplicitRequirement(raw)) {
    return undefined;
  }
  return {
    requirementId,
    requirement: check.requirement.quote,
    title: raw.title.trim().slice(0, 120),
    observedBehavior: raw.observed_behavior.trim(),
    expectedBehavior: raw.expected_behavior.trim(),
    counterexample: raw.counterexample.trim(),
    priority: Number(priority) as 0 | 1 | 2 | 3,
    confidence,
    path: snapshot.path,
    line: Number(start),
  };
}

function isExplicitNonFinding(raw: RawReviewFinding): boolean {
  const text = findingTraceText(raw);
  return /(?:no (?:actionable )?defect|无(?:可执行|实际)?缺陷|不是缺陷)/iu.test(text)
    || /(?:this|that|it|the (?:implementation|code|behavior)) (?:is|remains|behaves) (?:correct|valid|safe)/iu.test(text)
    || /(?:meets|satisfies|conforms to) (?:the )?(?:stated )?requirement/iu.test(text)
    || /(?:符合|满足).{0,24}(?:需求|要求)/u.test(text)
    || (/\bwhich should never happen\b/iu.test(text) && /\bno (?:concrete |reachable )?path\b/iu.test(text));
}

function isSpeculativeFinding(raw: RawReviewFinding): boolean {
  const text = findingTraceText(raw);
  return /\b(?:might|perhaps|possibly|hypothetical(?:ly)?)\b/iu.test(text)
    || /\bmay be acceptable\b|\bcould be considered\b|\bnatural expectation\b/iu.test(text)
    || /\b(?:does not|doesn't|did not) (?:explicitly )?(?:state|specify|require)\b/iu.test(text)
    || /(?:可能|也许|假设性|未明确(?:说明|要求)|没有明确(?:说明|要求)|自然预期|可以视为)/u.test(text);
}

function findingReversesExplicitRequirement(raw: RawReviewFinding): boolean {
  const requirement = normalizeRequirementText(raw.requirement_quote).toLowerCase();
  const expected = normalizeRequirementText(raw.expected_behavior).toLowerCase();
  const positivePermission = assertsPositivePermission(expected);
  const restrictive = /\bonly\b|\bat most\b|仅能|只能|仅可|只允许|不得超过/u.test(requirement);
  const broadens = /\beven (?:if|when)\b|\bregardless of\b|\bwhether or not\b|即使|无论/iu.test(expected);
  if (restrictive && broadens && positivePermission) return true;

  const rejects = /\b(?:reject|deny|forbid)\b|拒绝|禁止|不接受|不得/u.test(requirement);
  if (rejects && positivePermission) return true;
  return /\b(?:not required|need not|required only optionally)\b/iu.test(expected)
    || /(?:不是要求|无需|不必|可选行为)/u.test(expected);
}

function assertsPositivePermission(value: string): boolean {
  return /\b(?:should|must|may|can)\s+(?!not\b|never\b)(?:still\s+)?(?:allow|accept|succeed|reuse|return true|be reused|be accepted)\b/iu.test(value)
    || /(?<!不)(?:应当|应该|可以|允许).{0,24}(?:允许|接受|成功|复用|重用|再次使用|返回 true)/u.test(value);
}

function findingTraceText(raw: RawReviewFinding): string {
  return [
    raw.title,
    raw.observed_behavior,
    raw.expected_behavior,
    raw.counterexample,
  ].map(value => String(value || '')).join(' ');
}

function sameSourcePath(snapshot: RequirementReviewSourceSnapshot, requestedPath: string): boolean {
  const normalized = requestedPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized === snapshot.path
    || normalized === snapshot.absolutePath.replace(/\\/g, '/')
    || normalized.endsWith(`/${snapshot.path}`);
}

function normalizeRequirementText(value: unknown): string {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === left.length
    && rightSet.size === right.length
    && [...leftSet].every(value => rightSet.has(value));
}

function stripSingleJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (match?.[1] ?? trimmed).trim();
}

function indeterminateDecision(explanation: string): RequirementReviewDecision {
  return { status: 'indeterminate', explanation, findings: [] };
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
