import type { CodingCompletionAcceptanceCriterion } from './coding-completion';
import {
  buildCodingKernelTaskContract,
  type CodingKernelSurface,
  type CodingKernelTaskContract,
} from './coding-kernel';
import type { CodingTaskMode } from './coding-conformance';
import {
  buildSecretHarvestingRefusalTaskContract,
  isUnsafeSecretHarvestingImplementationRequest,
} from './coding-safety-policy';

const RELEASE_REQUEST_RE = /(?:\brelease\b|\bpublish\b|\bpackage\b|\bdeploy\b|发布|发版|打包|部署)/iu;
const REVIEW_REQUEST_RE = /(?:\breview\b|\baudit\b|\binspect\b|\banaly[sz]e\b|审查|审计|检查|分析)/iu;
const CHANGE_REQUEST_RE = /(?:\badd\b|\bcreate\b|\bwrite\b|\bimplement\b|\bfix\b|\brepair\b|\brecover(?:y)?\b|\bmodify\b|\bupdate\b|\brefactor\b|\bapply\b|\bpatch\b|\binstall\b|添加|新增|创建|编写|实现|修复|恢复|修改|更新|重构|应用|打补丁|安装)/iu;
const EXPLAIN_REQUEST_RE = /(?:\bexplain\b|\bdescribe\b|\bhow\b|\bwhy\b|\bwhat\b|解释|说明|如何|为什么|什么)/iu;
const EXPLANATION_PREFIX_RE = /^(?:please\s+)?(?:explain|describe|how|why|what|解释|说明|如何|为什么|什么)\b/iu;
const VERIFICATION_REQUEST_RE = /(?:\bverif(?:y|ied|ication)\b|\bvalidat(?:e|ed|ion)\b|\btests?\b|\bchecks?\b|\bcompile\b|\brun\b|验证|校验|测试|检查|编译|运行|自测)/iu;
const SCOPED_CHANGE_RE = /(?:keep\s+the\s+change\s+scoped|do\s+not\s+(?:modify|change|touch)\s+(?:any\s+)?other\s+files?|only\s+[^.\n]{0,80}\s+changes?|不要(?:修改|改动|新增)(?:任何)?其他文件|只(?:修改|改动)[^，。；\n]{0,80})/iu;
const NO_DEPENDENCY_RE = /(?:do\s+not\s+(?:add|introduce)\s+(?:any\s+)?dependenc|no\s+(?:new\s+)?dependenc|不要(?:新增|引入)(?:任何)?依赖|不(?:新增|引入)依赖)/iu;
const DEPENDENCY_EFFECT_RE = /(?:\binstall\b[^.\n]{0,80}\b(?:package|dependency)\b|\b(?:npm|pnpm|yarn|bun|pip)\s+(?:install|add)\b|安装[^，。；\n]{0,80}(?:包|依赖))/iu;
const NETWORK_EFFECT_RE = /(?:\bnetwork\b|\bdownload\b|\bupload\b|\bregistry\b|\bcurl\b|\bwget\b|网络|下载|上传|仓库|注册表)/iu;
const WORKSPACE_PATH_RE = /(?:^|[\s("'`])((?:\.{0,2}\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.?*-]+)(?=$|[\s,.;:!?，。；：！？)"'`])/gu;

export interface ResolveCodingKernelTaskContractInput {
  readonly prompt: string;
  readonly surface: CodingKernelSurface;
  readonly contextFiles?: readonly string[];
  readonly targetPaths?: readonly string[];
  readonly modeHint?: CodingTaskMode;
  readonly verificationRequired?: boolean;
}

/** Resolves the product-level coding contract once for every Surface. */
export function resolveCodingKernelTaskContract(
  input: ResolveCodingKernelTaskContractInput,
): CodingKernelTaskContract {
  const prompt = normalizePrompt(input.prompt);
  if (isUnsafeSecretHarvestingImplementationRequest(prompt)) {
    return buildSecretHarvestingRefusalTaskContract(input.surface);
  }

  const dependencyEffect = DEPENDENCY_EFFECT_RE.test(prompt);
  const networkEffect = dependencyEffect || NETWORK_EFFECT_RE.test(prompt);
  const mode = resolveTaskMode(prompt, input.modeHint);
  const mutating = mode === 'change' || mode === 'release';
  const explicitTargets = extractCodingWorkspacePaths(prompt);
  const include = dependencyEffect && explicitTargets.length === 0
    ? ['package.json', 'package-lock.json', 'src/**']
    : uniquePaths([
        ...explicitTargets,
        ...(input.targetPaths ?? []),
        ...(explicitTargets.length === 0 ? input.contextFiles ?? [] : []),
      ]);
  const scopedChange = mutating && SCOPED_CHANGE_RE.test(prompt);
  const verificationRequired = mutating
    && (input.verificationRequired !== false || VERIFICATION_REQUEST_RE.test(prompt));
  const acceptance = resolveAcceptance({
    mutating,
    dependencyEffect,
    scopedChange,
    verificationRequired,
  });

  return buildCodingKernelTaskContract({
    goal: prompt,
    mode,
    include,
    deliverables: resolveDeliverables({ mutating, dependencyEffect, verificationRequired, include }),
    constraints: resolveConstraints({
      mutating,
      dependencyEffect,
      networkEffect,
      scopedChange,
      verificationRequired,
      noDependencies: NO_DEPENDENCY_RE.test(prompt),
    }),
    acceptance,
    provenanceRefs: ['user-prompt', `surface:${input.surface}`],
  });
}

export function resolveCodingKernelAcceptance(
  input: Omit<ResolveCodingKernelTaskContractInput, 'surface'>,
): CodingCompletionAcceptanceCriterion[] {
  return [...resolveCodingKernelTaskContract({ ...input, surface: 'headless' }).acceptance];
}

export function extractCodingWorkspacePaths(prompt: string): string[] {
  const paths: string[] = [];
  for (const match of normalizePrompt(prompt).matchAll(WORKSPACE_PATH_RE)) {
    const path = normalizeWorkspacePath(match[1] ?? '');
    if (path) paths.push(path);
  }
  return uniquePaths(paths);
}

function resolveTaskMode(prompt: string, hint?: CodingTaskMode): CodingTaskMode {
  if (EXPLANATION_PREFIX_RE.test(prompt)) return 'explain';
  if (CHANGE_REQUEST_RE.test(prompt)) return 'change';
  if (REVIEW_REQUEST_RE.test(prompt)) return 'review';
  if (RELEASE_REQUEST_RE.test(prompt)) return 'release';
  if (EXPLAIN_REQUEST_RE.test(prompt)) return 'explain';
  if (hint === 'change' || hint === 'release') return hint;
  return hint === 'review' ? 'review' : 'explain';
}

function resolveDeliverables(input: {
  readonly mutating: boolean;
  readonly dependencyEffect: boolean;
  readonly verificationRequired: boolean;
  readonly include: readonly string[];
}): Array<{ id: string; kind: 'source-change' | 'report' | 'verification-result'; path?: string }> {
  if (!input.mutating) return [{ id: 'response', kind: 'report' }];
  const target = input.dependencyEffect ? 'package.json' : firstConcretePath(input.include);
  return [
    {
      id: input.dependencyEffect ? 'dependency-change' : 'source-change',
      kind: 'source-change',
      ...(target ? { path: target } : {}),
    },
    ...(input.verificationRequired
      ? [{ id: 'verification-result', kind: 'verification-result' as const }]
      : []),
  ];
}

function resolveConstraints(input: {
  readonly mutating: boolean;
  readonly dependencyEffect: boolean;
  readonly networkEffect: boolean;
  readonly scopedChange: boolean;
  readonly verificationRequired: boolean;
  readonly noDependencies: boolean;
}): string[] {
  if (!input.mutating) return ['no-workspace-mutation'];
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
}): CodingCompletionAcceptanceCriterion[] {
  if (input.dependencyEffect) {
    return [{ id: 'authority', statement: 'No dependency or network effect occurs without approval.' }];
  }
  if (!input.mutating) {
    return [{ id: 'grounded-response', statement: 'The response addresses the request without unauthorized effects.' }];
  }
  return [
    { id: 'requested-outcome', statement: 'The requested workspace outcome is applied.' },
    ...(input.scopedChange
      ? [{ id: 'scoped-change', statement: 'Workspace changes remain inside the requested file scope.' }]
      : []),
    ...(input.verificationRequired
      ? [{ id: 'verified', statement: 'Applicable verification passes before completion.' }]
      : []),
  ];
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

function uniquePaths(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeWorkspacePath).filter(Boolean))];
}

function firstConcretePath(paths: readonly string[]): string | undefined {
  return paths.find(path => !path.includes('*'));
}
