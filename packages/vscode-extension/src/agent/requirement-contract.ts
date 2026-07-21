import {
  buildTaskContract,
  extractCurrentUserRequest,
  type TaskContract,
} from './task-contract';

export type RequirementContractVersion = 'devseek.requirement-contract/v1';
export type RequirementDeliverableKind = 'report' | 'source-change' | 'verification-result';
export type RequirementAcceptanceStatus =
  | 'executable'
  | 'weak-oracle'
  | 'external-source-required'
  | 'not-applicable';
export type RequirementApplicabilityStatus = 'applies' | 'not-applicable';
export type RequirementExternalBoundaryKind =
  | 'api-version'
  | 'license'
  | 'deployment'
  | 'data-source';
export type RequirementExternalBoundaryStatus = 'attributed' | 'unknown';

export interface RequirementExternalFactInput {
  kind: RequirementExternalBoundaryKind;
  name: string;
  value: string;
  sourceRef: string;
  accessedAt: string;
}

export interface RequirementDeliverable {
  id: string;
  kind: RequirementDeliverableKind;
  target: string | null;
  acceptanceRefs: string[];
}

export interface RequirementAcceptanceCriterion {
  id: string;
  deliverableId: string;
  status: RequirementAcceptanceStatus;
  verifier: string;
  scope: string[];
  evidenceRefs: string[];
  applicability: {
    status: RequirementApplicabilityStatus;
    reason: string;
  };
}

export interface RequirementExternalBoundary {
  id: string;
  kind: RequirementExternalBoundaryKind;
  name: string;
  value: string | null;
  sourceRef?: string;
  accessedAt?: string;
  status: RequirementExternalBoundaryStatus;
}

export interface RequirementContract {
  version: RequirementContractVersion;
  authority: 'RequirementContract';
  objectives: string[];
  deliverables: RequirementDeliverable[];
  constraints: string[];
  nonGoals: string[];
  acceptanceCriteria: RequirementAcceptanceCriterion[];
  externalBoundaries: RequirementExternalBoundary[];
  risks: string[];
  requiredActions: string[];
}

export interface RequirementContractValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface RequirementContractQualityGateAcceptance {
  status: 'accepted' | 'missing' | 'pending' | 'weak-oracle' | 'adverse';
  reason?: string;
  evidenceRefs?: string[];
  risks?: string[];
  alternativeChecks?: string[];
  requiredActions?: string[];
}

export interface BuildRequirementContractInput {
  promptText: string;
  taskContract?: TaskContract;
  externalFacts?: RequirementExternalFactInput[];
}

const VERSION: RequirementContractVersion = 'devseek.requirement-contract/v1';
const REPORT_HINT_RE = /(?:文档|报告|说明|设计|方案|markdown|\.md\b|document|report|plan)/i;
const FILE_TARGET_RE = /\b[\w.@+~-]+(?:\/[\w.@+~-]+)*\.(?:md|markdown|txt|json|ya?ml|toml|csv|log)\b/gi;
const SOURCE_FILE_TARGET_RE = /\b[\w.@+~-]+(?:\/[\w.@+~-]+)*\.(?:cxx|cpp|cc|c|hxx|hpp|hh|h|tsx|ts|jsx|js|mjs|cjs|py|java|go|rs|sh|bash)\b/gi;
const SOURCE_CHANGE_HINT_RE = /(?:创建|新建|生成|编写|写入|修改|修复|实现|新增|添加|重构|create|write|generate|modify|fix|implement|add|refactor)/i;
const READBACK_RE = /(?:读回|重新读取|再次读取|read\s*(?:it\s*)?back|re-?read)/i;
const FILE_EXISTS_RE = /(?:文件存在|存在性|test\s+-f|file\s+exists?|existence)/i;
const VALIDATION_RE = /(?:验证|校验|检查|编译|测试|运行|verify|validate|check|compile|test|run)/i;
const WEAK_ORACLE_RE = /(?:看起来|专业|漂亮|好看|高质量|完善|合理|合适|professional|nice|polished|good|reasonable)/i;
const NO_FIXED_THREE_DOCS_RE = /(?:不需要|无需|不要|不必)[^，,。；;\n]{0,24}(?:固定|限定)[^，,。；;\n]{0,12}(?:三|3)\s*份?(?:文档|报告)|\bno\s+fixed\s+(?:three|3)\s+(?:docs?|documents?)\b/i;
const EXTERNAL_API_RE = /(?:最新|current|latest)[^，,。；;\n]{0,80}(?:api|接口)[^，,。；;\n]{0,40}(?:版本|version)?|(?:api|接口)[^，,。；;\n]{0,80}(?:最新|current|latest|version|版本)/i;
const LICENSE_RE = /(?:\b(?:MIT|Apache-?2\.0|GPL|BSD)\b\s*(?:license|licen[cs]e|许可证|授权协议)?|(?:license|licen[cs]e|许可证|授权协议)[^，,。；;\n]{0,24}(?:协议|条款|版本|terms?|version))/i;
const EXTERNAL_DATA_RE = /(?:外部接口|外部 API|外部数据|第三方接口|remote\s+api|external\s+(?:api|data|service))/i;
const DEPLOYMENT_BOUNDARY_RE = /(?:部署到|上线到|发布到|deploy\s+to|production|staging|kubernetes|k8s|云服务|服务器)/i;

export function buildRequirementContract(input: BuildRequirementContractInput): RequirementContract {
  const prompt = extractCurrentUserRequest(input.promptText);
  const taskContract = input.taskContract ?? buildTaskContract(prompt);
  const rawDeliverables = buildRequirementDeliverables(taskContract, prompt);
  const externalBoundaries = buildExternalBoundaries(prompt, input.externalFacts ?? []);
  const acceptanceCriteria = rawDeliverables.map((deliverable, index) => (
    buildAcceptanceCriterion(deliverable, index + 1, prompt, taskContract, externalBoundaries)
  ));
  const deliverables = rawDeliverables.map((deliverable, index) => ({
    ...deliverable,
    acceptanceRefs: acceptanceCriteria[index] ? [acceptanceCriteria[index].id] : [],
  }));
  const validationPreview = validateRequirementContractShape({
    deliverables,
    acceptanceCriteria,
    externalBoundaries,
  });

  return {
    version: VERSION,
    authority: 'RequirementContract',
    objectives: taskContract.objectives.length > 0 ? taskContract.objectives : [prompt.trim()].filter(Boolean),
    deliverables,
    constraints: [...taskContract.constraints],
    nonGoals: extractNonGoals(prompt),
    acceptanceCriteria,
    externalBoundaries,
    risks: validationPreview.errors.map(errorToRisk),
    requiredActions: validationPreview.errors.map(errorToRequiredAction),
  };
}

export function validateRequirementContract(contract: RequirementContract): RequirementContractValidation {
  const errors: string[] = [];
  if (contract.version !== VERSION) errors.push('contract:version-mismatch');
  if (contract.authority !== 'RequirementContract') errors.push('contract:authority-mismatch');
  if (contract.objectives.length === 0) errors.push('objective:missing');
  if (contract.deliverables.length === 0) errors.push('deliverable:missing');

  const acceptanceById = new Map(contract.acceptanceCriteria.map(acceptance => [acceptance.id, acceptance]));
  for (const deliverable of contract.deliverables) {
    if (deliverable.acceptanceRefs.length === 0
      || !deliverable.acceptanceRefs.every(ref => acceptanceById.has(ref))) {
      errors.push(`deliverable:acceptance-missing:${deliverable.id}`);
    }
  }

  for (const acceptance of contract.acceptanceCriteria) {
    if (acceptance.status === 'executable') {
      if (!acceptance.verifier.trim()) errors.push(`acceptance:verifier-missing:${acceptance.id}`);
      if (acceptance.scope.length === 0) errors.push(`acceptance:scope-missing:${acceptance.id}`);
      if (acceptance.evidenceRefs.length === 0) errors.push(`acceptance:evidence-missing:${acceptance.id}`);
    }
    if (acceptance.status === 'weak-oracle') errors.push(`acceptance:weak-oracle:${acceptance.id}`);
    if (acceptance.status === 'external-source-required') {
      errors.push(`acceptance:external-source-required:${acceptance.id}`);
    }
    if (acceptance.applicability.status === 'not-applicable'
      && !acceptance.applicability.reason.trim()) {
      errors.push(`acceptance:applicability-reason-missing:${acceptance.id}`);
    }
  }

  for (const boundary of contract.externalBoundaries) {
    if (boundary.status !== 'attributed' || !boundary.sourceRef?.trim() || !boundary.accessedAt?.trim()) {
      errors.push(`external_boundary:unknown-source:${boundary.id}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings: [],
  };
}

export function evaluateRequirementContractAcceptance(
  contract: RequirementContract,
): RequirementContractQualityGateAcceptance {
  const validation = validateRequirementContract(contract);
  if (validation.ok) {
    return {
      status: 'accepted',
      reason: 'requirement-contract-validated',
      evidenceRefs: [`contract:${contract.version}`],
    };
  }

  const weak = validation.errors.some(error => error.startsWith('acceptance:weak-oracle:'));
  const externalPending = validation.errors.some(error => (
    error.startsWith('external_boundary:unknown-source:')
    || error.startsWith('acceptance:external-source-required:')
  ));
  const status: RequirementContractQualityGateAcceptance['status'] = weak
    ? 'weak-oracle'
    : externalPending
      ? 'pending'
      : 'missing';
  return {
    status,
    reason: weak
      ? 'acceptance-not-bound-to-executable-oracle'
      : externalPending
        ? 'external-boundary-attribution-required'
        : 'requirement-contract-incomplete',
    evidenceRefs: validation.errors.map(error => `contract:${error}`),
    risks: validation.errors.map(errorToRisk),
    requiredActions: validation.errors.map(errorToRequiredAction),
  };
}

function validateRequirementContractShape(input: {
  deliverables: RequirementDeliverable[];
  acceptanceCriteria: RequirementAcceptanceCriterion[];
  externalBoundaries: RequirementExternalBoundary[];
}): RequirementContractValidation {
  return validateRequirementContract({
    version: VERSION,
    authority: 'RequirementContract',
    objectives: ['shape-preview'],
    deliverables: input.deliverables,
    constraints: [],
    nonGoals: [],
    acceptanceCriteria: input.acceptanceCriteria,
    externalBoundaries: input.externalBoundaries,
    risks: [],
    requiredActions: [],
  });
}

function buildRequirementDeliverables(
  taskContract: TaskContract,
  prompt: string,
): RequirementDeliverable[] {
  const deliverables: RequirementDeliverable[] = [];
  const add = (kind: RequirementDeliverableKind, target: string | null): void => {
    const duplicate = deliverables.some(item => item.kind === kind && item.target === target);
    if (duplicate) return;
    deliverables.push({
      id: `deliverable-${deliverables.length + 1}`,
      kind,
      target,
      acceptanceRefs: [],
    });
  };

  if (taskContract.deliverables.includes('report') || REPORT_HINT_RE.test(prompt)) {
    const targets = taskContract.deliverableTargets.length > 0
      ? taskContract.deliverableTargets
      : extractDocumentTargets(prompt);
    if (targets.length > 0) {
      for (const target of targets) add('report', target);
    } else {
      add('report', null);
    }
  }
  if (taskContract.deliverables.includes('source-change') || SOURCE_CHANGE_HINT_RE.test(prompt)) {
    const targets = extractSourceTargets(prompt);
    if (targets.length > 0) {
      for (const target of targets) add('source-change', target);
    } else if (taskContract.deliverables.includes('source-change')) {
      add('source-change', null);
    }
  }
  if (taskContract.deliverables.includes('verification-result') && deliverables.length === 0) {
    add('verification-result', null);
  }
  return deliverables;
}

function buildAcceptanceCriterion(
  deliverable: RequirementDeliverable,
  index: number,
  prompt: string,
  taskContract: TaskContract,
  externalBoundaries: RequirementExternalBoundary[],
): RequirementAcceptanceCriterion {
  const id = `acceptance-${index}`;
  const unknownExternal = externalBoundaries.filter(boundary => boundary.status !== 'attributed');
  if (unknownExternal.length > 0) {
    return {
      id,
      deliverableId: deliverable.id,
      status: 'external-source-required',
      verifier: 'external-source-attribution',
      scope: unknownExternal.map(boundary => `external:${boundary.id}`),
      evidenceRefs: unknownExternal.map(boundary => `contract:${boundary.id}`),
      applicability: {
        status: 'applies',
        reason: 'requirement references current or external facts',
      },
    };
  }

  const executable = hasExecutableAcceptance(deliverable, prompt, taskContract);
  if (!executable) {
    return {
      id,
      deliverableId: deliverable.id,
      status: 'weak-oracle',
      verifier: '',
      scope: deliverable.target ? [`file:${deliverable.target}`] : [deliverable.kind],
      evidenceRefs: [],
      applicability: {
        status: 'applies',
        reason: 'deliverable lacks a deterministic verifier',
      },
    };
  }

  return {
    id,
    deliverableId: deliverable.id,
    status: 'executable',
    verifier: selectVerifier(deliverable, prompt, taskContract),
    scope: deliverable.target ? [`file:${deliverable.target}`] : [deliverable.kind],
    evidenceRefs: buildAcceptanceEvidenceRefs(deliverable, prompt),
    applicability: {
      status: 'applies',
      reason: 'deliverable has a deterministic verifier scope',
    },
  };
}

function hasExecutableAcceptance(
  deliverable: RequirementDeliverable,
  prompt: string,
  taskContract: TaskContract,
): boolean {
  if (deliverable.kind === 'source-change' || deliverable.kind === 'verification-result') return true;
  if (deliverable.target) return true;
  if (taskContract.verificationContract.requireArtifactReadback) return true;
  if (VALIDATION_RE.test(prompt) && !WEAK_ORACLE_RE.test(prompt)) return true;
  return false;
}

function selectVerifier(
  deliverable: RequirementDeliverable,
  prompt: string,
  taskContract: TaskContract,
): string {
  if (deliverable.kind === 'source-change') return 'workspace-validation';
  if (deliverable.kind === 'verification-result') return 'verification-result-review';
  if (taskContract.verificationContract.requireArtifactReadback || READBACK_RE.test(prompt)) {
    return 'file-exists-and-readback';
  }
  if (FILE_EXISTS_RE.test(prompt) || deliverable.target) return 'file-exists';
  return 'deterministic-review';
}

function buildAcceptanceEvidenceRefs(deliverable: RequirementDeliverable, prompt: string): string[] {
  if (!deliverable.target) return [`validation:${deliverable.kind}`];
  return [
    `file:${deliverable.target}:exists`,
    ...(READBACK_RE.test(prompt) ? [`file:${deliverable.target}:readback`] : []),
  ];
}

function extractDocumentTargets(prompt: string): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const match of prompt.matchAll(FILE_TARGET_RE)) {
    const target = match[0].replace(/[.,;!?，。；]+$/u, '');
    if (!/\.(?:md|markdown)$/i.test(target)) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
}

function extractSourceTargets(prompt: string): string[] {
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const match of prompt.matchAll(SOURCE_FILE_TARGET_RE)) {
    const target = match[0].replace(/[.,;!?，。；]+$/u, '');
    if (seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
}

function extractNonGoals(prompt: string): string[] {
  return NO_FIXED_THREE_DOCS_RE.test(prompt) ? ['fixed-document-count'] : [];
}

function buildExternalBoundaries(
  prompt: string,
  externalFacts: RequirementExternalFactInput[],
): RequirementExternalBoundary[] {
  const requested: Array<{ kind: RequirementExternalBoundaryKind; name: string }> = [];
  if (EXTERNAL_API_RE.test(prompt)) requested.push({ kind: 'api-version', name: inferApiBoundaryName(prompt) });
  if (LICENSE_RE.test(prompt)) requested.push({ kind: 'license', name: inferLicenseBoundaryName(prompt) });
  if (EXTERNAL_DATA_RE.test(prompt)) requested.push({ kind: 'data-source', name: 'external data source' });
  if (DEPLOYMENT_BOUNDARY_RE.test(prompt)) requested.push({ kind: 'deployment', name: 'deployment target' });

  const boundaries: RequirementExternalBoundary[] = [];
  const seen = new Set<string>();
  for (const item of requested) {
    const id = boundaryId(item.kind, item.name);
    if (seen.has(id)) continue;
    seen.add(id);
    const fact = findExternalFact(item, externalFacts);
    boundaries.push({
      id,
      kind: item.kind,
      name: item.name,
      value: fact?.value ?? null,
      ...(fact?.sourceRef ? { sourceRef: fact.sourceRef } : {}),
      ...(fact?.accessedAt ? { accessedAt: fact.accessedAt } : {}),
      status: fact?.sourceRef && fact.accessedAt ? 'attributed' : 'unknown',
    });
  }
  return boundaries;
}

function findExternalFact(
  boundary: { kind: RequirementExternalBoundaryKind; name: string },
  facts: RequirementExternalFactInput[],
): RequirementExternalFactInput | undefined {
  const boundaryName = boundary.name.toLocaleLowerCase();
  return facts.find(fact => {
    if (fact.kind !== boundary.kind) return false;
    const factName = fact.name.toLocaleLowerCase();
    return boundaryName.includes(factName) || factName.includes(boundaryName);
  });
}

function inferApiBoundaryName(prompt: string): string {
  const match = prompt.match(/\b([A-Z][A-Za-z0-9_-]{1,40}\s+API)\b/)
    || prompt.match(/\b([A-Z][A-Za-z0-9_-]{1,40})\s+(?:接口|api)\b/i);
  return match?.[1]?.trim() || 'external API';
}

function inferLicenseBoundaryName(prompt: string): string {
  const match = prompt.match(/\b(MIT|Apache-?2\.0|GPL|BSD)\b/i);
  return match?.[1]?.trim() ? `${match[1].trim()} license` : 'license';
}

function boundaryId(kind: RequirementExternalBoundaryKind, name: string): string {
  const normalized = name.toLocaleLowerCase().replace(/[^0-9a-z]+/g, '-').replace(/^-|-$/g, '');
  return `${kind}:${normalized || 'unknown'}`;
}

function errorToRisk(error: string): string {
  if (error.startsWith('acceptance:weak-oracle:')) return '验收 oracle 过弱，不能证明交付满足用户需求。';
  if (error.startsWith('external_boundary:unknown-source:')) return '外部事实缺少来源归因，不能作为当前结论。';
  if (error.startsWith('acceptance:external-source-required:')) return '交付依赖外部事实，但验收尚未绑定来源证据。';
  if (error.startsWith('deliverable:acceptance-missing:')) return '交付物没有绑定验收标准。';
  return `需求合同不完整: ${error}`;
}

function errorToRequiredAction(error: string): string {
  if (error.startsWith('acceptance:weak-oracle:')) return '补充文件存在、读回、编译、测试或精确内容检查等可执行验收。';
  if (error.startsWith('external_boundary:unknown-source:')) return '补充外部事实的 sourceRef 与 accessedAt 后重新生成需求合同。';
  if (error.startsWith('acceptance:external-source-required:')) return '先完成外部事实归因，再执行交付验收。';
  if (error.startsWith('deliverable:acceptance-missing:')) return '为每个交付物绑定 acceptanceCriteria。';
  return '补齐需求合同字段后重新评估。';
}
