import {
  buildTaskContract,
  hasQualityObligation,
  hasStandaloneCodeGenerationIntent,
  resolveTaskMutationTargets,
  resolveTaskReadTargets,
  type TaskContract,
} from './agent/task-contract';
import { isCodeArtifactPathValue } from './artifact-path-kind';
import { stripAgentProceduralExecutionPhrases } from './intent/agent-procedure-text';
import { hasDestructiveIntent } from './intent/destructive-intent';
import {
  hasOperationalRunProhibition,
  splitOperationalClauses,
  stripOperationalRunProhibitionPhrases,
} from './intent/operational-language-boundary';
import {
  buildLocalIntentContract,
  type LocalIntentContract,
} from './intent/local-intent-contract';
import {
  isAdvisoryActionQuestion,
  stripAdvisoryActionQuestionPhrases,
} from './intent/advisory-patterns';
import {
  hasProjectHealthRepairIntent,
  hasRuntimeErrorRepairIntent,
  hasUserSymptomRepairIntent,
  hasValidationHealthRepairIntent,
  isSelfHelpRepairQuestion,
} from './intent/conditional-repair-intent';
import {
  buildTaskSemanticObligationContracts,
  shouldRequireValidationResult,
  type TaskSemanticAmbiguityContract,
  type TaskSemanticCompletionContract,
  type TaskSemanticObligations,
} from './intent/task-semantic-obligations';
import { parseSimpleFileWriteRequest } from './agent/simple-file-intent';

export type TaskSemanticScope = 'none' | 'standalone' | 'existing-project' | 'unknown';

export type TaskSemanticKind =
  | 'read-only'
  | 'standalone-code'
  | 'existing-project-code'
  | 'file-artifact'
  | 'validation'
  | 'destructive'
  | 'general';

export interface TaskSemanticProjectInstructionSource {
  sourceId?: string;
  kind: string;
  relPath: string;
  content?: string;
  priority: number;
  depth: number;
}

export interface TaskSemanticProjectInstructionDiagnostic {
  kind: string;
  severity: string;
  message: string;
  sources: string[];
}

export interface TaskSemanticProjectInstructionBinding {
  status: 'none' | 'bound' | 'conflicted';
  content: string;
  fingerprint: string;
  sources: TaskSemanticProjectInstructionSource[];
  diagnostics: TaskSemanticProjectInstructionDiagnostic[];
}

export interface TaskSemanticRevisionBinding {
  strategy: 'initial' | 'merge' | 'replace-scope' | 'replace-current';
  revisionId?: string;
  parentRevisionId?: string;
  inheritedFields: string[];
}

export interface TaskSemanticContract {
  version: 'devseek.task-semantic-contract/v3';
  prompt: string;
  taskContract: TaskContract;
  kind: TaskSemanticKind;
  scope: TaskSemanticScope;
  mutation: {
    requested: boolean;
    prohibited: boolean;
    sourceChange: boolean;
    fileArtifact: boolean;
    targets: string[];
  };
  read: {
    requested: boolean;
    contentRequested: boolean;
    targets: string[];
  };
  validation: {
    requested: boolean;
    compileRequested: boolean;
    runRequested: boolean;
    testRequested: boolean;
    runProhibited: boolean;
    stdoutRequested: boolean;
    fileCheckRequested: boolean;
  };
  quality: {
    formalProjectRequired: boolean;
  };
  obligations: TaskSemanticObligations;
  completion: TaskSemanticCompletionContract;
  ambiguity: TaskSemanticAmbiguityContract;
  context: {
    revision: TaskSemanticRevisionBinding;
    projectInstructions: TaskSemanticProjectInstructionBinding;
  };
  intent: LocalIntentContract;
  signals: string[];
}

const NON_CODE_ARTIFACT_RE = /\.(?:md|markdown|txt|json|jsonc|ya?ml|toml|ini|csv|tsv|log|xml|html|css)$/i;
const WRITE_ACTION_RE = /(?:创建|新建|生成|编写|写一个|写个|写入|写到|保存|输出|新增|添加|整理|记录|汇总|修改|更新|修复|修正|处理一下|解决|搞定|补全|完善|重构|改造|替换|重命名|改名|移动|移到|挪到|挪动|复制|拷贝|追加|插入|翻译|总结|摘要|概括|删除|移除|删掉|接入|封装|拆分|实现|交付|create|write|compose|draft|generate|save|add|update|modify|fix|repair|resolve|implement|refactor|replace|rename|move|copy|append|insert|translate|summari[sz]e|delete|remove|deliver)/i;
const CREATE_SOURCE_ACTION_RE = /(?:创建|新建|生成|编写|写一个|写个|新增|添加|制作|create|write|generate|add|build|produce)/i;
const EXISTING_SOURCE_EDIT_RE = /(?:修改|更新|修复|修正|处理一下|解决|搞定|补全|完善|重构|改造|替换|接入|封装|拆分|删除|移除|删掉|update|modify|change|edit|fix|repair|resolve|refactor|replace|delete|remove)/i;
const EXISTING_IMPLEMENTATION_CONTEXT_RE = /(?:(?:现有|原有|已有|既有|原来|旧|当前)[^，,。；;\n]{0,10}(?:实现|代码|逻辑|模块|功能|implementation|code|logic)|(?:existing|current|old|previous)[^,.;\n]{0,16}(?:implementation|code|logic))/gi;
const ADVISORY_ACTION_CONTEXT_RE = /(?:(?:修改|修复|修正|补全|完善|重构|改造|替换|接入|封装|拆分|实现|交付|发布|上线|部署|modify|fix|repair|refactor|implement|deliver|release|deploy|publish)[^，,。；;、\n]{0,80}(?:方案|计划|设计|思路|步骤|对策|建议|检讨|任务|清单|文档|角度|\broadmap\b|\bplan\b|\bdesign\b|\bapproach\b|\badvice\b)|(?:方案|计划|设计|思路|步骤|对策|建议|检讨|任务|清单|文档|角度|\broadmap\b|\bplan\b|\bdesign\b|\bapproach\b|\badvice\b)[^，,。；;、\n]{0,80}(?:修改|修复|修正|补全|完善|重构|改造|替换|接入|封装|拆分|实现|交付|发布|上线|部署|modify|fix|repair|refactor|implement|deliver|release|deploy|publish))/gi;
const NO_WRITE_RE = /(?:停止(?:创建|写入|修改|改写|编辑|应用|套用|落地)|stop\s+(?:writing|editing|modifying|applying)|(?:当前不准备|先不准备|不准备|先不要|暂不|不要|不得|禁止|不允许|无需|无须|不需要|别)[^，,。；;\n]{0,24}(?:创建|新建|生成|编写|写|写入|写到|保存|输出|新增|添加|修改|改|更新|修复|修正|补全|完善|重构|改造|替换|重命名|改名|移动|移到|挪到|挪动|复制|拷贝|追加|插入|翻译|总结|摘要|概括|提取|接入|封装|拆分|实现|交付|应用|套用|采纳|落地|改动|动|触碰|碰|覆盖|删除)|不(?:创建|新建|生成|编写|写|写入|保存|输出|新增|添加|修改|改|更新|修复|应用|套用|采纳|落地|改动|动|触碰|碰|覆盖|删除|做(?:修改|变更|修复))|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,32}(?:create|write|generate|save|add|update|modify|change|edit|fix|repair|implement|refactor|replace|rename|move|copy|append|insert|translate|summari[sz]e|deliver|apply(?:\s+(?:it|them|the\s+patch|patch|diff))?|land|touch|overwrite|delete)|no\s+(?:applying|application|edits?|changes?|implementation|code)(?:\s+yet)?)/i;
const NO_WRITE_CLAUSE_RE = /(?:当前不准备|先不准备|不准备|先不要|暂不|不要|不得|禁止|不允许|无需|无须|不需要|别)[^，,。；;\n]{0,24}(?:创建|新建|生成|编写|写|写入|写到|保存|输出|新增|添加|修改|改|更新|修复|修正|补全|完善|重构|改造|替换|重命名|改名|移动|移到|挪到|挪动|复制|拷贝|追加|插入|翻译|总结|摘要|概括|提取|接入|封装|拆分|实现|交付|应用|套用|采纳|落地|改动|动|触碰|碰|覆盖|删除)|不(?:创建|新建|生成|编写|写|写入|保存|输出|新增|添加|修改|改|更新|修复|应用|套用|采纳|落地|改动|动|触碰|碰|覆盖|删除|做(?:修改|变更|修复))|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,32}(?:create|write|generate|save|add|update|modify|change|edit|fix|repair|implement|refactor|replace|rename|move|copy|append|insert|translate|summari[sz]e|deliver|apply(?:\s+(?:it|them|the\s+patch|patch|diff))?|land|touch|overwrite|delete)|no\s+(?:applying|application|edits?|changes?|implementation|code)(?:\s+yet)?/gi;
const OTHER_FILE_SCOPE_RE = /(?:(?:其他|其它|其余|用户)(?:的)?(?:文件|文档|源码|代码)|别的(?:文件|文档|源码|代码)?|(?:other|unrelated|user)\s+files?)/i;
const FORMAL_SOURCE_SCOPE_RE = /(?:正式|原有|现有|既有|生产|主线|原项目|任何|所有|全部)?[^，,。；;\n]{0,8}(?:源码|源码目录|source\s+code)|(?:正式|原有|现有|既有|生产|主线|原项目)[^，,。；;\n]{0,8}(?:代码|代码目录|code)|(?:formal|production|existing|original|any|all)\s+(?:source\s+code|source|code)|\bsource(?:\s+(?:code|files?))?\b/i;
const HISTORICAL_REQUIREMENT_SCOPE_RE = /(?:旧要求|旧需求|旧版本|原要求|原需求|先前要求|之前要求|前面(?:曾)?说|历史要求|历史需求|old|previous|prior|earlier)/i;
const VERSION_CONTROL_SCOPE_RE = /(?:\bgit\b|版本控制|仓库状态|提交记录|分支)|(?:version\s+control|repository\s+state|commit\s+history|branch)/i;
const NARROW_WRITE_OBJECT_SCOPE_RE = /(?:目录|文件夹|directories?|folders?)/i;
const CODE_DELIVERY_RE = /(?:代码实现|实现代码|实现接口|交付代码|代码副本|新增或修改代码|新增代码|修改代码|落地实现|implement(?:ing)?\s+(?:code|interface)|code\s+delivery)/i;
const ARTIFACT_PATH_QUERY_RE = /(?:(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物|生成的文件|创建的文件|写入的文件|输出文件|产物|artifact).{0,18}(?:在哪里|在哪|哪里|路径|位置|path|where)|(?:在哪里|在哪|哪里|路径|位置|path|where).{0,18}(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物|生成的文件|创建的文件|写入的文件|输出文件|产物|artifact))/i;
const VALIDATION_RE = /(?:验证|测试|编译|构建|运行|执行|读回|重新读取|复现|test|verify|compile|\bbuild\b(?!\s*(?:目录|文件夹|dir|directory))|run|execute|reproduce|read\s*back|(?:确认|检查)[^，,。；;\n]{0,32}(?:验证|测试|编译|构建|运行|执行|结果|输出|退出码|状态码|通过)|(?:check|confirm)[^,.;\n]{0,32}(?:tests?|verification|compile|build|run|execute|results?|outputs?|exit\s+code|status\s+code|passes?|passed)|\b(?:grep|rg|ripgrep)\b[^，,。；;\n]{0,32}(?:确认|验证|检查|verify|check|confirm))/i;
const COMPILE_RE = /(?:编译|构建|g\+\+|gcc|clang|cmake|\bmake\s+(?:all|build|check|test|install|clean|compile|lint|dist|package|release|debug|prod|dev|ci|verify|validate|coverage|bench|run|start|e2e|unit|integration|[-\w./]*[/.:][-\w./:]+)\b|\bcompile\b|\bbuild\b(?!\s*(?:目录|文件夹|dir|directory)))/i;
const RUN_RE = /(?:运行|执行|启动|跑一下|复现|\b(?:run|execute|start|reproduce)\b)/i;
const TEST_RE = /(?:测试|单元测试|test|ctest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|bun\s+test|go\s+test|cargo\s+test|unit\s+tests?)/i;
const STDOUT_RE = /(?:打印|输出|stdout|std::cout|\bcout\b|console\.log|print)/i;
const OUTPUT_ARTIFACT_RE = /(?:(?:输出|打印)[^，,。；;\n]{0,20}(?:文件|文档|报告|Markdown|md|目录|路径|清单|内容)|(?:文件|文档|报告|内容|最后一行|每行|一行)[^，,。；;\n]{0,24}(?:打印|输出|console\.log|print)|(?:output|print)[^,.;\n]{0,24}(?:file|document|report|markdown|content|line))/i;
const TEST_AS_IMPLEMENTATION_CONSTRAINT_RE = /(?:不要|不得|禁止|别|勿|请勿)[^，,。；;\n]{0,20}(?:为(?:了)?(?:通)?过|迎合|针对)\s*(?:测试|tests?)[^，,。；;\n]*|\b(?:do\s+not|don't|never)\b[^,.;\n]{0,24}\bhardcode\b[^,.;\n]{0,16}\btests?\b/gi;
const TEST_DISCUSSION_RE = /(?:missing|missed|lacking|lack\s+of|uncovered|insufficient)\s+tests?|test\s+coverage|test\s+results?|缺少测试|测试缺失|未覆盖测试|测试覆盖率不足|测试结果/gi;
const EXPLICIT_TEST_COMMAND_RE = /(?:运行|执行|run|execute)[^，,。；;\n]{0,24}(?:\.\/?|\b)(?:test\.sh|tests?|ctest|pytest|jest|vitest|mocha)\b/i;
const READ_ONLY_RE = /(?:只读|仅分析|只分析|仅讨论|只讨论|只指出|仅指出|只说结论|仅说结论|只给结论|仅给结论|直接回复|直接回答|当前不准备|不准备|先不要|暂不|不要落地|不需要代码|only\s+(?:explain|discuss|answer)|just\s+(?:chat|talk|discuss))/i;
const READ_REQUEST_RE = /(?:读取|读出|查看|看下|看一下|检查|确认|分析|提取|显示|告诉我|审查|评审|read|inspect|check|confirm|scan|analy[sz]e|extract|show|display|review|take\s+a\s+look|look\s+(?:at|through))/i;
const REVIEW_READ_FALLBACK_RE = /(?:审查|评审|\breview\b|code\s+review)/i;
const READ_CONTENT_RE = /(?:文件内容|内容|第一行|首行|真实值|常量值|显示|读出|提取|告诉我[^，,。；;\n]{0,20}(?:行|内容|值)|(?:show|display|read|extract)[^,.;\n]{0,28}(?:content|line|value)|(?:content|first\s+line|actual\s+value))/i;
const DERIVED_ARTIFACT_OUTPUT_RE = /(?:(?:读取|读出|查看|参考|根据|基于|read|from|based\s+on)[^，,。；;\n]{0,100}(?:翻译|总结|摘要|概括|提取|生成|写入|写到|保存|输出|translate|summari[sz]e|extract|generate|write|save|output)[^，,。；;\n]{0,40}(?:成|为|到|至|入|\bto\b|\binto\b|\bas\b)|(?:翻译|总结|摘要|概括|提取|translate|summari[sz]e|extract)[^，,。；;\n]{0,80}(?:成|为|到|至|入|\bto\b|\binto\b|\bas\b)|(?:复制|拷贝|copy)[^，,。；;\n]{0,40}(?:到|至|为|成|入|\bto\b|\binto\b|\bas\b))/i;
const DEVSEEK_ISOLATED_ARTIFACT_PATH_RE = /(?:^|\/)\.devseek[^/]*(?:\/|$)/i;
const PROJECT_SCALE_QUALITY_RE = /(?:正式项目|生产项目|正式源码|正式集成|主线(?:代码|源码)|项目级|跨模块|跨入口|整个(?:项目|仓库|系统)|全部(?:项目|仓库|系统)|全(?:项目|仓库|系统)|project[- ]wide|production\s+project|across\s+(?:the\s+)?(?:project|repository|codebase)|(?:entire|whole)\s+(?:project|repository|codebase)|cross[- ]module)/i;

export function buildTaskSemanticContract(promptText: string): TaskSemanticContract {
  const prompt = String(promptText || '').trim();
  const taskContract = buildTaskContract(prompt);
  const repairSelfHelpQuestion = isSelfHelpRepairQuestion(prompt);
  const advisoryActionQuestion = isAdvisoryActionQuestion(prompt);
  const actionIntentText = advisoryActionQuestion
    ? stripAdvisoryActionQuestionPhrases(prompt)
    : prompt;
  const classifiedMutationTargets = repairSelfHelpQuestion || advisoryActionQuestion
    ? []
    : resolveTaskMutationTargets(prompt);
  const baseRequestedMutationTargets = advisoryActionQuestion ? [] : [...new Set([
    ...taskContract.deliverableTargets,
    ...classifiedMutationTargets,
  ].filter(() => !repairSelfHelpQuestion))];
  let requestedMutationTargets = baseRequestedMutationTargets;
  const artifactPathQuery = ARTIFACT_PATH_QUERY_RE.test(prompt);
  const writeProhibitionClauses = splitOperationalClauses(prompt)
    .filter(clause => NO_WRITE_RE.test(clause));
  const hasScopedOtherFileProhibition = writeProhibitionClauses.some(clause => OTHER_FILE_SCOPE_RE.test(clause));
  const hasScopedFormalSourceProhibition = writeProhibitionClauses.some(clause => FORMAL_SOURCE_SCOPE_RE.test(clause));
  const hasScopedHistoricalRequirementProhibition = writeProhibitionClauses.some(clause => HISTORICAL_REQUIREMENT_SCOPE_RE.test(clause));
  const hasScopedVersionControlProhibition = writeProhibitionClauses.some(clause => VERSION_CONTROL_SCOPE_RE.test(clause));
  const hasScopedWriteObjectProhibition = writeProhibitionClauses.some(clause => NARROW_WRITE_OBJECT_SCOPE_RE.test(clause));
  const hasScopedPathProhibition = writeProhibitionClauses.some(clause => (
    taskContract.inputs.some(target => clauseMentionsTaskPath(clause, target))
  ));
  const hasScopedRequestedTargetProhibition = writeProhibitionClauses.some(clause => (
    baseRequestedMutationTargets.some(target => clauseMentionsTaskPath(clause, target))
  ));
  const hasScopedDifferentTargetProhibition = writeProhibitionClauses.some(clause => (
    taskContract.inputs.some(target => clauseMentionsTaskPath(clause, target))
      && !baseRequestedMutationTargets.some(target => clauseMentionsTaskPath(clause, target))
  ));
  const hasUnscopedNoWrite = writeProhibitionClauses.some(clause => !(
    OTHER_FILE_SCOPE_RE.test(clause)
      || FORMAL_SOURCE_SCOPE_RE.test(clause)
      || HISTORICAL_REQUIREMENT_SCOPE_RE.test(clause)
      || VERSION_CONTROL_SCOPE_RE.test(clause)
      || NARROW_WRITE_OBJECT_SCOPE_RE.test(clause)
      || taskContract.inputs.some(target => clauseMentionsTaskPath(clause, target))
  ));
  const hasScopedTargetWriteBoundary = baseRequestedMutationTargets.length > 0
    && !hasUnscopedNoWrite
    && !hasScopedRequestedTargetProhibition
    && (
      hasScopedOtherFileProhibition
      || hasScopedHistoricalRequirementProhibition
      || hasScopedDifferentTargetProhibition
    );
  const positiveIntentText = actionIntentText
    .replace(NO_WRITE_CLAUSE_RE, ' ')
    .replace(EXISTING_IMPLEMENTATION_CONTEXT_RE, ' ')
    .replace(ADVISORY_ACTION_CONTEXT_RE, ' ');
  const positiveWriteAction = !artifactPathQuery && (
    WRITE_ACTION_RE.test(positiveIntentText)
    || DERIVED_ARTIFACT_OUTPUT_RE.test(positiveIntentText)
  ) && !repairSelfHelpQuestion;
  const scopedPositiveWriteAction = hasScopedTargetWriteBoundary
    && (
      WRITE_ACTION_RE.test(positiveIntentText)
      || EXISTING_SOURCE_EDIT_RE.test(prompt)
      || CODE_DELIVERY_RE.test(prompt)
    )
    && !repairSelfHelpQuestion;
  const effectivePositiveWriteAction = (positiveWriteAction || scopedPositiveWriteAction) && !hasUnscopedNoWrite;
  requestedMutationTargets = [...new Set([
    ...requestedMutationTargets,
    ...(effectivePositiveWriteAction ? resolveExplicitInputWriteTargets(positiveIntentText, taskContract.inputs) : []),
  ])];
  const sourceMutationTargets = requestedMutationTargets.filter(isSourcePath);
  const nonCodeMutationTargets = requestedMutationTargets.filter(isNonCodeArtifactPath);
  const explicitSourceFileWrite = effectivePositiveWriteAction && sourceMutationTargets.length > 0;
  const explicitNonCodeFileWrite = effectivePositiveWriteAction && nonCodeMutationTargets.length > 0;
  const isolatedSourceArtifact = sourceMutationTargets.some(target => DEVSEEK_ISOLATED_ARTIFACT_PATH_RE.test(target));
  const explicitNewSourceFile = explicitSourceFileWrite && CREATE_SOURCE_ACTION_RE.test(positiveIntentText);
  const standaloneCodeRaw = !advisoryActionQuestion && (
    taskContract.taskShapes.includes('standalone')
    || (hasStandaloneCodeGenerationIntent(prompt) && !taskContract.taskShapes.includes('existing-project'))
    || (explicitNewSourceFile && (
      isolatedSourceArtifact
      || !taskContract.taskShapes.includes('existing-project')
    ))
  );
  const standaloneCode = standaloneCodeRaw && !hasUnscopedNoWrite;
  const taskContractSourceChange = taskContract.deliverables.includes('source-change')
    && effectivePositiveWriteAction
    && !hasUnscopedNoWrite;
  const validationHealthRepairRequested = !artifactPathQuery
    && !advisoryActionQuestion
    && !hasUnscopedNoWrite
    && hasValidationHealthRepairIntent(prompt);
  const projectHealthRepairRequested = !artifactPathQuery
    && !advisoryActionQuestion
    && !hasUnscopedNoWrite
    && hasProjectHealthRepairIntent(prompt);
  const runtimeErrorRepairRequested = !artifactPathQuery
    && !advisoryActionQuestion
    && !hasUnscopedNoWrite
    && hasRuntimeErrorRepairIntent(prompt);
  const userSymptomRepairRequested = !artifactPathQuery
    && !advisoryActionQuestion
    && !hasUnscopedNoWrite
    && hasUserSymptomRepairIntent(prompt);
  const healthRepairRequested = validationHealthRepairRequested
    || projectHealthRepairRequested
    || runtimeErrorRepairRequested
    || userSymptomRepairRequested;
  const existingProjectCodeDelivery = !hasUnscopedNoWrite && (
    (taskContract.taskShapes.includes('existing-project') && CODE_DELIVERY_RE.test(positiveIntentText))
    || (explicitSourceFileWrite && EXISTING_SOURCE_EDIT_RE.test(positiveIntentText))
    || healthRepairRequested
  );
  const sourceChange = taskContractSourceChange || explicitSourceFileWrite || standaloneCode || existingProjectCodeDelivery;
  const fileArtifact = (taskContract.deliverables.includes('report') && effectivePositiveWriteAction)
    || explicitNonCodeFileWrite;
  const prohibited = writeProhibitionClauses.length > 0 && !sourceChange && !fileArtifact;
  const destructiveIntent = hasDestructiveIntent(prompt) && !prohibited;
  const mutationRequested = (sourceChange || fileArtifact || requestedMutationTargets.length > 0)
    && !prohibited;
  const simpleFileRequest = parseSimpleFileWriteRequest(prompt);
  const validationPrompt = stripAgentProceduralExecutionPhrases(
    stripSimpleFileContentPayload(prompt, simpleFileRequest?.content),
  )
    .replace(TEST_AS_IMPLEMENTATION_CONSTRAINT_RE, ' ')
    .replace(TEST_DISCUSSION_RE, ' ');
  const validationIntentPrompt = advisoryActionQuestion
    ? stripAdvisoryActionQuestionPhrases(validationPrompt)
    : validationPrompt;
  const validationText = maskTaskTargetPaths(validationIntentPrompt, taskContract.inputs);
  const healthRepairCompileRequested = validationHealthRepairRequested
    && /(?:build|compile|构建|编译)/i.test(prompt);
  const healthRepairTestRequested = validationHealthRepairRequested
    && !healthRepairCompileRequested;
  const validationRequested = !artifactPathQuery
    && !destructiveIntent
    && (VALIDATION_RE.test(validationText) || healthRepairRequested);
  const positiveValidationText = maskTaskTargetPaths(
    stripOperationalRunProhibitionPhrases(validationIntentPrompt),
    taskContract.inputs,
  );
  const compileRequested = !artifactPathQuery && (COMPILE_RE.test(positiveValidationText) || healthRepairCompileRequested);
  const stdoutRequested = !artifactPathQuery && STDOUT_RE.test(validationText) && !OUTPUT_ARTIFACT_RE.test(validationText);
  const runProhibited = !artifactPathQuery && hasOperationalRunProhibition(validationText);
  const testRequested = !runProhibited
    && !artifactPathQuery
    && (TEST_RE.test(positiveValidationText) || EXPLICIT_TEST_COMMAND_RE.test(validationIntentPrompt) || healthRepairTestRequested);
  const runRequested = !runProhibited
    && !artifactPathQuery
    && (RUN_RE.test(positiveValidationText)
      || stdoutRequested
      || testRequested
      || projectHealthRepairRequested
      || runtimeErrorRepairRequested
      || userSymptomRepairRequested);
  const fileCheckRequested = fileArtifact
    && (validationRequested
      || taskContract.verificationContract.requireArtifactReadback
      || explicitNonCodeFileWrite);
  const readTargets = resolveTaskReadTargets(prompt);
  const readActionRequested = READ_REQUEST_RE.test(prompt);
  const noRunInspectionTargets = taskContract.inputs.filter(target => ![
    ...requestedMutationTargets,
    ...taskContract.deliverableTargets,
  ].some(writeTarget => isSameTaskPath(writeTarget, target)));
  const effectiveReadTargets = [...new Set([
    ...readTargets,
    ...(validationRequested && runProhibited ? noRunInspectionTargets : []),
    ...(readActionRequested && readTargets.length === 0 && REVIEW_READ_FALLBACK_RE.test(prompt)
      ? taskContract.inputs
      : []),
  ])];
  const noRunValidationInspection = validationRequested
    && runProhibited
    && !compileRequested
    && !runRequested
    && !testRequested
    && !fileCheckRequested
    && effectiveReadTargets.length > 0;
  const readRequested = !artifactPathQuery
    && (readActionRequested || noRunValidationInspection)
    && effectiveReadTargets.length > 0;
  const readContentRequested = readRequested && READ_CONTENT_RE.test(prompt);
  const rawFormalProjectRequired = requiresFormalProjectQualityFromTaskContract(taskContract, prompt);
  const readOnlyIntent = (READ_ONLY_RE.test(prompt)
      || advisoryActionQuestion
      || readRequested
      || noRunValidationInspection
      || (prohibited && !compileRequested && !runRequested && !testRequested))
    && !mutationRequested;
  const formalProjectRequired = rawFormalProjectRequired && !readOnlyIntent && !standaloneCode;
  let scope: TaskSemanticScope = formalProjectRequired || (
    (taskContract.taskShapes.includes('existing-project') || existingProjectCodeDelivery) && !standaloneCode
  )
    ? 'existing-project'
    : standaloneCode
      ? 'standalone'
      : mutationRequested || validationRequested
        ? 'unknown'
      : 'none';
  let kind = resolveKind({
    readOnly: readOnlyIntent,
    standaloneCode,
    existingProjectCode: existingProjectCodeDelivery || (
      sourceChange && taskContract.taskShapes.includes('existing-project')
    ),
    formalProjectRequired,
    fileArtifact,
    validationRequested,
    destructive: destructiveIntent,
    mutationRequested,
  });
  let signals = [
    standaloneCode ? 'standalone-code' : '',
    isolatedSourceArtifact ? 'isolated-source-artifact' : '',
    explicitSourceFileWrite ? 'explicit-source-file-target' : '',
    explicitNonCodeFileWrite ? 'explicit-file-artifact-target' : '',
    existingProjectCodeDelivery ? 'existing-project-code-delivery' : '',
    advisoryActionQuestion ? 'advisory-action-question' : '',
    artifactPathQuery ? 'artifact-path-query' : '',
    hasScopedOtherFileProhibition ? 'scoped-other-file-prohibition' : '',
    hasScopedFormalSourceProhibition ? 'scoped-formal-source-prohibition' : '',
    hasScopedHistoricalRequirementProhibition ? 'scoped-historical-requirement-prohibition' : '',
    hasScopedTargetWriteBoundary ? 'scoped-target-write-boundary' : '',
    hasScopedVersionControlProhibition ? 'scoped-version-control-prohibition' : '',
    hasScopedWriteObjectProhibition ? 'scoped-write-object-prohibition' : '',
    hasScopedPathProhibition ? 'scoped-path-prohibition' : '',
    formalProjectRequired ? 'formal-project-quality-required' : '',
    validationHealthRepairRequested ? 'conditional-repair-on-failure' : '',
    validationHealthRepairRequested ? 'validation-repair-request' : '',
    validationHealthRepairRequested ? 'validation-health-repair-request' : '',
    projectHealthRepairRequested ? 'conditional-repair-on-failure' : '',
    projectHealthRepairRequested ? 'project-health-repair-request' : '',
    runtimeErrorRepairRequested ? 'conditional-repair-on-failure' : '',
    runtimeErrorRepairRequested ? 'runtime-error-repair-request' : '',
    userSymptomRepairRequested ? 'conditional-repair-on-failure' : '',
    userSymptomRepairRequested ? 'user-symptom-repair-request' : '',
    runRequested ? 'run-requested' : '',
    testRequested ? 'test-requested' : '',
    stdoutRequested ? 'stdout-requested' : '',
    fileCheckRequested ? 'file-check-requested' : '',
  ].filter(Boolean);
  let mutation = {
    requested: mutationRequested,
    prohibited,
    sourceChange,
    fileArtifact,
    targets: mutationRequested ? requestedMutationTargets : [],
  };
  const validation = {
    requested: validationRequested,
    compileRequested,
    runRequested,
    testRequested,
    runProhibited,
    stdoutRequested,
    fileCheckRequested,
  };
  let intent = buildLocalIntentContract(prompt, {
    kind,
    scope,
    mutation,
    validation,
    semanticSignals: signals,
  });
  if (shouldPromoteUnscopedEditMutation(intent, mutation)) {
    mutation = {
      requested: true,
      prohibited: false,
      sourceChange: true,
      fileArtifact: false,
      targets: mutation.targets.length > 0
        ? mutation.targets
        : taskContract.inputs.filter(isSourcePath),
    };
    scope = 'existing-project';
    kind = 'existing-project-code';
    signals = [...new Set([...signals, 'semantic-edit-mutation-inferred'])];
    intent = buildLocalIntentContract(prompt, {
      kind,
      scope,
      mutation,
      validation,
      semanticSignals: signals,
    });
  }
  const read = {
    requested: readRequested,
    contentRequested: readContentRequested,
    targets: readRequested ? effectiveReadTargets : [],
  };
  const semanticTaskContract = normalizeTaskContractForSemanticContract(taskContract, {
    mutation,
    validation,
    preserveDeferredSourceChange: intent.mode === 'plan' && !mutation.prohibited,
  });
  const contracts = buildTaskSemanticObligationContracts({
    taskContract: semanticTaskContract,
    kind,
    scope,
    mutation,
    read,
    validation,
    quality: { formalProjectRequired },
    externalEffect: intent.context.externalEffect,
    destructive: kind === 'destructive',
  });

  return {
    version: 'devseek.task-semantic-contract/v3',
    prompt,
    taskContract: semanticTaskContract,
    kind,
    scope,
    mutation,
    read,
    validation,
    quality: {
      formalProjectRequired,
    },
    ...contracts,
    context: {
      revision: {
        strategy: 'initial',
        inheritedFields: [],
      },
      projectInstructions: {
        status: 'none',
        content: '',
        fingerprint: 'none',
        sources: [],
        diagnostics: [],
      },
    },
    intent,
    signals,
  };
}

function normalizeTaskContractForSemanticContract(
  taskContract: TaskContract,
  input: {
    mutation: TaskSemanticContract['mutation'];
    validation: TaskSemanticContract['validation'];
    preserveDeferredSourceChange: boolean;
  },
): TaskContract {
  const deliverables = taskContract.deliverables.filter(deliverable => {
    if (deliverable === 'source-change') return input.mutation.sourceChange || input.preserveDeferredSourceChange;
    if (deliverable === 'report') return input.mutation.fileArtifact;
    if (deliverable === 'verification-result') return shouldRequireValidationResult(input.validation);
    return true;
  }) as TaskContract['deliverables'];
  if ((input.mutation.sourceChange || input.preserveDeferredSourceChange) && !deliverables.includes('source-change')) {
    deliverables.push('source-change');
  }
  if (input.mutation.fileArtifact && !deliverables.includes('report')) {
    deliverables.push('report');
  }
  if (shouldRequireValidationResult(input.validation) && !deliverables.includes('verification-result')) {
    deliverables.push('verification-result');
  }

  const verificationContract = {
    ...taskContract.verificationContract,
    requireSourceClaimGrounding: input.mutation.sourceChange
      ? taskContract.verificationContract.requireSourceClaimGrounding
      : false,
    requiredSourcePaths: input.mutation.sourceChange
      ? [...taskContract.verificationContract.requiredSourcePaths]
      : [],
    requireArtifactReadback: input.mutation.fileArtifact
      ? taskContract.verificationContract.requireArtifactReadback
      : false,
    exactArtifactRequested: input.mutation.fileArtifact
      ? taskContract.verificationContract.exactArtifactRequested
      : false,
    exactArtifact: input.mutation.fileArtifact
      ? taskContract.verificationContract.exactArtifact
      : undefined,
    maxWrittenFiles: input.mutation.requested
      ? taskContract.verificationContract.maxWrittenFiles
      : undefined,
  };

  return {
    ...taskContract,
    deliverableTargets: input.mutation.requested ? [...taskContract.deliverableTargets] : [],
    deliverables,
    qualityObligations: taskContract.qualityObligations.filter(obligation => (
      input.mutation.sourceChange || !['source-evidence', 'modification-plan'].includes(obligation)
    )),
    verificationContract,
  };
}

const EXPLICIT_INPUT_WRITE_ACTION_RE = /(?:创建|新建|生成|编写|写入|写到|保存|输出|新增|添加|落盘|create|write|generate|save|output|add|touch)/i;

function resolveExplicitInputWriteTargets(prompt: string, inputs: readonly string[]): string[] {
  return [...new Set(inputs.filter(target => {
    if (!target || /[\\/]$/u.test(target)) return false;
    const match = new RegExp(escapeRegExp(target), 'i').exec(prompt);
    if (!match || match.index === undefined) return false;
    const clauseStart = findPreviousClauseBoundary(prompt, match.index);
    const beforeTarget = prompt.slice(clauseStart, match.index);
    return EXPLICIT_INPUT_WRITE_ACTION_RE.test(beforeTarget.slice(-96));
  }))];
}

function findPreviousClauseBoundary(text: string, index: number): number {
  return Math.max(
    text.lastIndexOf('\n', index),
    text.lastIndexOf('。', index),
    text.lastIndexOf('；', index),
    text.lastIndexOf(';', index),
    text.lastIndexOf('，', index),
    text.lastIndexOf(',', index),
  ) + 1;
}

export function requiresFormalProjectQuality(contract: TaskSemanticContract): boolean {
  return contract.quality.formalProjectRequired;
}

export function shouldRunCppValidationForContract(contract: TaskSemanticContract): boolean {
  return contract.validation.runRequested || (
    contract.scope === 'standalone'
    && contract.validation.stdoutRequested
    && !contract.validation.runProhibited
  );
}

export function shouldValidateNonCodeFilesForContract(contract: TaskSemanticContract): boolean {
  return contract.validation.fileCheckRequested || (
    contract.mutation.fileArtifact && contract.validation.requested
  );
}

function requiresFormalProjectQualityFromTaskContract(taskContract: TaskContract, prompt: string): boolean {
  const hasExplicitDocumentDelivery = taskContract.taskShapes.includes('documentation')
    && taskContract.deliverables.includes('report');
  const hasSourceAndDocumentDelivery = hasExplicitDocumentDelivery
    && taskContract.deliverables.includes('source-change');
  const hasProjectScaleQualityObligation = hasQualityObligation(taskContract, 'protocol-facts')
    || hasQualityObligation(taskContract, 'interface-contract')
    || hasQualityObligation(taskContract, 'project-communication-chain');

  return taskContract.taskShapes.includes('existing-project')
    && !taskContract.taskShapes.includes('standalone')
    && (hasSourceAndDocumentDelivery
      || hasProjectScaleQualityObligation
      || PROJECT_SCALE_QUALITY_RE.test(prompt));
}

function resolveKind(input: {
  readOnly: boolean;
  standaloneCode: boolean;
  existingProjectCode: boolean;
  formalProjectRequired: boolean;
  fileArtifact: boolean;
  validationRequested: boolean;
  destructive: boolean;
  mutationRequested: boolean;
}): TaskSemanticKind {
  if (input.destructive) return 'destructive';
  if (input.readOnly) return 'read-only';
  if (input.formalProjectRequired) return 'existing-project-code';
  if (input.standaloneCode) return 'standalone-code';
  if (input.existingProjectCode) return 'existing-project-code';
  if (input.fileArtifact) return 'file-artifact';
  if (input.validationRequested && !input.mutationRequested) return 'validation';
  return 'general';
}

function isSourcePath(pathValue: string): boolean {
  return isCodeArtifactPathValue(pathValue);
}

function isNonCodeArtifactPath(pathValue: string): boolean {
  return NON_CODE_ARTIFACT_RE.test(pathValue) && !isSourcePath(pathValue);
}

function shouldPromoteUnscopedEditMutation(
  intent: LocalIntentContract,
  mutation: TaskSemanticContract['mutation'],
): boolean {
  return !mutation.requested
    && !mutation.prohibited
    && intent.mode === 'edit'
    && intent.taskKind === 'existing-project-edit'
    && intent.context.externalEffect === 'none';
}

function stripSimpleFileContentPayload(text: string, content: string | undefined): string {
  const payload = String(content || '').trimEnd();
  if (!payload) return text;
  const index = text.indexOf(payload);
  if (index < 0) return text;
  return `${text.slice(0, index)} __FILE_CONTENT__ ${text.slice(index + payload.length)}`;
}

function maskTaskTargetPaths(text: string, paths: readonly string[]): string {
  let masked = text;
  for (const targetPath of [...new Set(paths)].sort((a, b) => b.length - a.length)) {
    if (!targetPath) continue;
    masked = masked.replace(new RegExp(escapeRegExp(targetPath), 'g'), ' ');
  }
  return masked;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clauseMentionsTaskPath(clause: string, target: string): boolean {
  const normalizedClause = clause.toLowerCase().replace(/[`'"“”]/g, '');
  const normalizedTarget = target.toLowerCase().replace(/^[.`'"“”]+|[`'"“”]+$/g, '');
  if (normalizedTarget.length < 3) return false;
  return normalizedClause.includes(normalizedTarget)
    || normalizedClause.includes(normalizedTarget.replace(/^\.\//, ''));
}

function isSameTaskPath(a: string, b: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/^[.`'"“”]+|[`'"“”]+$/g, '');
  const left = normalize(a);
  const right = normalize(b);
  return left.length >= 3 && (left === right || left.replace(/^\.\//, '') === right.replace(/^\.\//, ''));
}
