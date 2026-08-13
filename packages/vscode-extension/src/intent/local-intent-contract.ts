import { hasExplicitWorkspacePath } from '../workspace/path-patterns';
import {
  isAdvisoryPlanningRequest,
  isDeferredImplementationRequest,
  isDeliverableWriteRequest,
  isDirectImplementationRequest,
  isScopedNoChangeWithDeliverableWriteRequest,
} from './advisory-patterns';
import { isUnsafeSecretHarvestingImplementationRequest } from './safety-intent';
import { classifyExternalEffectIntent } from './operational-language-boundary';
import {
  hasProjectHealthRepairIntent,
  hasRuntimeErrorRepairIntent,
  hasUserSymptomRepairIntent,
  hasValidationHealthRepairIntent,
  isSelfHelpRepairQuestion,
} from './conditional-repair-intent';
import type { SemanticTaskKind } from './semantic-intent';
import type { ExecutionMode } from './intent-types';
import type { TaskSemanticKind, TaskSemanticScope } from '../task-semantic-contract';

export interface LocalIntentSemanticInput {
  kind: TaskSemanticKind;
  scope: TaskSemanticScope;
  mutation: {
    requested: boolean;
    prohibited: boolean;
    sourceChange: boolean;
    fileArtifact: boolean;
    targets: readonly string[];
  };
  validation: {
    runRequested: boolean;
  };
  semanticSignals: readonly string[];
}

export interface LocalIntentContext {
  empty: boolean;
  greetingOnly: boolean;
  hasExplicitWorkspacePath: boolean;
  reviewRequested: boolean;
  failureContext: boolean;
  externalEffect: 'none' | 'question' | 'requested';
  broadScope: boolean;
  complexAction: boolean;
  planningOnly: boolean;
  unsafeSecretHarvesting: boolean;
}

export interface LocalIntentContract {
  version: 'devseek.local-intent-contract/v1';
  mode: ExecutionMode;
  taskKind: SemanticTaskKind;
  confidence: number;
  score: number;
  signals: string[];
  blockers: string[];
  reason: string;
  requiresConfirmation: boolean;
  context: LocalIntentContext;
}

interface LocalIntentDecision {
  mode: ExecutionMode;
  confidence: number;
  score: number;
  signals: string[];
  blockers: string[];
  reason: string;
  requiresConfirmation: boolean;
}

const EXPLICIT_NO_CHANGE_RE = /(不要修改|无需修改|不修改|不要改|别改|不要修复|无需修复|不修复|别修复|不要改动|不改动|不要动|别动|不要动代码|不要写入|不要写文件|不要写任何文件|不写文件|不写任何文件|不要创建|不创建|不要生成|不生成|不做(?:修改|变更|修复)|只讨论|仅讨论|只分析|仅分析|只指出|仅指出|只说结论|仅说结论|只给结论|仅给结论|直接回复|直接回答|不要落地|先不要改|不需要代码|不要apply|不做变更|just\s+(?:chat|talk|discuss|explain)|only\s+(?:explain|discuss|answer)|(?:do\s+not|don't|must\s+not|should\s+not|never|without)\s+[^,.;\n]{0,32}(?:change|modify|edit|touch|write|implement)|no\s+(?:edits?|changes?|implementation|code)(?:\s+yet)?|only\s+need\s+(?:a\s+)?plan)/i;
const GREETING_ONLY_RE = /^(?:hi|hello|ello|hey|thanks?|thank\s+you|thx|great[,，\s]+thank\s+you|appreciate\s+it|that\s+helps|thanks[,，\s]+that\s+helps|ok(?:ay)?(?:[,，\s]+(?:got\s+it|thanks?))?|got\s+it|sounds\s+good|谢谢|多谢|感谢|你好|您好|嗨|哈喽|早上好|上午好|下午好|晚上好|在吗|在不在|辛苦了|好(?:的)?(?:[,，\s]+(?:明白了|了解|收到))?|明白了|了解|收到)[\s!.。！？?，,]*$/i;
const GREETING_PREFIX_RE = /^(?:hi|hello|hey|你好|您好|嗨|哈喽)[,，\s]+/i;
const EDIT_RE = /(修复|修正|修改|改一下|改成|改为|改用|换成|换为|调整为|实现|编写|写一个|写个|创建|新建|生成|新增|添加|补全|完善|重构|改造|替换|替换为|重命名|改名|移动|移到|挪到|挪动|复制|拷贝|追加|插入|删除|移除|删掉|优化|升级|接入|封装|拆分|处理一下|帮(?:我|忙)?[^，,。；;\n]{0,8}处理|解决|搞定|发布|上线|部署|安装插件|安装扩展|fix|repair|modify|change|implement|create|write|add|update|refactor|generate|replace|rename|move|copy|append|insert|delete|remove|release|deploy|publish|install\s+extension)/i;
const NEGATED_EDIT_CLAUSE_RE = /(?:当前不准备|先不准备|不准备|先不要|暂不|不要|不得|禁止|不允许|无需|无须|不需要|别)[^，,。；;\n]{0,24}(?:修复|修正|修改|改动|动|触碰|创建|新建|生成|编写|写入|保存|输出|新增|添加|实现|重构|替换|重命名|改名|移动|移到|挪到|挪动|复制|拷贝|追加|插入|发布|上线|部署|安装|提交|推送|拉取)|不(?:修复|修正|修改|改动|动|触碰|创建|新建|生成|编写|写入|保存|输出|新增|添加|实现|重构|替换|发布|上线|部署|安装|提交|推送|拉取)|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,32}(?:fix|repair|modify|change|edit|touch|create|write|generate|save|add|update|implement|refactor|replace|rename|move|copy|append|insert|release|deploy|publish|install|commit|push|pull|fetch|merge|rebase)|no\s+(?:edits?|changes?|implementation|code)(?:\s+yet)?/gi;
const RUN_RE = /(运行|执行|编译|构建|测试|跑一下|复现|验证|启动|调试|\b(?:run|execute|compile|build|test|start|reproduce)\b)/i;
const FOLLOW_UP_RUN_RE = /(?:能(?:否)?(?:执行|运行|编译|构建|测试|验证)|看(?:一下|下|看)?(?:执行|运行|编译|构建|测试|验证)?结果|看到(?:执行|运行|编译|构建|测试|验证)?结果|(?:给(?:我)?|输出|展示|显示|提供|返回).{0,12}(?:执行|运行|编译|构建|测试|验证)?结果|(?:执行|运行|编译|构建|测试|验证|跑)(?:一下|下|一遍|一次)?(?:看看|看结果)|(?:执行|运行|编译|构建|测试|验证|跑).{0,8}结果|(?:show|see|view).{0,20}(?:result|output)|(?:can|could).{0,20}(?:run|execute|compile|build|test|verify))/i;
const ARTIFACT_PATH_QUERY_RE = /(?:(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物|生成的文件|创建的文件|写入的文件|输出文件|产物|artifact).{0,18}(?:在哪里|在哪|哪里|路径|位置|path|where)|(?:在哪里|在哪|哪里|路径|位置|path|where).{0,18}(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物|生成的文件|创建的文件|写入的文件|输出文件|产物|artifact))/i;
const PLAN_RE = /(方案|计划|设计|架构|思路|怎么改|如何改|重构计划|实施步骤|roadmap|plan|design|architecture|approach)/i;
const EXPLICIT_PLAN_RE = /(方案|计划|架构|思路|怎么改|如何改|重构计划|实施步骤|roadmap|plan|architecture|approach)/i;
const PLAN_WITH_IMPLEMENTATION_RE = /(?:并|然后|同时|再|最后|通过|落地|完成).{0,24}(?:代码实现|实现|修改|编写|创建|新增|添加|编译|构建|运行|执行|验证|测试|implement|modify|write|create|add|compile|build|run|execute|verify|test)/i;
const INSPECT_RE = /(分析|解释|说明|查看|看下|看一下|检查|排查|定位|查找|寻找|搜索|阅读|梳理|总结|review|inspect|find|locate|search|scan|analy[sz]e|explain|check|diagnose|read|summari[sz]e|take\s+a\s+look|look\s+(?:at|through))/i;
const QA_RE = /(什么是|为什么|怎么理解|区别|原理|概念|介绍一下|能介绍|请介绍|如何使用|怎么用|what\s+is|why|how\s+to|difference|explain\s+the\s+concept)/i;
const CODE_CONTEXT_RE = /(代码|文件|项目|函数|类|模块|报错|错误|日志|异常|栈|依赖|配置|接口|组件|脚本|code|file|project|function|class|module|error|log|exception|stack|config|component|script)/i;
const INTERACTIVE_FEATURE_CONTEXT_RE = /(程序|应用|功能|界面|页面|窗口|按钮|控件|图形|形状|渲染|动画|鼠标|键盘|旋转|缩放|平移|选择|切换|显示|opengl|glut|webgl|three\.?js|canvas|viewer|renderer|ui|gui|feature|interaction|interactive|mouse|keyboard|rotate|rotation|zoom|pan|select|toggle|display|render|shape|geometry|control)/i;
const CAPABILITY_FEATURE_REQUEST_RE = /(?:(?:能|可以|可否|能否|能不能|是否可以|请|帮我|麻烦).{0,40}(?:提供|支持|加上|添加|新增|增加|实现|做成|改成|改为|改用|换成|换为|调整为|替换为|做到|具备|拥有).{0,40}(?:功能|能力|控制|操作|交互|显示|旋转|缩放|平移|选择|切换|独立|单独|feature|support|control|interaction|display|rotate|rotation|zoom|pan|select|toggle)|(?:不能|无法|没有|缺少|不支持).{0,40}(?:单独|独立|控制|操作|交互|显示|旋转|缩放|平移|选择|切换|support|control|rotate|rotation|select))/i;
const READ_ONLY_CAPABILITY_QUESTION_RE = /(什么是|为什么|什么原因|怎么理解|区别|介绍|解释|说明|原理|概念|文档|教程|示例|怎么用|如何使用|用法|what\s+is|why|how\s+to|explain|describe|introduction)/i;
const REVIEW_RE = /(?:审查|评审|review|code\s+review|PR\b|pull\s+request)/i;
const WORKSPACE_DIFF_CONTEXT_RE = /(?:当前\s*(?:diff|补丁|改动|修改|变更)|current\s+(?:diff|patch|changes?)|git\s+diff)/i;
const FAILURE_RE = /(?:日志|失败|报错|错误|不通过|挂了|重试|回归|QualityGate|replay|errors?|fails?|failed|failure|broken)/i;
const BROAD_SCOPE_RE = /(整个|全部|全局|项目|仓库|系统|架构|多入口|跨平台|跨模块|模块化|runtime|workflow|provider|权限|状态机)/i;
const COMPLEX_ACTION_RE = /(重构|改造|拆分|迁移|重写|优化架构|革命性|架构设计|refactor|re-architect|architecture)/i;
const PLANNING_TERM_RE = /(方案|计划|设计|怎么改|如何改|重构计划|实施步骤|roadmap|plan|design|approach)/i;
const IMPLEMENTATION_TERM_RE = /(代码|实现|修改|改造|拆分|迁移|重写|接入|落地|执行|模块化|runtime|workflow|provider|权限|状态机|code|implement|split|migrate|rewrite)/i;

export function buildLocalIntentContract(
  promptText: string,
  semantic: LocalIntentSemanticInput,
): LocalIntentContract {
  const text = String(promptText || '').trim();
  const positiveActionText = text.replace(NEGATED_EDIT_CLAUSE_RE, ' ');
  const withoutGreeting = text.replace(GREETING_PREFIX_RE, '').trim();
  const hasPath = hasExplicitWorkspacePath(text);
  const hasInteractiveFeatureContext = INTERACTIVE_FEATURE_CONTEXT_RE.test(text);
  const hasCodeContext = CODE_CONTEXT_RE.test(text) || hasInteractiveFeatureContext || hasPath;
  const isFollowUpRunRequest = !hasPath && FOLLOW_UP_RUN_RE.test(text);
  const isCapabilityFeatureRequest = hasCodeContext
    && CAPABILITY_FEATURE_REQUEST_RE.test(text)
    && !READ_ONLY_CAPABILITY_QUESTION_RE.test(withoutGreeting);
  const hasDeliverableWriteRequest = isDeliverableWriteRequest(text);
  const hasScopedNoChangeWithDeliverableWrite = isScopedNoChangeWithDeliverableWriteRequest(text);
  const externalEffect = classifyExternalEffectIntent(positiveActionText);
  const isRunRequest = RUN_RE.test(text);
  const isRepairSelfHelpQuestion = isSelfHelpRepairQuestion(text);
  const hasValidationHealthRepairRequest = hasValidationHealthRepairIntent(text)
    && !semantic.mutation.prohibited;
  const hasProjectHealthRepairRequest = hasProjectHealthRepairIntent(text)
    && !semantic.mutation.prohibited;
  const hasRuntimeErrorRepairRequest = hasRuntimeErrorRepairIntent(text)
    && !semantic.mutation.prohibited;
  const hasUserSymptomRepairRequest = hasUserSymptomRepairIntent(text)
    && !semantic.mutation.prohibited;
  const hasConditionalRepairRequest = hasValidationHealthRepairRequest
    || hasProjectHealthRepairRequest
    || hasRuntimeErrorRepairRequest
    || hasUserSymptomRepairRequest;
  const hasWorkspaceDiffContext = WORKSPACE_DIFF_CONTEXT_RE.test(text);
  const context: LocalIntentContext = {
    empty: !text,
    greetingOnly: GREETING_ONLY_RE.test(text),
    hasExplicitWorkspacePath: hasPath,
    reviewRequested: REVIEW_RE.test(text),
    failureContext: FAILURE_RE.test(text) || hasConditionalRepairRequest,
    externalEffect,
    broadScope: BROAD_SCOPE_RE.test(text),
    complexAction: COMPLEX_ACTION_RE.test(text),
    planningOnly: isPlanningOnlyRequest(text),
    unsafeSecretHarvesting: isUnsafeSecretHarvestingImplementationRequest(text),
  };
  const finish = (decision: LocalIntentDecision): LocalIntentContract => ({
    version: 'devseek.local-intent-contract/v1',
    ...decision,
    taskKind: resolveTaskKind(decision, semantic, context),
    context,
  });

  if (!text) return finish(decision('smalltalk', 0, 0, [], 'empty-prompt', ['empty-prompt']));
  if (context.greetingOnly) return finish(decision('smalltalk', 0.95, -4, ['greeting-only'], 'greeting-only'));

  if (EXPLICIT_NO_CHANGE_RE.test(text)
    && !hasScopedNoChangeWithDeliverableWrite
    && !semantic.mutation.requested
    && !semantic.validation.runRequested) {
    const isReadOnlyPlanning = EXPLICIT_PLAN_RE.test(text) && hasCodeContext;
    const mode = isReadOnlyPlanning ? 'plan' : hasCodeContext || INSPECT_RE.test(text) ? 'inspect' : 'qa';
    const signals = [mode === 'plan'
      ? 'read-only-planning'
      : mode === 'inspect' ? 'read-only-inspection' : 'explicit-no-change'];
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(mode, 0.9, -3, signals, 'explicit-no-change', ['explicit-no-change']));
  }

  if (semantic.kind === 'destructive') {
    return finish(decision(
      'destructive', 0.9, 6, ['destructive-operation'], 'destructive-operation', [], true,
    ));
  }

  if (ARTIFACT_PATH_QUERY_RE.test(text)) {
    const signals = ['artifact-path-query'];
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      'inspect', hasPath ? 0.88 : 0.82, hasPath ? 3 : 2, signals,
      hasPath ? 'artifact-path-query-with-file-path' : 'artifact-path-query',
    ));
  }

  if (context.externalEffect === 'question') {
    return finish(decision('qa', 0.78, -2, ['question-answer', 'external-effect-question'], 'external-effect-question'));
  }
  if (context.externalEffect === 'requested') {
    const signals = ['external-effect-request', 'edit-request'];
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      'edit', hasPath ? 0.9 : 0.84, hasPath ? 5 : 4, signals,
      hasPath ? 'external-effect-with-file-path' : 'external-effect-request',
    ));
  }

  if (isRepairSelfHelpQuestion) {
    const mode = hasCodeContext ? 'inspect' : 'qa';
    const signals = ['question-answer', 'self-help-repair-question'];
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      mode,
      hasPath ? 0.86 : 0.8,
      hasPath ? 3 : -1,
      signals,
      hasPath ? 'self-help-repair-question-with-file-path' : 'self-help-repair-question',
    ));
  }

  if (context.reviewRequested
    && (hasCodeContext || hasWorkspaceDiffContext)
    && !semantic.mutation.requested
    && !isRunRequest) {
    const signals = ['review-request', 'inspection-request'];
    if (hasPath) signals.push('explicit-file-path');
    if (hasWorkspaceDiffContext) signals.push('workspace-diff-review');
    return finish(decision(
      'inspect', hasPath || hasWorkspaceDiffContext ? 0.88 : 0.8,
      hasPath || hasWorkspaceDiffContext ? 3 : 2,
      signals,
      hasWorkspaceDiffContext ? 'review-current-diff' : 'review-request',
    ));
  }

  if (semantic.mutation.requested
    && (semantic.kind === 'standalone-code' || semantic.kind === 'file-artifact')) {
    const signals = ['edit-request', ...semantic.semanticSignals];
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      'edit', hasPath || semantic.mutation.targets.length > 0 ? 0.9 : 0.84,
      hasPath || semantic.mutation.targets.length > 0 ? 5 : 4,
      [...new Set(signals)],
      semantic.kind === 'standalone-code' ? 'task-contract-standalone-code' : 'task-contract-file-artifact',
    ));
  }

  const priorTaskContinuation = semantic.semanticSignals.includes('prior-task-continuation-request');
  if (priorTaskContinuation
    && semantic.mutation.requested
    && semantic.kind === 'existing-project-code') {
    const signals = ['edit-request', ...semantic.semanticSignals];
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      'edit',
      hasPath || semantic.mutation.targets.length > 0 ? 0.9 : 0.84,
      hasPath || semantic.mutation.targets.length > 0 ? 5 : 4,
      [...new Set(signals)],
      hasPath || semantic.mutation.targets.length > 0
        ? 'task-contract-existing-project-code-with-target'
        : 'task-contract-existing-project-code',
    ));
  }

  if (hasDeliverableWriteRequest
    && hasCodeContext
    && !semantic.mutation.prohibited
    && !isDeferredImplementationRequest(text)) {
    const signals = ['edit-request', 'deliverable-write-request', ...semantic.semanticSignals];
    if (hasPath) signals.push('explicit-file-path');
    if (hasScopedNoChangeWithDeliverableWrite) signals.push('scoped-existing-source-no-change');
    return finish(decision(
      'edit', hasPath ? 0.92 : 0.84, hasPath ? 5 : 4, signals,
      hasPath ? 'deliverable-write-with-file-path' : 'deliverable-write-request',
    ));
  }

  if (isAdvisoryPlanningRequest(text)
    && hasCodeContext
    && (!isDirectImplementationRequest(text) || isDeferredImplementationRequest(text))) {
    const signals = ['advisory-planning-request'];
    if (hasPath) signals.push('explicit-file-path');
    if (isDeferredImplementationRequest(text)) signals.push('deferred-implementation');
    return finish(decision(
      'plan', hasPath ? 0.9 : 0.8, hasPath ? 3 : 2, signals,
      hasPath ? 'advisory-plan-with-file-path' : 'advisory-planning-request',
    ));
  }

  if (EXPLICIT_PLAN_RE.test(text) && hasCodeContext && !PLAN_WITH_IMPLEMENTATION_RE.test(text)) {
    return finish(decision(
      'plan', hasPath ? 0.86 : 0.75, hasPath ? 3 : 2,
      hasPath ? ['planning-request', 'explicit-file-path'] : ['planning-request'],
      hasPath ? 'plan-with-file-path' : 'planning-request',
    ));
  }

  if (hasConditionalRepairRequest) {
    const signals = [
      'edit-request',
      'run-request',
      'conditional-repair-on-failure',
      ...(hasValidationHealthRepairRequest ? [
        'validation-repair-request',
        'validation-health-repair-request',
      ] : []),
      ...(hasProjectHealthRepairRequest ? ['project-health-repair-request'] : []),
      ...(hasRuntimeErrorRepairRequest ? ['runtime-error-repair-request'] : []),
      ...(hasUserSymptomRepairRequest ? ['user-symptom-repair-request'] : []),
      ...semantic.semanticSignals,
    ];
    if (isFollowUpRunRequest) signals.push('follow-up-run-request');
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      'edit', hasPath ? 0.92 : 0.88, hasPath ? 5 : 4, [...new Set(signals)],
      hasPath ? 'run-to-repair-with-file-path' : 'run-to-repair',
    ));
  }

  if (isRunRequest
    && EXPLICIT_NO_CHANGE_RE.test(text)
    && !semantic.mutation.requested) {
    const signals = ['run-request', 'write-revoked-run-only'];
    if (isFollowUpRunRequest) signals.push('follow-up-run-request');
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      'run',
      hasPath ? 0.88 : isFollowUpRunRequest ? 0.86 : 0.82,
      hasPath ? 4 : 3,
      signals,
      hasPath ? 'run-with-file-path-no-change' : 'run-only-no-change',
      ['explicit-no-change'],
    ));
  }

  const isDirectEditRequest = EDIT_RE.test(positiveActionText);
  if (isDirectEditRequest || isCapabilityFeatureRequest) {
    const signals = [
      ...(isDirectEditRequest ? ['edit-request'] : ['capability-feature-request']),
      ...semantic.semanticSignals,
    ];
    if (isDirectEditRequest && isCapabilityFeatureRequest) signals.push('capability-feature-request');
    if (hasInteractiveFeatureContext) signals.push('interactive-feature-context');
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      'edit', hasPath ? 0.9 : 0.82, hasPath ? 5 : 4, signals,
      hasPath ? 'edit-with-file-path' : isCapabilityFeatureRequest && !isDirectEditRequest
        ? 'capability-feature-request' : 'edit-request',
    ));
  }

  if (isRunRequest) {
    const signals = ['run-request'];
    if (isFollowUpRunRequest) signals.push('follow-up-run-request');
    if (hasPath) signals.push('explicit-file-path');
    return finish(decision(
      'run', hasPath ? 0.86 : isFollowUpRunRequest ? 0.84 : 0.78, hasPath ? 4 : 3, signals,
      hasPath ? 'run-with-file-path' : isFollowUpRunRequest ? 'follow-up-run-request' : 'run-request',
    ));
  }

  if (PLAN_RE.test(text) && hasCodeContext && !PLAN_WITH_IMPLEMENTATION_RE.test(text)) {
    return finish(decision(
      'plan', hasPath ? 0.86 : 0.75, hasPath ? 3 : 2,
      hasPath ? ['planning-request', 'explicit-file-path'] : ['planning-request'],
      hasPath ? 'plan-with-file-path' : 'planning-request',
    ));
  }

  if (INSPECT_RE.test(text) && hasCodeContext) {
    return finish(decision(
      'inspect', hasPath ? 0.86 : 0.74, hasPath ? 3 : 2,
      hasPath ? ['inspection-request', 'explicit-file-path'] : ['inspection-request'],
      hasPath ? 'inspect-with-file-path' : 'inspection-request',
    ));
  }

  if (QA_RE.test(withoutGreeting) || /[?？]\s*$/.test(text)) {
    return finish(decision('qa', 0.78, -2, ['question-answer'], 'question-answer'));
  }
  return finish(decision('qa', 0.6, -1, ['default-chat'], 'default-chat'));
}

function decision(
  mode: ExecutionMode,
  confidence: number,
  score: number,
  signals: string[],
  reason: string,
  blockers: string[] = [],
  requiresConfirmation = false,
): LocalIntentDecision {
  return { mode, confidence, score, signals, blockers, reason, requiresConfirmation };
}

function resolveTaskKind(
  local: LocalIntentDecision,
  semantic: LocalIntentSemanticInput,
  context: LocalIntentContext,
): SemanticTaskKind {
  if (context.unsafeSecretHarvesting) return 'ambiguous';
  if (local.mode === 'smalltalk') return 'smalltalk';
  if (local.mode === 'qa') return local.confidence <= 0.6 ? 'ambiguous' : 'question-answer';
  if (local.mode === 'inspect') return context.reviewRequested ? 'code-review' : 'read-only-analysis';
  if (local.mode === 'plan') return 'planning';
  if (local.mode === 'run') return 'terminal-validation';
  if (local.mode === 'destructive') return 'destructive';
  if (context.externalEffect === 'requested') return 'external-effect';
  if (semantic.kind === 'standalone-code' || semantic.scope === 'standalone') return 'standalone-program';
  if (semantic.kind === 'file-artifact' || semantic.mutation.fileArtifact) return 'file-artifact';
  return 'existing-project-edit';
}

function isPlanningOnlyRequest(text: string): boolean {
  const hasPlanningTerm = PLANNING_TERM_RE.test(text);
  const actionableText = text
    .replace(/(?:但|先|暂时|目前)?\s*(?:不要|无需|不需要|别|先不要)\s*(?:改|修改|实现|写|落地|执行|apply)?\s*(?:代码|code)?/gi, '')
    .replace(/(?:no|without)\s+(?:code|implementation|changes?)/gi, '');
  return hasPlanningTerm && !IMPLEMENTATION_TERM_RE.test(actionableText);
}
