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
  requirements_coverage?: unknown;
  conclusion?: unknown;
  test_evidence?: { exit_code?: unknown; compiler_warnings?: unknown };
}

interface NormalizedRequirementCheck {
  requirement: RequirementClause;
  status: 'satisfied' | 'violated';
  evidence: string;
}

interface RequirementCheckNormalizationResult {
  checks?: Map<string, NormalizedRequirementCheck>;
  rejectionReason?: string;
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
    return localSemanticFallbackDecision('隔离审查者违反只读协议并请求了工具。', snapshots, userPrompt);
  }
  const requirements = extractRequirementClauses(userPrompt);
  if (requirements.length === 0) {
    return indeterminateDecision('原始需求无法形成可追溯的审查清单。');
  }
  let raw: RawReviewResult;
  try {
    raw = parseReviewJsonFromResponseText(response.text, requirements);
  } catch {
    return localSemanticFallbackDecision(
      '隔离审查输出不是严格 JSON。',
      snapshots,
      userPrompt,
    );
  }
  raw = normalizeReportStyleReviewResult(raw, requirements);
  if (raw.overall_correctness !== 'patch is correct'
    && raw.overall_correctness !== 'patch is incorrect') {
    return localSemanticFallbackDecision('隔离审查缺少有效的 overall_correctness。', snapshots, userPrompt);
  }
  if (!Array.isArray(raw.findings) || typeof raw.overall_explanation !== 'string') {
    return localSemanticFallbackDecision('隔离审查缺少 findings 或 overall_explanation。', snapshots, userPrompt);
  }
  if (!isConfidence(raw.overall_confidence_score) || !raw.overall_explanation.trim()) {
    return localSemanticFallbackDecision('隔离审查缺少可信的总体解释或置信度。', snapshots, userPrompt);
  }

  const checkResult = normalizeRequirementChecksWithReason(raw.requirement_checks, requirements);
  const checks = checkResult.checks;
  if (!checks) {
    const fallbackFindings = normalizeFindingsAgainstRequirements(raw.findings, snapshots, requirements);
    if (raw.overall_correctness === 'patch is incorrect' && fallbackFindings && fallbackFindings.length > 0) {
      return {
        status: 'failed',
        explanation: '隔离审查未逐条覆盖需求清单；已保留可追溯的源码反例并阻断完成。',
        findings: fallbackFindings,
      };
    }
    return localSemanticFallbackDecision(
      checkResult.rejectionReason ?? '隔离审查未逐条覆盖需求清单，或需求引用不是原文。',
      snapshots,
      userPrompt,
    );
  }
  const localContradictions = findLocalSemanticContradictions(checks, snapshots);
  if (localContradictions.length > 0) {
    return {
      status: 'failed',
      explanation: '本地最终源码合约发现隔离审查结论与源码执行路径不一致。',
      findings: localContradictions,
    };
  }

  const findings: RequirementReviewFinding[] = [];
  const normalizedFindings = normalizeFindings(raw.findings, snapshots, checks);
  if (!normalizedFindings) {
    return localSemanticFallbackDecision('隔离审查 finding 缺少可追溯证据、包含推测，或反转了需求方向。', snapshots, userPrompt);
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
    return localSemanticFallbackDecision('隔离审查的 violated 清单与可执行 findings 不一致。', snapshots, userPrompt);
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
    return localSemanticFallbackDecision('隔离审查总体结论与逐条需求检查不一致。', snapshots, userPrompt);
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

function findLocalSemanticContradictions(
  checks: ReadonlyMap<string, NormalizedRequirementCheck>,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding[] {
  const findings: RequirementReviewFinding[] = [];
  const seen = new Set<string>();
  const addFinding = (finding: RequirementReviewFinding | undefined): void => {
    if (!finding) return;
    const key = `${finding.requirementId}\0${finding.title}\0${finding.path}\0${finding.line}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };
  for (const check of checks.values()) {
    if (check.status !== 'satisfied') continue;
    if (requiresFailurePathEvidence(check.requirement.quote)) {
      addFinding(findAmbiguousRejectionContract(check, snapshots));
    }
    if (requiresUsedIdentityPermanence(check.requirement.quote)) {
      addFinding(findUsedIdentityPermanenceContract(check, snapshots));
    }
    if (requiresPartialFillStateConsistency(check.requirement.quote)) {
      addFinding(findPartialFillStateConsistencyContract(check, snapshots));
      addFinding(findSelfReferentialRemainingInitializationContract(check, snapshots));
    }
    if (requiresPricePriorityDirection(check.requirement.quote)) {
      addFinding(findPricePriorityDirectionContract(check, snapshots));
      addFinding(findBestBidDirectionContract(check, snapshots));
    }
    if (requiresTradeIdentityProjection(check.requirement.quote)) {
      addFinding(findTradeIdentityProjectionContract(check, snapshots));
    }
  }
  return findings;
}

function normalizeReportStyleReviewResult(
  raw: RawReviewResult,
  requirements: readonly RequirementClause[],
): RawReviewResult {
  if (raw.requirement_checks !== undefined || !Array.isArray(raw.requirements_coverage)) {
    return raw;
  }
  const coverage = raw.requirements_coverage as unknown[];
  if (coverage.length === 0) return raw;
  const normalizedChecks = mapReportCoverageToInventory(coverage, requirements);
  if (!normalizedChecks) return raw;
  const allCovered = coverage.every(item => reportCoverageStatus(item) === 'satisfied');
  const explanation = typeof raw.conclusion === 'string' && raw.conclusion.trim()
    ? raw.conclusion.trim()
    : 'Report-style independent review mapped every covered item to the requirement inventory.';
  return {
    ...raw,
    requirement_checks: normalizedChecks,
    findings: Array.isArray(raw.findings) ? raw.findings : [],
    overall_correctness: allCovered ? 'patch is correct' : 'patch is incorrect',
    overall_explanation: explanation,
    overall_confidence_score: isConfidence(raw.overall_confidence_score)
      ? raw.overall_confidence_score
      : reportCoverageConfidence(raw, allCovered),
  };
}

function mapReportCoverageToInventory(
  coverage: readonly unknown[],
  requirements: readonly RequirementClause[],
): RawRequirementCheck[] | undefined {
  if (requirements.length === 1) {
    return [{
      requirement_id: requirements[0].id,
      requirement_quote: requirements[0].quote,
      status: coverage.every(item => reportCoverageStatus(item) === 'satisfied') ? 'satisfied' : 'violated',
      evidence: coverage.map(reportCoverageEvidence).filter(Boolean).join('\n'),
    }];
  }
  if (coverage.length !== requirements.length) return undefined;
  const checks: RawRequirementCheck[] = [];
  for (let index = 0; index < requirements.length; index += 1) {
    const item = coverage[index] as { requirement_id?: unknown; requirement_text?: unknown };
    const requirement = requirements[index];
    if (!item
      || item.requirement_id !== requirement.id
      || normalizeRequirementText(item.requirement_text) !== normalizeRequirementText(requirement.quote)) {
      return undefined;
    }
    checks.push({
      requirement_id: requirement.id,
      requirement_quote: requirement.quote,
      status: reportCoverageStatus(item),
      evidence: reportCoverageEvidence(item),
    });
  }
  return checks;
}

function reportCoverageStatus(item: unknown): 'satisfied' | 'violated' {
  const status = normalizeRequirementText((item as { status?: unknown })?.status).toLowerCase();
  return /^(covered|satisfied|pass|passed|ok|true)$/i.test(status) || /已覆盖|通过|满足/u.test(status)
    ? 'satisfied'
    : 'violated';
}

function reportCoverageEvidence(item: unknown): string {
  const entry = item as {
    evidence?: unknown;
    requirement_text?: unknown;
    requirement_id?: unknown;
  };
  const evidence = entry?.evidence;
  const parts = [
    typeof entry?.requirement_id === 'string' ? entry.requirement_id : '',
    typeof entry?.requirement_text === 'string' ? entry.requirement_text : '',
  ];
  if (typeof evidence === 'string') {
    parts.push(evidence);
  } else if (evidence && typeof evidence === 'object') {
    const record = evidence as Record<string, unknown>;
    for (const key of ['file', 'line_range', 'behavior', 'rationale', 'code_snippet']) {
      const value = record[key];
      if (typeof value === 'string') parts.push(value);
    }
  }
  return parts.map(value => value.trim()).filter(Boolean).join(' ');
}

function reportCoverageConfidence(raw: RawReviewResult, allCovered: boolean): number {
  const exitCode = raw.test_evidence?.exit_code;
  const warnings = raw.test_evidence?.compiler_warnings;
  if (allCovered && exitCode === 0 && (warnings === 0 || warnings === '0')) return 0.9;
  return allCovered ? 0.82 : 0.85;
}

function parseReviewJsonFromResponseText(
  text: string,
  requirements: readonly RequirementClause[],
): RawReviewResult {
  const direct = tryParseRawReviewResult(stripSingleJsonFence(text));
  if (direct && scoreReviewJsonCandidate(direct, requirements) > 0) {
    return direct;
  }
  let selected: { raw: RawReviewResult; score: number; index: number } | undefined;
  for (const candidate of extractJsonObjectCandidates(text)) {
    const score = scoreReviewJsonCandidate(candidate.raw, requirements);
    if (score <= 0) continue;
    if (!selected || score > selected.score || (score === selected.score && candidate.index > selected.index)) {
      selected = { ...candidate, score };
    }
  }
  if (!selected) throw new Error('no-review-json-candidate');
  return selected.raw;
}

function scoreReviewJsonCandidate(
  raw: RawReviewResult,
  requirements: readonly RequirementClause[],
): number {
  const normalized = normalizeReportStyleReviewResult(raw, requirements);
  let score = 0;
  const checkResult = normalizeRequirementChecksWithReason(normalized.requirement_checks, requirements);
  if (checkResult.checks) score += 120;
  else if (Array.isArray(normalized.requirement_checks)) score += 30;
  if (Array.isArray(normalized.findings)) score += 15;
  if (normalized.overall_correctness === 'patch is correct'
    || normalized.overall_correctness === 'patch is incorrect') {
    score += 20;
  }
  if (typeof normalized.overall_explanation === 'string') score += 10;
  if (isConfidence(normalized.overall_confidence_score)) score += 10;
  if (Array.isArray(normalized.requirements_coverage)) score += 20;
  return score;
}

function extractJsonObjectCandidates(text: string): Array<{ raw: RawReviewResult; index: number }> {
  const candidates: Array<{ raw: RawReviewResult; index: number }> = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '{') continue;
    const end = findBalancedJsonObjectEnd(text, index);
    if (end === undefined) continue;
    const raw = tryParseRawReviewResult(text.slice(index, end + 1));
    if (raw) {
      candidates.push({ raw, index });
      index = end;
    }
  }
  return candidates;
}

function findBalancedJsonObjectEnd(text: string, start: number): number | undefined {
  let depth = 0;
  let insideString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (insideString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        insideString = false;
      }
      continue;
    }
    if (char === '"') {
      insideString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char !== '}') continue;
    depth -= 1;
    if (depth === 0) return index;
    if (depth < 0) return undefined;
  }
  return undefined;
}

function tryParseRawReviewResult(text: string): RawReviewResult | undefined {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as RawReviewResult
      : undefined;
  } catch {
    return undefined;
  }
}

function localSemanticFallbackDecision(
  explanation: string,
  snapshots: readonly RequirementReviewSourceSnapshot[],
  userPrompt: string,
): RequirementReviewDecision {
  const requirements = extractRequirementClauses(userPrompt);
  if (requirements.length === 0) return indeterminateDecision(explanation);
  const localContradictions = findLocalSemanticContradictions(
    satisfiedRequirementChecksFromInventory(requirements),
    snapshots,
  );
  if (localContradictions.length === 0) {
    return indeterminateDecision(explanation);
  }
  return {
    status: 'failed',
    explanation: `${explanation}；本地最终源码合约仍发现可执行反例。`,
    findings: localContradictions,
  };
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
    if (hasDistinctCppRejectionChannel(submitBody)
      || submitCallsDistinctRejectionHelper(submitBody, source)) {
      continue;
    }
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

function findSelfReferentialRemainingInitializationContract(
  check: NormalizedRequirementCheck,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding | undefined {
  for (const snapshot of snapshots) {
    if (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(snapshot.path)) continue;
    const line = findSelfReferentialRemainingInitializationLine(snapshot);
    if (!line) continue;
    return {
      requirementId: check.requirement.id,
      requirement: check.requirement.quote,
      title: 'Initialize remaining quantity from the incoming order',
      observedBehavior: 'A local order node aggregate initializer reads the same node variable while that variable is still being initialized.',
      expectedBehavior: 'The active remaining quantity must be initialized from the validated incoming order quantity before the move, or from the constructed stored order after initialization.',
      counterexample: 'Submit a valid unmatched buy with quantity 5. If remaining_qty is initialized from node.order.quantity while node is uninitialized, the order can enter matching/book state with an indeterminate or zero remaining quantity instead of 5.',
      priority: 1,
      confidence: 0.92,
      path: snapshot.path,
      line,
    };
  }
  return undefined;
}

function findPricePriorityDirectionContract(
  check: NormalizedRequirementCheck,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding | undefined {
  const combinedSource = stripCppComments(snapshots.map(snapshot => snapshot.content).join('\n'));
  if (!hasAscendingBidPriceLevels(combinedSource)) return undefined;
  for (const snapshot of snapshots) {
    if (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(snapshot.path)) continue;
    const line = findAscendingBidBeginSelectionLine(snapshot);
    if (!line) continue;
    return {
      requirementId: check.requirement.id,
      requirement: check.requirement.quote,
      title: 'Match incoming sells against the highest bid first',
      observedBehavior: 'The matching loop selects begin() from an ascending bid price map, so an incoming sell can trade with the lowest eligible bid before better prices.',
      expectedBehavior: 'Price priority requires incoming sell orders to match the highest bid price first; use a descending bid comparator or select rbegin()/prev(end()) for bid levels.',
      counterexample: 'With resting buys b1@10, b2@11, and b3@12, a sell at 10 should trade b3 before b2 before b1; begin() on an ascending bid map starts at b1@10.',
      priority: 1,
      confidence: 0.93,
      path: snapshot.path,
      line,
    };
  }
  return undefined;
}

function findBestBidDirectionContract(
  check: NormalizedRequirementCheck,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding | undefined {
  const combinedSource = stripCppComments(snapshots.map(snapshot => snapshot.content).join('\n'));
  if (!hasDescendingBidPriceLevels(combinedSource)) return undefined;
  for (const snapshot of snapshots) {
    if (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(snapshot.path)) continue;
    const line = findDescendingBidReverseBestBidLine(snapshot);
    if (!line) continue;
    return {
      requirementId: check.requirement.id,
      requirement: check.requirement.quote,
      title: 'Report bestBid from the highest bid level',
      observedBehavior: 'bestBid() iterates rbegin() on a descending bid map, so it reports the lowest remaining bid instead of the highest bid.',
      expectedBehavior: 'When bids are stored with std::greater<double>, begin() is already the highest bid; bestBid() must use the same ordering contract as matching.',
      counterexample: 'With resting buys b1@9 and b2@11, a descending bid map orders b2 first; rbegin() reports b1@9 even though bestBid() should return 11.',
      priority: 1,
      confidence: 0.92,
      path: snapshot.path,
      line,
    };
  }
  return undefined;
}

function findTradeIdentityProjectionContract(
  check: NormalizedRequirementCheck,
  snapshots: readonly RequirementReviewSourceSnapshot[],
): RequirementReviewFinding | undefined {
  const combinedSource = stripCppComments(snapshots.map(snapshot => snapshot.content).join('\n'));
  if (!hasIncomingRestingTradeFields(combinedSource)) return undefined;
  for (const snapshot of snapshots) {
    if (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(snapshot.path)) continue;
    const line = findReversedTradeIdentityProjectionLine(snapshot);
    if (!line) continue;
    return {
      requirementId: check.requirement.id,
      requirement: check.requirement.quote,
      title: 'Preserve Trade incoming/resting identity fields',
      observedBehavior: 'A sell-side match constructs Trade with the resting buy id as incomingId and the incoming sell id as restingId.',
      expectedBehavior: 'Trade.incomingId must name the submitted incoming order and Trade.restingId must name the older order already resting in the book.',
      counterexample: 'Submit resting buy b2@11, then incoming sell s1@9. The first trade must expose incomingId=s1 and restingId=b2; reversed fields report restingId=s1.',
      priority: 1,
      confidence: 0.94,
      path: snapshot.path,
      line,
    };
  }
  return undefined;
}

function hasDistinctCppRejectionChannel(source: string): boolean {
  return /\bthrow\b|\b(?:std::|tl::)?expected\s*</.test(stripCppComments(source));
}

function submitCallsDistinctRejectionHelper(submitBody: string, source: string): boolean {
  const helperCalls = [...stripCppComments(submitBody).matchAll(/\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*;/g)];
  for (const match of helperCalls) {
    const helperName = match[1];
    if (!/(?:valid|validate|check|ensure|require|guard|reject)/i.test(helperName)) continue;
    const helperBody = findCppNamedFunctionBody(source, helperName);
    if (!helperBody || !hasDistinctCppRejectionChannel(helperBody)) continue;
    if (/(?:empty|duplicate|already[-_ ]?used|finite|price|quantity|qty|id|order|valid|空|重复|已使用|非有限|价格|数量)/iu
      .test(helperBody)) {
      return true;
    }
  }
  return false;
}

function requiresUsedIdentityPermanence(quote: string): boolean {
  return /(?:already[- ]used|used id|ever[- ]used|previously used|已使用|用过|曾用|历史.*id)/iu
    .test(normalizeRequirementText(quote));
}

function requiresPartialFillStateConsistency(quote: string): boolean {
  return /(?:partial(?:ly)?|remaining|remain(?:s|ing)? quantity|quantity|部分成交|余量|剩余|数量|成交量)/iu
    .test(normalizeRequirementText(quote));
}

function requiresPricePriorityDirection(quote: string): boolean {
  const text = normalizeRequirementText(quote);
  return /(?:price priority|highest bid|lowest ask|best bid|best ask|价格优先|最高买|最低卖|最高.*买|最低.*卖|最佳买|最佳卖|撮合)/iu
    .test(text)
    && /(?:bid|ask|buy|sell|买|卖|买单|卖单|订单簿|order book|撮合)/iu.test(text);
}

function requiresTradeIdentityProjection(quote: string): boolean {
  const text = normalizeRequirementText(quote);
  return /(?:trade|incoming|resting|restingId|incomingId|成交|撮合)/iu.test(text)
    && /(?:trade|incoming|resting|restingId|incomingId|实际撮合|撮合顺序|resting order|成交价|成交顺序)/iu
      .test(text);
}

function hasAscendingBidPriceLevels(source: string): boolean {
  const hasTypedefBidMap = /using\s+([A-Za-z_]\w*)\s*=\s*std\s*::\s*map\s*<\s*double\s*,(?![^;]*std\s*::\s*greater)[^;]+>\s*;[\s\S]{0,1000}\b\1\s+bids_?\b/i
    .test(source);
  const hasDirectBidMap = /\bstd\s*::\s*map\s*<\s*double\s*,(?![^;]*std\s*::\s*greater)[^;]+>\s+bids_?\b/i.test(source);
  return (hasTypedefBidMap || hasDirectBidMap)
    && !hasDescendingBidPriceLevels(source);
}

function hasDescendingBidPriceLevels(source: string): boolean {
  return /using\s+([A-Za-z_]\w*)\s*=\s*std\s*::\s*map\s*<\s*double\s*,[^;]+,\s*std\s*::\s*greater[\s\S]{0,200};[\s\S]{0,1000}\b\1\s+bids_?\b/i
    .test(source)
    || /\bstd\s*::\s*map\s*<\s*double\s*,[^;]+,\s*std\s*::\s*greater\s*<\s*double\s*>[^;]*>\s+bids_?\b/i
      .test(source);
}

function hasIncomingRestingTradeFields(source: string): boolean {
  return /\bstruct\s+Trade\s*\{[^}]*\bincomingId\b[^}]*\brestingId\b[^}]*\}/i.test(source);
}

function findAscendingBidBeginSelectionLine(
  snapshot: RequirementReviewSourceSnapshot,
): number | undefined {
  const lines = stripCppComments(snapshot.content).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const windowText = lines.slice(index, Math.min(lines.length, index + 12)).join('\n');
    const routedOpposingSide = /\b(?:auto|const\s+auto|LevelMap)\s*(?:[*&]\s*)?([A-Za-z_]\w*)\s*=\s*\(\s*\w+\s*(?:->|\.)\s*side\s*==\s*Side\s*::\s*Buy\s*\)\s*\?\s*&?(?:[A-Za-z_]\w*\s*\.\s*)?asks_?\s*:\s*&?(?:[A-Za-z_]\w*\s*\.\s*)?bids_?\s*;/i
      .exec(windowText);
    if (routedOpposingSide) {
      const iteratorPattern = new RegExp(`\\b${routedOpposingSide[1]}\\s*(?:\\.|->)\\s*begin\\s*\\(`, 'i');
      if (iteratorPattern.test(windowText)) {
        return index + 1 + lineOffset(windowText, iteratorPattern);
      }
    }
    if (/\bopponent_levels\s*=\s*\(\s*incoming\s*->\s*side\s*==\s*Side\s*::\s*Buy\s*\)\s*\?\s*(?:[A-Za-z_]\w*\s*\.\s*)?asks_?\s*:\s*(?:[A-Za-z_]\w*\s*\.\s*)?bids_?\s*;/i.test(windowText)
      && /\b(?:const\s+)?auto\s*&?\s+it\s*=\s*opponent_levels\s*\.\s*begin\s*\(\s*\)\s*;/i.test(windowText)) {
      return index + 1 + lineOffset(windowText, /opponent_levels\s*\.\s*begin\s*\(/i);
    }
    if (/\b(?:matchSell|submit|match)\b/.test(windowText)
      && /\b(?:[A-Za-z_]\w*\s*\.\s*)?bids_?\s*\.\s*begin\s*\(\s*\)/i.test(windowText)
      && !/\b(?:[A-Za-z_]\w*\s*\.\s*)?bids_?\s*\.\s*rbegin\s*\(\s*\)|std\s*::\s*prev\s*\(\s*(?:[A-Za-z_]\w*\s*\.\s*)?bids_?\s*\.\s*end\s*\(\s*\)\s*\)/i.test(windowText)) {
      return index + 1 + lineOffset(windowText, /\b(?:[A-Za-z_]\w*\s*\.\s*)?bids_?\s*\.\s*begin\s*\(/i);
    }
  }
  return undefined;
}

function findDescendingBidReverseBestBidLine(
  snapshot: RequirementReviewSourceSnapshot,
): number | undefined {
  const lines = stripCppComments(snapshot.content).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bbestBid\s*\(/.test(lines[index])) continue;
    const bodyWindow = lines.slice(index, Math.min(lines.length, index + 32)).join('\n');
    const reverseBidPattern = /\b(?:[A-Za-z_]\w*\s*\.\s*)?bids_?\s*\.\s*rbegin\s*\(/i;
    if (reverseBidPattern.test(bodyWindow)) {
      return index + 1 + lineOffset(bodyWindow, reverseBidPattern);
    }
  }
  return undefined;
}

function findReversedTradeIdentityProjectionLine(
  snapshot: RequirementReviewSourceSnapshot,
): number | undefined {
  const lines = stripCppComments(snapshot.content).split(/\r?\n/);
  const reversedSellTrade = /\b(?:trades\s*\.\s*(?:push_back|emplace_back)\s*\(\s*)?(?:Trade\s*)?\{\s*(?:buyId|[A-Za-z_]\w*Buy[A-Za-z_]*|buy[A-Za-z_]*Id)\s*,\s*(?:order|incoming)\s*\.\s*id\b/i;
  const reversedBuyTrade = /\b(?:trades\s*\.\s*(?:push_back|emplace_back)\s*\(\s*)?(?:Trade\s*)?\{\s*(?:sellId|[A-Za-z_]\w*Sell[A-Za-z_]*|sell[A-Za-z_]*Id)\s*,\s*(?:order|incoming)\s*\.\s*id\b/i;
  for (let index = 0; index < lines.length; index += 1) {
    const context = lines.slice(Math.max(0, index - 48), Math.min(lines.length, index + 4)).join('\n');
    if (reversedSellTrade.test(lines[index])
      && /(?:Side\s*::\s*Sell|else\s*\{|卖单|匹配买盘)/iu.test(context)) {
      return index + 1;
    }
    if (reversedBuyTrade.test(lines[index])
      && /(?:Side\s*::\s*Buy|买单|匹配卖盘)/iu.test(context)) {
      return index + 1;
    }
  }
  return undefined;
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
  )) || helperLooksUpActiveIdentityIndex(source)
    || /\bhasOrder\s*\([^)]*\bid\b/i.test(source);
}

function helperLooksUpActiveIdentityIndex(source: string): boolean {
  const code = stripCppComments(source);
  for (const indexName of activeIdentityIndexNames()) {
    const helperCalls = [...code.matchAll(new RegExp(`\\b([A-Za-z_]\\w*)\\s*\\([^;{}]*\\b${indexName}\\b[^;{}]*\\)\\s*;`, 'gi'))];
    for (const call of helperCalls) {
      if (!/(?:valid|validate|check|ensure|require|guard|reject|has)/i.test(call[1])) continue;
      const helperBody = findCppNamedFunctionBody(code, call[1]);
      if (helperBody
        && /\b[A-Za-z_]\w*\s*\.\s*(?:find|contains)\s*\([^)]*\bid/i.test(helperBody)) {
        return true;
      }
    }
  }
  return false;
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

function findSelfReferentialRemainingInitializationLine(
  snapshot: RequirementReviewSourceSnapshot,
): number | undefined {
  const lines = stripCppComments(snapshot.content).split(/\r?\n/);
  const selfInitPattern = /\b(?:OrderNode|OrderEntry|OrderRecord|OrderState|Entry|Node)\s+([A-Za-z_]\w*)\s*(?:=)?\s*\{[^;{}]*\b\1\s*\.\s*(?:order\s*\.\s*)?(?:quantity|qty|remaining_qty|remaining)\b[^;{}]*\}\s*;/i;
  for (let index = 0; index < lines.length; index += 1) {
    if (selfInitPattern.test(lines[index])) return index + 1;
  }
  return undefined;
}

function hasLifecycleIdentityErase(source: string): boolean {
  return identityEraseLinePattern().test(source);
}

function identityEraseLinePattern(): RegExp {
  return /\b(?:order_map_|orders_|active_orders_|activeOrders|index_|locations_|order_location_|orderLocations_|entries_|orderIndex_|order_index_)\s*\.\s*erase\s*\(/i;
}

function activeIdentityIndexNames(): string[] {
  return [
    'order_map_',
    'orders_',
    'active_orders_',
    'activeOrders',
    'order_location_',
    'orderLocations_',
    'entries_',
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

function lineOffset(value: string, pattern: RegExp): number {
  const match = pattern.exec(value);
  if (!match) return 0;
  return value.slice(0, match.index).split(/\r?\n/).length - 1;
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
  return normalizeRequirementChecksWithReason(rawChecks, requirements).checks;
}

function normalizeRequirementChecksWithReason(
  rawChecks: unknown,
  requirements: readonly RequirementClause[],
): RequirementCheckNormalizationResult {
  if (!Array.isArray(rawChecks) || rawChecks.length !== requirements.length) {
    return { rejectionReason: '隔离审查未逐条覆盖需求清单，或需求引用不是原文。' };
  }
  const checks = new Map<string, NormalizedRequirementCheck>();
  for (let index = 0; index < requirements.length; index++) {
    const raw = rawChecks[index] as RawRequirementCheck;
    const requirement = requirements[index];
    if (!raw
      || raw.requirement_id !== requirement.id
      || normalizeRequirementText(raw.requirement_quote) !== normalizeRequirementText(requirement.quote)
      || (raw.status !== 'satisfied' && raw.status !== 'violated')) {
      return { rejectionReason: '隔离审查未逐条覆盖需求清单，或需求引用不是原文。' };
    }
    if (typeof raw.evidence !== 'string' || !raw.evidence.trim()) {
      return { rejectionReason: `隔离审查 evidence 缺少可追溯事实：${requirement.id} 必须点名最终源码路径/行号、验证事实或可执行场景。` };
    }
    const evidenceRejectionReason = requirementEvidenceRejectionReason(
      requirement,
      raw.status,
      raw.evidence,
    );
    if (evidenceRejectionReason) {
      return { rejectionReason: evidenceRejectionReason };
    }
    checks.set(requirement.id, {
      requirement,
      status: raw.status,
      evidence: raw.evidence.trim(),
    });
  }
  return { checks };
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

function satisfiedRequirementChecksFromInventory(
  requirements: readonly RequirementClause[],
): Map<string, NormalizedRequirementCheck> {
  const checks = new Map<string, NormalizedRequirementCheck>();
  for (const requirement of requirements) {
    checks.set(requirement.id, {
      requirement,
      status: 'satisfied',
      evidence: 'local-semantic-fallback',
    });
  }
  return checks;
}

function requirementEvidenceRejectionReason(
  requirement: RequirementClause,
  status: 'satisfied' | 'violated',
  evidence: string,
): string | undefined {
  if (status !== 'satisfied') return undefined;
  if (requiresOrderedTrace(requirement.quote) && !hasOrderedTraceEvidence(evidence)) {
    return `隔离审查 evidence 未覆盖顺序/优先级轨迹：${requirement.id} 必须在 evidence 中点名多元素场景、比较/遍历方向或先后结果。`;
  }
  if (requiresFailurePathEvidence(requirement.quote) && !hasFailurePathEvidence(evidence)) {
    return `隔离审查 evidence 未覆盖失败路径：${requirement.id} 必须在 evidence 中同时点名被拒绝/非法输入场景和 caller-observable 抛错/错误通道。`;
  }
  return undefined;
}

function requiresOrderedTrace(quote: string): boolean {
  const text = normalizeRequirementText(quote);
  const hasExplicitOrderingContract = /(?:\border(?:ing|ed)?\b|\bpriority\b|\bfifo\b|\blifo\b|顺序|优先|同价|先后|排序|撮合)/iu.test(text);
  if (hasExplicitOrderingContract) {
    return true;
  }
  const hasRelativeOrderOperation = /(?:\bfirst\b|\blast\b|\bsort(?:ed|ing)?\b|最高|最低)/iu.test(text);
  const hasOrderedCollectionDomain = /(?:\barray\b|\blist\b|\bcollection\b|\bqueue\b|\bitems?\b|\bentries\b|\brows?\b|\brecords?\b|\bvalues?\b|\bprices?\b|\bquantit(?:y|ies)\b|\bamounts?\b|\bcounts?\b|\belements?\b|\bbids?\b|\basks?\b|\blevels?\b|数组|列表|集合|队列|条目|记录|值|价格|价位|数量|金额|个数|元素|报价|档位)/iu.test(text);
  if (hasRelativeOrderOperation && hasOrderedCollectionDomain) {
    return true;
  }
  const hasMinMaxWord = /(?:\bbest\b|\bminimum\b|\bmaximum\b|\bmin\b|\bmax\b|最[大小])/iu.test(text);
  const hasComparableDomain = /(?:\bvalue\b|\bprice\b|\bquantity\b|\bamount\b|\bcount\b|\belement\b|\bbid\b|\bask\b|\blevel\b|\bchoose\b|\bselect\b|\breturn\b|\bmatch\b|值|价格|价位|数量|金额|个数|元素|报价|档位|选择|返回|匹配|撮合)/iu.test(text);
  return hasMinMaxWord && hasComparableDomain;
}

function hasOrderedTraceEvidence(evidence: string): boolean {
  const text = normalizeRequirementText(evidence);
  return /(?:\btrace\b|\bsequence\b|\bscenario\b|\bcase\b|\bsimulat(?:e|ed|es|ion)\b|\btwo\b|\bthree\b|\b2\b|\b3\b|\bfirst\b|\bthen\b|\bnext\b|->|=>|轨迹|序列|场景|反例|两个|三个|多(?:个|元素)|先.*后|价格层|同价|begin|end|prev|comparator|greater|less)/iu
    .test(text);
}

function requiresFailurePathEvidence(quote: string): boolean {
  const text = normalizeRequirementText(quote);
  const constrainsInput = /(?:\binvalid (?:input|argument|value|id|price|quantity)\b|\bmalformed\b|\bunsupported (?:input|argument|value|format|operation)\b|\bout[- ]of[- ]range\b|\bduplicate\b|\balready[- ]used\b|\bnon[- ]finite\b|\bnan\b|<=\s*0|\bnegative\b|\bempty (?:input|argument|value|id|string)\b|非法(?:输入|参数|值|编号|价格|数量)|无效(?:输入|参数|值|编号|价格|数量)|格式错误|不支持的(?:输入|参数|值|格式|操作)|越界|重复|已使用|非有限|空(?:输入|参数|值|编号|字符串)|负数|非正数)/iu.test(text);
  const requiresObservableRejection = /(?:\breject(?:s|ed|ion)?\b|\berror[- ]?(?:path|case|branch|code|status|result|object|input|message)\b|\bfail(?:ure|ed)?[- ]?(?:path|case|branch|code|status|result|object|input|message)\b|\b(?:returns?|raises?|throws?) (?:an? )?(?:error|failure|exception)\b|拒绝|抛出|返回(?:错误|失败)|错误(?:码|状态|结果|信息|分支)|失败(?:状态|结果|分支))/iu.test(text);
  return constrainsInput && requiresObservableRejection;
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
  return {
    status: 'indeterminate',
    explanation,
    findings: [],
  };
}

function isConfidence(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
