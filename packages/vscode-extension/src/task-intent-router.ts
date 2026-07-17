import { parseSimpleFileWriteRequest, type SimpleFileWriteRequest } from './agent/simple-file-intent';
import { classifyIntent } from './intent/intent-classifier';
import { isUnsafeSecretHarvestingImplementationRequest } from './intent/safety-intent';
import type { ExecutionMode, IntentClassification, ToolKind } from './intent/intent-types';
import {
  buildTaskSemanticContract,
  shouldRunCppValidationForContract,
  shouldValidateNonCodeFilesForContract,
  type TaskSemanticContract,
} from './task-semantic-contract';

export type TaskIntentFamily =
  | 'smalltalk'
  | 'qa'
  | 'read-only-advisory'
  | 'safety-refusal'
  | 'review'
  | 'simple-file'
  | 'file-artifact'
  | 'standalone-program'
  | 'existing-project-edit'
  | 'terminal-validation'
  | 'release-external-effect'
  | 'destructive'
  | 'general-edit'
  | 'ambiguous';

export type RoutedAgentTaskShape =
  | 'simple-file'
  | 'existing-project'
  | 'standalone-project'
  | 'read-only-analysis'
  | 'validation-repair'
  | 'general';

export type RoutedChatKind = 'chat' | 'code-change';

export interface TaskIntentRoute {
  version: 'devseek.task-intent-route/v1';
  prompt: string;
  family: TaskIntentFamily;
  chatKind: RoutedChatKind;
  mode: ExecutionMode;
  agentTaskShape: RoutedAgentTaskShape;
  semanticContract: TaskSemanticContract;
  classification: IntentClassification;
  simpleFile?: SimpleFileWriteRequest;
  mutation: {
    requested: boolean;
    prohibited: boolean;
    sourceChange: boolean;
    fileArtifact: boolean;
    targets: string[];
  };
  validation: {
    requested: boolean;
    compileRequested: boolean;
    runRequested: boolean;
    testRequested: boolean;
    runProhibited: boolean;
    stdoutRequested: boolean;
    fileCheckRequired: boolean;
    runtimeRequired: boolean;
    commandEvidenceRequired: boolean;
  };
  quality: {
    formalProjectRequired: boolean;
  };
  signals: string[];
  blockers: string[];
  reason: string;
  requiresConfirmation: boolean;
  allowedToolKinds: ToolKind[];
}

const REVIEW_RE = /(?:审查|评审|review|code\s+review|PR\b|pull\s+request)/i;
const FAILURE_RE = /(?:日志|失败|报错|重试|回归|QualityGate|replay|error|failed)/i;
const EXTERNAL_EFFECT_RE = /(?:发布|上线|部署|安装插件|安装扩展|提交(?:当前)?(?:修改|变更)?|推送(?:当前)?(?:分支)?|拉取(?:最新)?代码|安装\s*(?:依赖|npm\s*包|包)|release|deploy|publish|install\s+extension|git\s+(?:commit|push|pull|fetch|merge|rebase)|commit\s+(?:changes?|current)|push\s+(?:current\s+)?branch|npm\s+(?:install|i|add|ci)|pnpm\s+(?:install|i|add)|yarn\s+(?:install|add)|pip\s+install)/i;
const EXTERNAL_EFFECT_QUESTION_RE = /(?:如何|怎么|怎样|为什么|什么是|介绍|说明|方案|计划|how\s+to|what\s+is|why|plan|design|approach)/i;
const BROAD_SCOPE_RE = /(整个|全部|全局|项目|仓库|系统|架构|多入口|跨平台|跨模块|模块化|runtime|workflow|provider|权限|状态机)/i;
const COMPLEX_ACTION_RE = /(重构|改造|拆分|迁移|重写|优化架构|革命性|架构设计|refactor|re-architect|architecture)/i;
const PLANNING_TERM_RE = /(方案|计划|设计|怎么改|如何改|重构计划|实施步骤|roadmap|plan|design|approach)/i;
const IMPLEMENTATION_TERM_RE = /(代码|实现|修改|改造|拆分|迁移|重写|接入|落地|执行|模块化|runtime|workflow|provider|权限|状态机|code|implement|split|migrate|rewrite)/i;

export function routeTaskIntent(promptText: string): TaskIntentRoute {
  const prompt = String(promptText || '').trim();
  const semanticContract = buildTaskSemanticContract(prompt);
  const classification = classifyIntent(prompt);
  const simpleFile = semanticContract.mutation.prohibited
    ? undefined
    : parseSimpleFileWriteRequest(prompt);
  const family = resolveTaskIntentFamily(prompt, classification, semanticContract, simpleFile);
  const safetyRefusal = family === 'safety-refusal';
  const agentTaskShape = resolveAgentTaskShape(prompt, family, semanticContract);
  const chatKind = isCodeChangeRoute(family, classification.mode) ? 'code-change' : 'chat';
  const effectiveMutation: TaskIntentRoute['mutation'] = safetyRefusal
    ? {
      requested: false,
      prohibited: true,
      sourceChange: false,
      fileArtifact: false,
      targets: [],
    }
    : { ...semanticContract.mutation };
  const fileCheckRequired = !safetyRefusal && (family === 'simple-file'
    || shouldValidateNonCodeFilesForContract(semanticContract));
  const runtimeRequired = !safetyRefusal
    && !semanticContract.validation.runProhibited
    && shouldRunCppValidationForContract(semanticContract);
  const commandEvidenceRequired = !safetyRefusal && (runtimeRequired
    || semanticContract.validation.compileRequested
    || semanticContract.validation.testRequested
    || family === 'terminal-validation'
    || (fileCheckRequired && semanticContract.validation.requested));

  return {
    version: 'devseek.task-intent-route/v1',
    prompt,
    family,
    chatKind,
    mode: classification.mode,
    agentTaskShape,
    semanticContract,
    classification,
    simpleFile,
    mutation: effectiveMutation,
    validation: {
      requested: safetyRefusal ? false : semanticContract.validation.requested,
      compileRequested: safetyRefusal ? false : semanticContract.validation.compileRequested,
      runRequested: safetyRefusal ? false : semanticContract.validation.runRequested,
      testRequested: safetyRefusal ? false : semanticContract.validation.testRequested,
      runProhibited: semanticContract.validation.runProhibited,
      stdoutRequested: safetyRefusal ? false : semanticContract.validation.stdoutRequested,
      fileCheckRequired,
      runtimeRequired,
      commandEvidenceRequired,
    },
    quality: safetyRefusal ? { ...semanticContract.quality, formalProjectRequired: false } : { ...semanticContract.quality },
    signals: unique([
      ...classification.signals,
      ...semanticContract.signals,
      ...buildRouteMetaSignals(prompt),
      ...buildFamilyAliasSignals(family),
      `${family}-route`,
    ]),
    blockers: unique([
      ...classification.blockers,
      ...(safetyRefusal ? ['unsafe-secret-harvesting-request'] : []),
    ]),
    reason: `${family}:${classification.reason}`,
    requiresConfirmation: classification.requiresConfirmation,
    allowedToolKinds: [...classification.allowedToolKinds],
  };
}

export function shouldRequireRuntimeValidationForRoute(route: TaskIntentRoute): boolean {
  return route.validation.runtimeRequired;
}

export function shouldValidateNonCodeFilesForRoute(route: TaskIntentRoute): boolean {
  return route.validation.fileCheckRequired;
}

function resolveTaskIntentFamily(
  prompt: string,
  classification: IntentClassification,
  semanticContract: TaskSemanticContract,
  simpleFile: SimpleFileWriteRequest | undefined,
): TaskIntentFamily {
  if (!prompt) return 'smalltalk';
  if (isUnsafeSecretHarvestingImplementationRequest(prompt)) return 'safety-refusal';
  if (classification.mode === 'destructive' || semanticContract.kind === 'destructive') return 'destructive';
  if (simpleFile) return 'simple-file';
  if (EXTERNAL_EFFECT_RE.test(prompt) && !EXTERNAL_EFFECT_QUESTION_RE.test(prompt)) return 'release-external-effect';
  if (isReadOnlyRoute(classification, semanticContract)) {
    return REVIEW_RE.test(prompt) ? 'review' : 'read-only-advisory';
  }
  if (classification.mode === 'smalltalk') return 'smalltalk';
  if (classification.mode === 'qa') return 'qa';
  if (classification.mode === 'run' || semanticContract.kind === 'validation') return 'terminal-validation';
  if (semanticContract.scope === 'existing-project' || semanticContract.kind === 'existing-project-code') {
    return 'existing-project-edit';
  }
  if (semanticContract.scope === 'standalone' || semanticContract.kind === 'standalone-code') {
    return 'standalone-program';
  }
  if (semanticContract.kind === 'file-artifact') return 'file-artifact';
  if (classification.mode === 'edit') {
    return EXTERNAL_EFFECT_RE.test(prompt) && !EXTERNAL_EFFECT_QUESTION_RE.test(prompt)
      ? 'release-external-effect'
      : 'general-edit';
  }
  return semanticContract.mutation.prohibited ? 'read-only-advisory' : 'ambiguous';
}

function resolveAgentTaskShape(
  prompt: string,
  family: TaskIntentFamily,
  semanticContract: TaskSemanticContract,
): RoutedAgentTaskShape {
  if (family === 'safety-refusal') return 'read-only-analysis';
  if (FAILURE_RE.test(prompt)) {
    return 'validation-repair';
  }
  if (family === 'simple-file') return 'simple-file';
  if (family === 'existing-project-edit') return 'existing-project';
  if (family === 'standalone-program') return 'standalone-project';
  if (family === 'read-only-advisory' || family === 'review') return 'read-only-analysis';
  return 'general';
}

function isReadOnlyRoute(
  classification: IntentClassification,
  semanticContract: TaskSemanticContract,
): boolean {
  if (semanticContract.mutation.requested && !semanticContract.mutation.prohibited) return false;
  if (semanticContract.kind === 'read-only') return true;
  if (classification.blockers.includes('explicit-no-change')) return true;
  return classification.mode === 'inspect' || classification.mode === 'plan';
}

function isMutatingExecutionMode(mode: ExecutionMode): boolean {
  return mode === 'edit' || mode === 'run' || mode === 'destructive';
}

function isCodeChangeRoute(family: TaskIntentFamily, mode: ExecutionMode): boolean {
  return isMutatingExecutionMode(mode)
    || family === 'release-external-effect'
    || family === 'existing-project-edit'
    || family === 'standalone-program'
    || family === 'file-artifact'
    || family === 'simple-file'
    || family === 'terminal-validation'
    || family === 'destructive'
    || family === 'general-edit';
}

function buildRouteMetaSignals(prompt: string): string[] {
  const signals: string[] = [];
  if (BROAD_SCOPE_RE.test(prompt)) signals.push('broad-scope');
  if (COMPLEX_ACTION_RE.test(prompt)) signals.push('complex-action');
  if (isPlanningOnlyRequest(prompt)) signals.push('planning-only-request');
  return signals;
}

function buildFamilyAliasSignals(family: TaskIntentFamily): string[] {
  if (family === 'read-only-advisory' || family === 'safety-refusal' || family === 'review') return ['read-only-route'];
  if (family === 'standalone-program') return ['standalone-program-route'];
  if (family === 'existing-project-edit') return ['existing-project-route'];
  return [];
}

function isPlanningOnlyRequest(text: string): boolean {
  const hasPlanningTerm = PLANNING_TERM_RE.test(text);
  const actionableText = text
    .replace(/(?:但|先|暂时|目前)?\s*(?:不要|无需|不需要|别|先不要)\s*(?:改|修改|实现|写|落地|执行|apply)?\s*(?:代码|code)?/gi, '')
    .replace(/(?:no|without)\s+(?:code|implementation|changes?)/gi, '');
  const hasImplementationTerm = IMPLEMENTATION_TERM_RE.test(actionableText);
  return hasPlanningTerm && !hasImplementationTerm;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
