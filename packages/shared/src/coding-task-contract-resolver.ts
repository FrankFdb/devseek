import type { CodingCompletionAcceptanceCriterion } from './coding-completion';
import {
  buildCodingKernelTaskContract,
  type CodingKernelSurface,
  type CodingKernelTaskContract,
} from './coding-kernel';
import type { CodingDeliverableKind, CodingTaskMode } from './coding-conformance';
import type {
  CodingTaskAcceptanceCriterion,
  CodingTaskExternalBoundary,
} from './coding-task-contract';
import { resolveCodingOrientationDecision } from './coding-orientation';
import {
  buildSecretHarvestingRefusalTaskContract,
  isUnsafeSecretHarvestingImplementationRequest,
} from './coding-safety-policy';
import { resolveCodingTaskPathIntent } from './coding-task-path-intent';

const VERIFICATION_REQUEST_RE = /(?:\bverif(?:y|ied|ication)\b|\bvalidat(?:e|ed|ion)\b|\btests?\b|\bchecks?\b|\bcompile\b|\brun\b|验证|校验|测试|检查|编译|运行|自测)/iu;
const VERIFICATION_PROHIBITION_RE = /(?:(?:do\s+not|don't|must\s+not|should\s+not|never|without)\b[^,.;\n]{0,80}\b(?:run|compile|test|verify|validate|check)\b|(?:不要|不得|禁止|不允许|无需|不需要|别)[^,，。；;\n]{0,40}(?:运行|编译|测试|验证|校验|检查)|不(?:运行|编译|测试|验证|校验|检查))/iu;
const SCOPED_CHANGE_RE = /(?:keep\s+the\s+change\s+scoped|do\s+not\s+(?:modify|change|touch)\s+(?:any\s+)?other\s+files?|(?:only|solely)\s+(?:modify|change|edit|touch)\b[^.\n]{0,80}|only\s+[^.\n]{0,80}\s+changes?|不要(?:修改|改动|新增)(?:任何)?其他文件|(?:只|仅)(?:允许)?(?:修改|改动)[^，。；\n]{0,80})/iu;
const NO_DEPENDENCY_RE = /(?:do\s+not\s+(?:add|introduce)\s+(?:any\s+)?dependenc|no\s+(?:new\s+)?dependenc|不要(?:新增|引入)(?:任何)?依赖|不(?:新增|引入)依赖)/iu;
const DEPENDENCY_EFFECT_RE = /(?:\binstall\b[^.\n]{0,80}\b(?:package|dependency)\b|\b(?:npm|pnpm|yarn|bun|pip)\s+(?:install|add)\b|安装[^，。；\n]{0,80}(?:包|依赖))/iu;
const NETWORK_EFFECT_RE = /(?:\bnetwork\b|\bdownload\b|\bupload\b|\bregistry\b|\bcurl\b|\bwget\b|网络|下载|上传|仓库|注册表)/iu;
const API_VERSION_BOUNDARY_RE = /(?:(?:latest|current|versioned)\s+[^.\n]{0,60}\bapi\b|\bapi\b[^.\n]{0,60}(?:version|latest|current)|(?:最新|当前|指定)[^，。；\n]{0,60}(?:API|接口)|(?:API|接口)[^，。；\n]{0,60}(?:版本|最新|当前))/iu;
const LICENSE_BOUNDARY_RE = /(?:(?<![/\\])\blicen[cs]e\b|许可证|授权协议|开源协议)/iu;
const DEPLOYMENT_BOUNDARY_RE = /(?:\bdeploy(?:ment)?\b|\bproduction\b|\bstaging\b|部署|上线|生产环境|预发布环境)/iu;
const SUBJECTIVE_ACCEPTANCE_RE = /(?:looks?\s+(?:good|professional|polished|nice)|看起来(?:专业|不错|很好|好看)|足够美观|令人满意|主观满意)/iu;
const REPORT_DELIVERABLE_RE = /(?:\.(?:md|markdown)\b|markdown|\breports?\b|\bdocuments?\b|报告|文档)/iu;

export interface ResolveCodingKernelTaskContractInput {
  readonly prompt: string;
  readonly surface: CodingKernelSurface;
  readonly contextFiles?: readonly string[];
  readonly targetPaths?: readonly string[];
  readonly targetPathsAuthoritative?: boolean;
  readonly excludedTargetPaths?: readonly string[];
  readonly strictTargetScope?: boolean;
  readonly modeHint?: CodingTaskMode;
  readonly verificationRequired?: boolean;
  readonly deliverableKinds?: readonly CodingDeliverableKind[];
  readonly confirmedWorkspaceMutation?: boolean;
}

/** Resolves the product-level coding contract once for every Surface. */
export function resolveCodingKernelTaskContract(
  input: ResolveCodingKernelTaskContractInput,
): CodingKernelTaskContract {
  const prompt = normalizePrompt(input.prompt);
  const orientation = resolveCodingOrientationDecision({
    prompt,
    modeHint: input.modeHint,
    confirmedWorkspaceMutation: input.confirmedWorkspaceMutation,
  });
  if (isUnsafeSecretHarvestingImplementationRequest(prompt)) {
    return buildSecretHarvestingRefusalTaskContract(input.surface, orientation);
  }

  const dependencyEffect = DEPENDENCY_EFFECT_RE.test(prompt);
  const networkEffect = dependencyEffect || NETWORK_EFFECT_RE.test(prompt);
  const mode = orientation.mode;
  const mutating = mode === 'change' || mode === 'release';
  const pathIntent = resolveCodingTaskPathIntent({ prompt, targetPaths: input.targetPaths });
  const declaredTargets = input.targetPathsAuthoritative
    ? uniquePaths(input.targetPaths ?? [])
    : [...pathIntent.mutationFileTargets];
  const deliverableKinds = uniqueDeliverableKinds(input.deliverableKinds ?? []);
  const reportDeliverableRequested = deliverableKinds.includes('report')
    || REPORT_DELIVERABLE_RE.test(prompt);
  const mutationScope = uniquePaths([
    ...declaredTargets,
    ...(input.targetPathsAuthoritative
      ? []
      : pathIntent.mutationDirectoryTargets.map(path => `${path}/**`)),
  ]);
  const excludedScope = uniquePaths([
    ...pathIntent.excludedFileTargets,
    ...pathIntent.excludedDirectoryTargets.map(path => `${path}/**`),
    ...(input.excludedTargetPaths ?? []),
  ]);
  const include = dependencyEffect && mutationScope.length === 0
    ? ['package.json', 'package-lock.json', 'src/**']
    : mutating
      ? mutationScope
      : uniquePaths([
          ...pathIntent.mentionedPaths,
          ...(pathIntent.mentionedPaths.length === 0 ? input.contextFiles ?? [] : []),
        ]);
  const scopedChange = mutating && (
    input.strictTargetScope === true || SCOPED_CHANGE_RE.test(prompt)
  );
  const verificationProhibited = VERIFICATION_PROHIBITION_RE.test(prompt);
  const verificationRequired = !verificationProhibited
    && (
      input.verificationRequired === true
      || (mutating && (input.verificationRequired !== false || VERIFICATION_REQUEST_RE.test(prompt)))
    );
  const deliverables = resolveDeliverables({
    mutating,
    dependencyEffect,
    verificationRequired,
    declaredTargets,
    reportDeliverableRequested,
    sourceChangeDeliverableRequested: deliverableKinds.includes('source-change'),
  });
  const externalBoundaries = resolveExternalBoundaries(prompt, dependencyEffect, networkEffect);
  const acceptance = resolveAcceptance({
    mutating,
    dependencyEffect,
    scopedChange,
    verificationRequired,
    weakAcceptance: SUBJECTIVE_ACCEPTANCE_RE.test(prompt),
    deliverableIds: deliverables.map(deliverable => deliverable.id),
    externalBoundaryIds: externalBoundaries.map(boundary => boundary.id),
  });

  return buildCodingKernelTaskContract({
    goal: prompt,
    mode,
    orientation,
    include,
    exclude: mutating ? excludedScope : [],
    deliverables,
    constraints: resolveConstraints({
      mutating,
      dependencyEffect,
      networkEffect,
      scopedChange,
      verificationRequired,
      noDependencies: NO_DEPENDENCY_RE.test(prompt),
    }),
    nonGoals: resolveNonGoals({
      mutating,
      scopedChange,
      noDependencies: NO_DEPENDENCY_RE.test(prompt),
    }),
    externalBoundaries,
    acceptance,
    provenanceRefs: ['user-prompt', `surface:${input.surface}`],
  });
}

export function resolveCodingKernelAcceptance(
  input: Omit<ResolveCodingKernelTaskContractInput, 'surface'>,
): CodingCompletionAcceptanceCriterion[] {
  return [...resolveCodingKernelTaskContract({ ...input, surface: 'headless' }).acceptance];
}

function resolveDeliverables(input: {
  readonly mutating: boolean;
  readonly dependencyEffect: boolean;
  readonly verificationRequired: boolean;
  readonly declaredTargets: readonly string[];
  readonly reportDeliverableRequested: boolean;
  readonly sourceChangeDeliverableRequested: boolean;
}): Array<{ id: string; kind: 'source-change' | 'report' | 'verification-result'; path?: string }> {
  if (!input.mutating) {
    return [
      { id: 'response', kind: 'report' },
      ...(input.verificationRequired
        ? [{ id: 'verification-result', kind: 'verification-result' as const }]
        : []),
    ];
  }
  const targets = input.dependencyEffect
    ? ['package.json']
    : input.declaredTargets.filter(isConcreteWorkspacePath);
  const mutationDeliverables = input.dependencyEffect
    ? [{ id: 'dependency-change', kind: 'source-change' as const, path: 'package.json' }]
    : targets.length === 0
      ? [{
          id: input.reportDeliverableRequested && !input.sourceChangeDeliverableRequested
            ? 'report'
            : 'source-change',
          kind: input.reportDeliverableRequested && !input.sourceChangeDeliverableRequested
            ? 'report' as const
            : 'source-change' as const,
        }]
      : buildTargetDeliverables({
          targets,
          reportDeliverableRequested: input.reportDeliverableRequested,
          sourceChangeDeliverableRequested: input.sourceChangeDeliverableRequested,
        });
  return [
    ...mutationDeliverables,
    ...(input.verificationRequired
      ? [{ id: 'verification-result', kind: 'verification-result' as const }]
      : []),
  ];
}

function buildTargetDeliverables(input: {
  readonly targets: readonly string[];
  readonly reportDeliverableRequested: boolean;
  readonly sourceChangeDeliverableRequested: boolean;
}): Array<{ id: string; kind: 'source-change' | 'report'; path: string }> {
  let sourceCount = 0;
  let reportCount = 0;
  const reportOnlyTargets = input.reportDeliverableRequested
    && !input.sourceChangeDeliverableRequested
    && input.targets.every(isReportArtifactPath);
  return input.targets.map(path => {
    const report = reportOnlyTargets
      || (input.reportDeliverableRequested && isReportArtifactPath(path));
    if (report) {
      reportCount++;
      return {
        id: reportCount === 1 ? 'report' : `report:${reportCount}`,
        kind: 'report' as const,
        path,
      };
    }
    sourceCount++;
    return {
      id: sourceCount === 1 ? 'source-change' : `source-change:${sourceCount}`,
      kind: 'source-change' as const,
      path,
    };
  });
}

function resolveConstraints(input: {
  readonly mutating: boolean;
  readonly dependencyEffect: boolean;
  readonly networkEffect: boolean;
  readonly scopedChange: boolean;
  readonly verificationRequired: boolean;
  readonly noDependencies: boolean;
}): string[] {
  if (!input.mutating) {
    return [
      'no-workspace-mutation',
      ...(input.verificationRequired ? ['verification-before-completion'] : []),
    ];
  }
  if (input.dependencyEffect) {
    return [
      'dependency-change-requires-approval',
      ...(input.networkEffect ? ['network-requires-approval'] : []),
    ];
  }
  return [
    'workspace-root-only',
    ...(input.scopedChange ? ['no-other-files'] : []),
    ...(input.noDependencies ? ['no-dependencies'] : []),
    ...(input.verificationRequired ? ['verification-before-completion'] : []),
  ];
}

function resolveAcceptance(input: {
  readonly mutating: boolean;
  readonly dependencyEffect: boolean;
  readonly scopedChange: boolean;
  readonly verificationRequired: boolean;
  readonly weakAcceptance: boolean;
  readonly deliverableIds: readonly string[];
  readonly externalBoundaryIds: readonly string[];
}): CodingTaskAcceptanceCriterion[] {
  const evidenceKinds = (
    values: CodingTaskAcceptanceCriterion['oracle']['evidenceKinds'],
  ): CodingTaskAcceptanceCriterion['oracle']['evidenceKinds'] => [
    ...values,
    ...(input.externalBoundaryIds.length > 0 ? ['source-citation' as const] : []),
  ];
  const subjectiveAcceptance: CodingTaskAcceptanceCriterion[] = input.weakAcceptance
    ? [{
        id: 'subjective-quality',
        statement: 'The requested subjective quality must be replaced by an executable acceptance oracle.',
        deliverableIds: input.deliverableIds,
        oracle: acceptanceOracle('subjective', 'user-impression', ['workspace'], evidenceKinds([])),
        externalBoundaryRefs: input.externalBoundaryIds,
      }]
    : [];
  if (input.dependencyEffect) {
    return [{
      id: 'authority',
      statement: 'No dependency or network effect occurs without approval and grounded package metadata.',
      deliverableIds: input.deliverableIds,
      oracle: acceptanceOracle('authority', 'kernel-tool-authority', ['dependency', 'network'], evidenceKinds([
        'authority-receipt',
      ])),
      externalBoundaryRefs: input.externalBoundaryIds,
    }, ...subjectiveAcceptance];
  }
  if (!input.mutating) {
    return [
      {
        id: 'grounded-response',
        statement: 'The response addresses the request without unauthorized effects.',
        deliverableIds: input.deliverableIds,
        oracle: acceptanceOracle('response-evidence', 'grounded-response-review', ['response'], evidenceKinds([
          'response-evidence',
        ])),
        externalBoundaryRefs: input.externalBoundaryIds,
      },
      ...(input.verificationRequired
        ? [{
            id: 'verified',
            statement: 'Applicable verification passes before completion.',
            deliverableIds: input.deliverableIds,
            oracle: acceptanceOracle('verification', 'project-verification', ['workspace'], evidenceKinds([
              'verification-receipt',
            ])),
            externalBoundaryRefs: input.externalBoundaryIds,
          }]
        : []),
      ...subjectiveAcceptance,
    ];
  }
  return [
    {
      id: 'requested-outcome',
      statement: 'The requested workspace outcome is applied and read back.',
      deliverableIds: input.deliverableIds,
      oracle: acceptanceOracle('workspace-readback', 'workspace-mutation-readback', ['workspace'], evidenceKinds([
        'workspace-mutation-receipt',
        'workspace-readback',
      ])),
      externalBoundaryRefs: input.externalBoundaryIds,
    },
    ...(input.scopedChange
      ? [{
          id: 'scoped-change',
          statement: 'Workspace changes remain inside the requested file scope.',
          deliverableIds: input.deliverableIds,
          oracle: acceptanceOracle('workspace-readback', 'change-set-scope', ['workspace'], evidenceKinds([
            'workspace-mutation-receipt',
            'workspace-readback',
          ])),
          externalBoundaryRefs: input.externalBoundaryIds,
        }]
      : []),
    ...(input.verificationRequired
      ? [{
          id: 'verified',
          statement: 'Applicable verification passes before completion.',
          deliverableIds: input.deliverableIds,
          oracle: acceptanceOracle('verification', 'project-verification', ['workspace'], evidenceKinds([
            'verification-receipt',
          ])),
          externalBoundaryRefs: input.externalBoundaryIds,
        }]
      : []),
    ...subjectiveAcceptance,
  ];
}

function resolveNonGoals(input: {
  readonly mutating: boolean;
  readonly scopedChange: boolean;
  readonly noDependencies: boolean;
}): string[] {
  if (!input.mutating) return ['workspace-mutation'];
  return [
    'unrequested-workspace-effects',
    ...(input.scopedChange ? ['modify-files-outside-requested-scope'] : []),
    ...(input.noDependencies ? ['introduce-new-dependencies'] : []),
  ];
}

function resolveExternalBoundaries(
  prompt: string,
  dependencyEffect: boolean,
  networkEffect: boolean,
): CodingTaskExternalBoundary[] {
  const boundaries: CodingTaskExternalBoundary[] = [];
  const add = (boundary: CodingTaskExternalBoundary): void => {
    if (!boundaries.some(current => current.id === boundary.id)) boundaries.push(boundary);
  };
  if (dependencyEffect || networkEffect) {
    add({
      id: 'external-data-source',
      kind: 'data-source',
      subject: dependencyEffect ? 'package registry metadata' : 'requested network source',
      sourceRef: 'external-source:data',
    });
  }
  if (API_VERSION_BOUNDARY_RE.test(prompt)) {
    add({ id: 'external-api-version', kind: 'api-version', subject: 'requested API version', sourceRef: 'external-source:api-version' });
  }
  if (LICENSE_BOUNDARY_RE.test(prompt)) {
    add({ id: 'external-license', kind: 'license', subject: 'requested license terms', sourceRef: 'external-source:license' });
  }
  if (DEPLOYMENT_BOUNDARY_RE.test(prompt)) {
    add({ id: 'external-deployment', kind: 'deployment', subject: 'requested deployment target', sourceRef: 'external-source:deployment' });
  }
  return boundaries;
}

function acceptanceOracle(
  kind: CodingTaskAcceptanceCriterion['oracle']['kind'],
  verifier: string,
  scope: readonly string[],
  evidenceKinds: CodingTaskAcceptanceCriterion['oracle']['evidenceKinds'],
): CodingTaskAcceptanceCriterion['oracle'] {
  return { kind, verifier, scope, evidenceKinds };
}

function normalizePrompt(prompt: string): string {
  const normalized = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!normalized) throw new Error('coding-task-contract:missing-prompt');
  return normalized;
}

function normalizeWorkspacePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
  if (!normalized || normalized.startsWith('../') || normalized.startsWith('/')) return '';
  return normalized;
}

function isConcreteWorkspacePath(path: string): boolean {
  return !path.includes('*') && !path.includes('?');
}

function isReportArtifactPath(path: string): boolean {
  return /\.(?:md|markdown|txt)$/iu.test(path)
    || /(?:^|\/)(?:docs?|reports?)(?:\/|$)/iu.test(path);
}

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeWorkspacePath).filter(Boolean))];
}

function uniqueDeliverableKinds(values: readonly CodingDeliverableKind[]): CodingDeliverableKind[] {
  return [...new Set(values.filter(value => (
    value === 'source-change' || value === 'report' || value === 'verification-result'
  )))];
}
