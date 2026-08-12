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
    const fallbackFindings = normalizeFindingsAgainstRequirements(raw.findings, snapshots, requirements);
    if (raw.overall_correctness === 'patch is incorrect' && fallbackFindings && fallbackFindings.length > 0) {
      return {
        status: 'failed',
        explanation: '隔离审查未逐条覆盖需求清单；已保留可追溯的源码反例并阻断完成。',
        findings: fallbackFindings,
      };
    }
    return indeterminateDecision('隔离审查未逐条覆盖需求清单，或需求引用不是原文。');
  }
  const localContradiction = findLocalSemanticContradiction(checks, snapshots);
  if (localContradiction) {
    return {
      status: 'failed',
      explanation: '本地最终源码合约发现隔离审查结论与源码执行路径不一致。',
      findings: [localContradiction],
    };
  }

  const findings: RequirementReviewFinding[] = [];
  const normalizedFindings = normalizeFindings(raw.findings, snapshots, checks);
  if (!normalizedFindings) {
    return indeterminateDecision('隔离审查 finding 缺少可追溯证据、包含推测，或反转了需求方向。');
  }
  findings.push(...normalizedFindings);
  const violatedIds = [...checks.values()]
    .filter(check => check.status === 'violated')
    .map(check => check.requirement.id);
  if (!sameStringSet(violatedIds, findings.map(finding => finding.requirementId))) {
    if (findings.length > 0) {
      return {
        status: 'failed',
        explanation: '隔离审查的逐条状态与 findings 不完全一致；已保留可追溯的源码反例并阻断完成。',
        findings,
      };
    }
    return indeterminateDecision('隔离审查的 violated 清单与可执行 findings 不一致。');
  }
  if (findings.length > 0) {
    return {
      status: 'failed',
      explanation: raw.overall_explanation.trim(),
      findings,
    };
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

function normalizeFindingsAgainstRequirements(
  rawFindings: unknown,
  snapshots: readonly RequirementReviewSourceSnapshot[],
  requirements: readonly RequirementClause[],
): RequirementReviewFinding[] | undefined {
  return normalizeFindings(rawFindings, snapshots, requirementChecksFromInventory(requirements), {
    allowPartial: true,
  });
}

function normalizeFindings(
  rawFindings: unknown,
  snapshots: readonly RequirementReviewSourceSnapshot[],
  checks: ReadonlyMap<string, NormalizedRequirementCheck>,
  options: { allowPartial?: boolean } = {},
): RequirementReviewFinding[] | undefined {
  if (!Array.isArray(rawFindings)) return undefined;
  const findings: RequirementReviewFinding[] = [];
  for (const item of rawFindings as RawReviewFinding[]) {
    const finding = normalizeFinding(item, snapshots, checks);
    if (!finding) {
      if (options.allowPartial) continue;
      return undefined;
    }
    findings.push(finding);
  }
  if (findings.length === 0 && (rawFindings as unknown[]).length > 0 && options.allowPartial) {
    return undefined;
  }
  return findings;
}

function findLocalSemanticContradiction(
  checks: ReadonlyMap<string, NormalizedRequirementCheck>,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding | undefined {
  for (const check of checks.values()) {
    if (check.status !== 'satisfied') continue;
    if (requiresFailurePathEvidence(check.requirement.quote)) {
      const rejectionFinding = findAmbiguousRejectionContract(check, snapshots);
      if (rejectionFinding) return rejectionFinding;
    }
    if (requiresUsedIdentityPermanence(check.requirement.quote)) {
      const usedIdFinding = findUsedIdentityPermanenceContract(check, snapshots);
      if (usedIdFinding) return usedIdFinding;
    }
    if (requiresPartialFillStateConsistency(check.requirement.quote)) {
      const partialFillFinding = findPartialFillStateConsistencyContract(check, snapshots);
      if (partialFillFinding) return partialFillFinding;
    }
  }
  return undefined;
}

function findAmbiguousRejectionContract(
  check: NormalizedRequirementCheck,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding | undefined {
  for (const snapshot of snapshots) {
    if (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(snapshot.path)) continue;
    const source = stripCppComments(snapshot.content);
    const submitBody = findCppVectorSubmitBody(source);
    if (!submitBody) continue;
    if (hasDistinctCppRejectionChannel(submitBody)) continue;
    const ambiguousLine = findFirstLine(snapshot, /return\s+(?:trades|\{\})\s*;/);
    if (!ambiguousLine) continue;
    if (!/(?:empty|duplicate|already[- ]used|non[- ]finite|nan|isfinite|isnan|isinf|quantity|id|price|valid|hasOrder|find|<=\s*0|空|重复|已使用|非有限|数量|价格|无效|非法)/iu
      .test(submitBody)) continue;
    return {
      requirementId: check.requirement.id,
      requirement: check.requirement.quote,
      title: 'Expose invalid submit rejection distinctly',
      observedBehavior: 'Invalid submit paths return an empty trade vector, which is also a legitimate successful no-trade result.',
      expectedBehavior: 'Rejected empty, duplicate, already-used, non-finite, or non-positive orders must be caller-observable through the fixed API, such as throwing std::invalid_argument.',
      counterexample: 'A valid non-crossing order and an invalid duplicate or NaN order can both return an empty trade list, so the caller cannot distinguish rejection from successful no-trade behavior.',
      priority: 1,
      confidence: 0.95,
      path: snapshot.path,
      line: ambiguousLine,
    };
  }
  return undefined;
}

function findUsedIdentityPermanenceContract(
  check: NormalizedRequirementCheck,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding | undefined {
  const combined = stripCppComments(snapshots.map(snapshot => snapshot.content).join('\n'));
  if (!hasActiveOrderIdentityLookup(combined)
    || !hasLifecycleIdentityErase(combined)
    || hasPersistentUsedIdentityStore(combined)) {
    return undefined;
  }
  const snapshot = snapshots.find(item => hasLifecycleIdentityErase(stripCppComments(item.content)));
  if (!snapshot) return undefined;
  return {
    requirementId: check.requirement.id,
    requirement: check.requirement.quote,
    title: 'Preserve used order identifiers after lifecycle exit',
    observedBehavior: 'The implementation validates duplicates only against active orders and erases ids when orders complete or are cancelled.',
    expectedBehavior: 'An already-used id must remain rejected after completion or cancellation unless the user explicitly permits reuse.',
    counterexample: 'Submit id A, let A complete or cancel A, then submit A again; after the active-order index erases A, the duplicate check no longer sees A as already used.',
    priority: 1,
    confidence: 0.95,
    path: snapshot.path,
    line: findFirstLine(snapshot, identityEraseLinePattern()) ?? 1,
  };
}

function findPartialFillStateConsistencyContract(
  check: NormalizedRequirementCheck,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding | undefined {
  for (const snapshot of snapshots) {
    if (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(snapshot.path)) continue;
    const source = stripCppComments(snapshot.content);
    if (!hasActiveQuantityCopyIndex(source) || !remainingReadsActiveQuantityIndex(source)) continue;
    const staleLine = findPartialFillAdvanceWithoutIndexSyncLine(snapshot);
    if (!staleLine) continue;
    return {
      requirementId: check.requirement.id,
      requirement: check.requirement.quote,
      title: 'Synchronize remaining quantity after partial fills',
      observedBehavior: 'A partial-fill branch decrements the resting order in the price-level container but advances the iterator without updating the id index that remaining() reads.',
      expectedBehavior: 'Partial fills must keep the public remaining quantity and order-book state synchronized, preferably by storing one mutable owner and indexing locations rather than copies.',
      counterexample: 'Submit buy b1 quantity 2 at 9, then submit sell s1 quantity 1 at 9. The resting list entry becomes quantity 1, but the id index can still return the stale pre-fill quantity for remaining("b1").',
      priority: 1,
      confidence: 0.93,
      path: snapshot.path,
      line: staleLine,
    };
  }
  return undefined;
}

function hasDistinctCppRejectionChannel(source: string): boolean {
  return /\bthrow\b|\b(?:std::|tl::)?expected\s*</.test(stripCppComments(source));
}

function requiresUsedIdentityPermanence(quote: string): boolean {
  return /(?:already[- ]used|used id|ever[- ]used|previously used|已使用|用过|曾用|历史.*id)/iu
    .test(normalizeRequirementText(quote));
}

function requiresPartialFillStateConsistency(quote: string): boolean {
  return /(?:partial(?:ly)?|remaining|remain(?:s|ing)? quantity|quantity|部分成交|余量|剩余|数量|成交量)/iu
    .test(normalizeRequirementText(quote));
}

function hasPersistentUsedIdentityStore(source: string): boolean {
  const code = stripCppComments(source);
  return /(?:used|seen|retired|consumed|historical|history|ever|all)[A-Za-z0-9_]*(?:ids?|orderIds?)_?\b/i.test(code)
    || /\b(?:ids?|orderIds?)_[A-Za-z0-9_]*(?:used|seen|retired|consumed|historical|history|ever)\b/i.test(code)
    || /std::unordered_set\s*<\s*std::string\s*>\s*(?:used|seen|retired|consumed|historical|history|ever|all)[A-Za-z0-9_]*(?:ids?|orderIds?)/i.test(code)
    || /std::set\s*<\s*std::string\s*>\s*(?:used|seen|retired|consumed|historical|history|ever|all)[A-Za-z0-9_]*(?:ids?|orderIds?)/i.test(code);
}

function findCppVectorSubmitBody(source: string): string | undefined {
  const match = /\bstd\s*::\s*vector\s*<[\s\S]{1,200}?>\s+(?:[A-Za-z_]\w*::)*submit\s*\([^)]*\)\s*\{/m.exec(source);
  if (!match) return undefined;
  const openBraceIndex = source.indexOf('{', match.index);
  if (openBraceIndex < 0) return undefined;
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, index);
    }
  }
  return source.slice(openBraceIndex + 1);
}

function hasActiveOrderIdentityLookup(source: string): boolean {
  return activeIdentityIndexNames().some(name => (
    new RegExp(`\\b${name}\\s*\\.\\s*find\\s*\\([^)]*\\bid`, 'i').test(source)
    || new RegExp(`\\b${name}\\s*\\.\\s*contains\\s*\\([^)]*\\bid`, 'i').test(source)
  )) || /\bhasOrder\s*\([^)]*\bid\b/i.test(source);
}

function hasActiveQuantityCopyIndex(source: string): boolean {
  const code = stripCppComments(source);
  return activeIdentityIndexNames().some(name => {
    const declaration = new RegExp(
      `\\bstd\\s*::\\s*(?:unordered_)?map\\s*<\\s*std\\s*::\\s*string\\s*,\\s*(?:OrderEntry|Order|Entry)\\b[\\s\\S]{0,120}>\\s*${name}\\b`,
      'i',
    );
    const copyAssignment = new RegExp(
      `\\b${name}\\s*\\[[^\\]]*\\bid\\b[^\\]]*\\]\\s*=\\s*(?:order|entry|\\*?entryIt)\\b`,
      'i',
    );
    return declaration.test(code) || copyAssignment.test(code);
  });
}

function remainingReadsActiveQuantityIndex(source: string): boolean {
  const body = findCppNamedFunctionBody(source, 'remaining');
  if (!body) return false;
  return activeIdentityIndexNames().some(name => {
    const lookup = new RegExp(`\\b${name}\\s*\\.\\s*(?:find|at)\\s*\\(|\\b${name}\\s*\\[`, 'i');
    return lookup.test(body) && /\b(?:it|entry|found)\s*->\s*second\s*\.\s*(?:quantity|qty)\b|\.\s*(?:quantity|qty)\b/i.test(body);
  });
}

function findPartialFillAdvanceWithoutIndexSyncLine(
  snapshot: RequirementReviewSourceSnapshot,
): number | undefined {
  const lines = stripCppComments(snapshot.content).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\belse\s*\{/.test(lines[index])) continue;
    const branch = lines.slice(index, Math.min(lines.length, index + 8)).join('\n');
    if (!/(?:\+\+\s*entryIt|\bentryIt\s*\+\+)\s*;/.test(branch)) continue;
    if (/\b(?:find|at)\s*\([^)]*entryIt\s*->\s*id|->\s*second\s*\.\s*(?:quantity|qty)\s*=|\[\s*entryIt\s*->\s*id\s*\]\s*\.\s*(?:quantity|qty)\s*=/i.test(branch)) continue;
    const context = lines.slice(Math.max(0, index - 32), Math.min(lines.length, index + 8)).join('\n');
    if (/\bentryIt\s*->\s*(?:quantity|qty)\s*-=/i.test(context)
      && /\border\s*\.\s*(?:quantity|qty)\s*-=/i.test(context)
      && /\btrade/i.test(context)) {
      return index + 1;
    }
  }
  return undefined;
}

function hasLifecycleIdentityErase(source: string): boolean {
  return identityEraseLinePattern().test(source);
}

function identityEraseLinePattern(): RegExp {
  return /\b(?:order_map_|orders_|active_orders_|activeOrders|index_|locations_|orderIndex_|order_index_)\s*\.\s*erase\s*\(/i;
}

function activeIdentityIndexNames(): string[] {
  return [
    'order_map_',
    'orders_',
    'active_orders_',
    'activeOrders',
    'idToEntry_',
    'id_to_entry_',
    'entriesById_',
    'ordersById_',
    'index_',
    'locations_',
    'orderIndex_',
    'order_index_',
  ];
}

function findCppNamedFunctionBody(source: string, functionName: string): string | undefined {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b(?:[A-Za-z_:<>~*&\\s]+\\s+)?(?:[A-Za-z_]\\w*::)*${escapedName}\\s*\\([^)]*\\)\\s*(?:const\\s*)?\\{`, 'm').exec(source);
  if (!match) return undefined;
  const openBraceIndex = source.indexOf('{', match.index);
  if (openBraceIndex < 0) return undefined;
  let depth = 0;
  for (let index = openBraceIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openBraceIndex + 1, index);
    }
  }
  return source.slice(openBraceIndex + 1);
}

function stripCppComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ');
}

function findFirstLine(snapshot: RequirementReviewSourceSnapshot, pattern: RegExp): number | undefined {
  const lines = snapshot.content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index + 1;
  }
  return undefined;
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
      || !raw.evidence.trim()
      || !requirementEvidenceMatchesContract(requirement.quote, raw.status, raw.evidence)) {
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

function requirementChecksFromInventory(
  requirements: readonly RequirementClause[],
): Map<string, NormalizedRequirementCheck> {
  const checks = new Map<string, NormalizedRequirementCheck>();
  for (const requirement of requirements) {
    checks.set(requirement.id, {
      requirement,
      status: 'violated',
      evidence: 'fallback-finding-only',
    });
  }
  return checks;
}

function requirementEvidenceMatchesContract(
  quote: string,
  status: 'satisfied' | 'violated',
  evidence: string,
): boolean {
  if (status !== 'satisfied') return true;
  if (requiresOrderedTrace(quote) && !hasOrderedTraceEvidence(evidence)) return false;
  if (requiresFailurePathEvidence(quote) && !hasFailurePathEvidence(evidence)) return false;
  return true;
}

function requiresOrderedTrace(quote: string): boolean {
  return /(?:\border(?:ing|ed)?\b|\bpriority\b|\bfifo\b|\blifo\b|\bbest\b|\bminimum\b|\bmaximum\b|\bmin\b|\bmax\b|\bfirst\b|\blast\b|\bsort(?:ed|ing)?\b|顺序|优先|同价|最高|最低|最[大小]|先后|排序|撮合)/iu
    .test(normalizeRequirementText(quote));
}

function hasOrderedTraceEvidence(evidence: string): boolean {
  const text = normalizeRequirementText(evidence);
  return /(?:\btrace\b|\bsequence\b|\bscenario\b|\bcase\b|\bsimulat(?:e|ed|es|ion)\b|\btwo\b|\bthree\b|\b2\b|\b3\b|\bfirst\b|\bthen\b|\bnext\b|->|=>|轨迹|序列|场景|反例|两个|三个|多(?:个|元素)|先.*后|价格层|同价|begin|end|prev|comparator|greater|less)/iu
    .test(text);
}

function requiresFailurePathEvidence(quote: string): boolean {
  return /(?:\breject(?:s|ed|ion)?\b|\binvalid\b|\berror\b|\bfail(?:s|ed|ure)?\b|\bduplicate\b|\balready[- ]used\b|\bnon[- ]finite\b|\bnan\b|<=\s*0|\bnegative\b|\bempty\b|拒绝|非法|无效|重复|已使用|非有限|错误|失败)/iu
    .test(normalizeRequirementText(quote));
}

function hasFailurePathEvidence(evidence: string): boolean {
  const text = normalizeRequirementText(evidence);
  const hasRejectedInput = /(?:\bempty\b|\bduplicate\b|\balready[- ]used\b|\bused id\b|\bnan\b|\bnon[- ]finite\b|<=\s*0|\bnegative\b|\binvalid\b|\bbad\b|\bsecond\b|\bagain\b|空|重复|已使用|非有限|无效|非法|再次|第二次|数量|价格)/iu.test(text);
  const hasObservableChannel = /(?:\bthrow(?:s|n)?\b|\bexception\b|\binvalid_argument\b|\braise(?:s|d)?\b|\berror (?:status|result|code|object)\b|\bfailure result\b|\breturns? false\b|\breturns? (?:an? )?(?:error|failure)\b|\bstatus (?:is|=) (?:error|failed)\b|抛出|异常|错误(?:码|状态|结果)?|失败(?:状态|结果)?|返回\s*false|返回(?:错误|失败)|状态(?:为|是)(?:错误|失败))/iu.test(text);
  const hasAmbiguousEmptyResult = /(?:\breturns? (?:an? )?empty\b|\breturns? \{\}\b|\bempty (?:vector|list|trades?)\b|返回空|空\s*trades?)/iu.test(text)
    && !hasObservableChannel;
  return hasRejectedInput && hasObservableChannel && !hasAmbiguousEmptyResult;
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
