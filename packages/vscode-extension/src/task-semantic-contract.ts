import {
  buildTaskContract,
  hasQualityObligation,
  hasStandaloneCodeGenerationIntent,
  type TaskContract,
} from './agent/task-contract';

export type TaskSemanticScope = 'none' | 'standalone' | 'existing-project' | 'unknown';

export type TaskSemanticKind =
  | 'read-only'
  | 'standalone-code'
  | 'existing-project-code'
  | 'file-artifact'
  | 'validation'
  | 'destructive'
  | 'general';

export interface TaskSemanticContract {
  version: 'devseek.task-semantic-contract/v1';
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
  signals: string[];
}

const SOURCE_FILE_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|cs|php|rb|swift|kt|kts|scala|vue|svelte|sh|bash|zsh)$/i;
const NON_CODE_ARTIFACT_RE = /\.(?:md|markdown|txt|json|jsonc|ya?ml|toml|ini|csv|tsv|log|xml|html|css)$/i;
const WRITE_ACTION_RE = /(?:创建|新建|生成|编写|写一个|写个|写入|写到|保存|输出|新增|添加|修改|更新|修复|修正|补全|完善|重构|改造|替换|重命名|移动|复制|追加|插入|翻译|总结|摘要|概括|删除|移除|删掉|接入|封装|拆分|实现|交付|create|write|generate|save|add|update|modify|fix|repair|implement|refactor|replace|rename|move|copy|append|insert|translate|summari[sz]e|delete|remove|deliver)/i;
const EXISTING_IMPLEMENTATION_CONTEXT_RE = /(?:(?:现有|原有|已有|既有|原来|旧|当前)[^，,。；;\n]{0,10}(?:实现|代码|逻辑|模块|功能|implementation|code|logic)|(?:existing|current|old|previous)[^,.;\n]{0,16}(?:implementation|code|logic))/gi;
const ADVISORY_ACTION_CONTEXT_RE = /(?:(?:修改|修复|修正|补全|完善|重构|改造|替换|接入|封装|拆分|实现|交付|发布|上线|部署|modify|fix|repair|refactor|implement|deliver|release|deploy|publish)[^，,。；;\n]{0,80}(?:方案|计划|设计|思路|步骤|对策|建议|检讨|任务|清单|文档|角度|\broadmap\b|\bplan\b|\bdesign\b|\bapproach\b|\badvice\b)|(?:方案|计划|设计|思路|步骤|对策|建议|检讨|任务|清单|文档|角度|\broadmap\b|\bplan\b|\bdesign\b|\bapproach\b|\badvice\b)[^，,。；;\n]{0,80}(?:修改|修复|修正|补全|完善|重构|改造|替换|接入|封装|拆分|实现|交付|发布|上线|部署|modify|fix|repair|refactor|implement|deliver|release|deploy|publish))/gi;
const NO_WRITE_RE = /(?:当前不准备|先不准备|不准备|先不要|暂不|不要|不得|禁止|不允许|无需|无须|不需要|别)[^，,。；;\n]{0,24}(?:创建|新建|生成|编写|写|写入|写到|保存|输出|新增|添加|修改|更新|修复|修正|补全|完善|重构|改造|替换|重命名|移动|复制|追加|插入|翻译|总结|摘要|概括|提取|接入|封装|拆分|实现|交付|改动|触碰|覆盖|删除)|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,32}(?:create|write|generate|save|add|update|modify|fix|repair|implement|refactor|replace|rename|move|copy|append|insert|translate|summari[sz]e|deliver|touch|overwrite|delete)/i;
const NO_WRITE_CLAUSE_RE = /(?:当前不准备|先不准备|不准备|先不要|暂不|不要|不得|禁止|不允许|无需|无须|不需要|别)[^，,。；;\n]{0,24}(?:创建|新建|生成|编写|写|写入|写到|保存|输出|新增|添加|修改|更新|修复|修正|补全|完善|重构|改造|替换|重命名|移动|复制|追加|插入|翻译|总结|摘要|概括|提取|接入|封装|拆分|实现|交付|改动|触碰|覆盖|删除)|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,32}(?:create|write|generate|save|add|update|modify|fix|repair|implement|refactor|replace|rename|move|copy|append|insert|translate|summari[sz]e|deliver|touch|overwrite|delete)/gi;
const OTHER_FILE_SCOPE_RE = /(?:其他|其它|其余|用户)(?:的)?(?:文件|文档|源码|代码)|(?:other|unrelated|user)\s+files?/i;
const FORMAL_SOURCE_SCOPE_RE = /(?:正式|原有|现有|既有|生产|主线|原项目)[^，,。；;\n]{0,8}(?:源码|代码|源码目录|代码目录|source|code)|(?:formal|production|existing|original)\s+(?:source|code)/i;
const CODE_DELIVERY_RE = /(?:代码实现|实现代码|实现接口|交付代码|代码副本|新增或修改代码|新增代码|修改代码|落地实现|implement(?:ing)?\s+(?:code|interface)|code\s+delivery)/i;
const ARTIFACT_PATH_QUERY_RE = /(?:(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物).{0,18}(?:在哪里|在哪|哪里|路径|位置|path|where)|(?:在哪里|在哪|哪里|路径|位置|path|where).{0,18}(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物))/i;
const VALIDATION_RE = /(?:验证|测试|编译|构建|运行|执行|确认|检查|读回|重新读取|test|verify|compile|\bbuild\b(?!\s*(?:目录|文件夹|dir|directory))|run|execute|check|read\s*back)/i;
const COMPILE_RE = /(?:编译|构建|g\+\+|gcc|clang|cmake|make|\bcompile\b|\bbuild\b(?!\s*(?:目录|文件夹|dir|directory)))/i;
const RUN_RE = /(?:运行|执行|启动|跑一下|\b(?:run|execute|start)\b)/i;
const TEST_RE = /(?:测试|单元测试|test|ctest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|bun\s+test|go\s+test|cargo\s+test|unit\s+tests?)/i;
const STDOUT_RE = /(?:打印|输出|stdout|std::cout|\bcout\b|console\.log|print)/i;
const OUTPUT_ARTIFACT_RE = /(?:(?:输出|打印)[^，,。；;\n]{0,20}(?:文件|文档|报告|Markdown|md|目录|路径|清单|内容)|(?:文件|文档|报告|内容|最后一行|每行|一行)[^，,。；;\n]{0,24}(?:打印|输出|console\.log|print)|(?:output|print)[^,.;\n]{0,24}(?:file|document|report|markdown|content|line))/i;
const NO_RUN_RE = /(?:不(?:要|用|需|需要|必|得|准|能)?|禁止|别|勿|请勿|未)[^，,。；;\n]{0,24}(?:运行|执行|启动|测试)|(?:do\s+not|don't|without|no)\s+(?:run|execute|start|test)/i;
const NO_RUN_CLAUSE_RE = /(?:不(?:要|用|需|需要|必|得|准|能)?|禁止|别|勿|请勿|未)[^，,。；;\n]{0,32}(?:运行|执行|启动|测试)[^，,。；;\n]*|(?:do\s+not|don't|without|no)\s+[^,.;\n]*(?:run|execute|start|test)[^,.;\n]*/gi;
const READ_ONLY_RE = /(?:只读|仅分析|只分析|仅讨论|只讨论|当前不准备|不准备|先不要|暂不|不要落地|不需要代码|only\s+(?:explain|discuss|answer)|just\s+(?:chat|talk|discuss))/i;
const DESTRUCTIVE_RE = /(?:删除|清空|覆盖|重置|移除|删掉|drop|delete|remove|reset|overwrite|truncate)/i;
const NON_DESTRUCTIVE_CONTENT_DELETE_RE = /(?:删除|移除|删掉|delete|remove)[^，,。；;\n]{0,64}(?:里|中|内|里的|中的|行|内容|注释|字段|配置项|段落|语句|line|lines?|content|comment|field|statement)/i;
const DERIVED_ARTIFACT_OUTPUT_RE = /(?:(?:读取|读出|查看|参考|根据|基于|read|from|based\s+on)[^，,。；;\n]{0,100}(?:翻译|总结|摘要|概括|提取|生成|写入|写到|保存|输出|translate|summari[sz]e|extract|generate|write|save|output)[^，,。；;\n]{0,40}(?:成|为|到|至|入|\bto\b|\binto\b|\bas\b)|(?:翻译|总结|摘要|概括|提取|translate|summari[sz]e|extract)[^，,。；;\n]{0,80}(?:成|为|到|至|入|\bto\b|\binto\b|\bas\b))/i;

export function buildTaskSemanticContract(promptText: string): TaskSemanticContract {
  const prompt = String(promptText || '').trim();
  const taskContract = buildTaskContract(prompt);
  const sourceTargets = taskContract.inputs.filter(isSourcePath);
  const nonCodeTargets = taskContract.inputs.filter(isNonCodeArtifactPath);
  const sourceDeliverableTargets = taskContract.deliverableTargets.filter(isSourcePath);
  const positiveIntentText = prompt
    .replace(NO_WRITE_CLAUSE_RE, ' ')
    .replace(EXISTING_IMPLEMENTATION_CONTEXT_RE, ' ')
    .replace(ADVISORY_ACTION_CONTEXT_RE, ' ');
  const positiveWriteAction = WRITE_ACTION_RE.test(positiveIntentText)
    || DERIVED_ARTIFACT_OUTPUT_RE.test(positiveIntentText);
  const explicitSourceFileWrite = positiveWriteAction && sourceTargets.length > 0 && (
    sourceDeliverableTargets.length > 0
    || (taskContract.deliverableTargets.length === 0 && !taskContract.deliverables.includes('report'))
  );
  const explicitNonCodeFileWrite = positiveWriteAction && nonCodeTargets.length > 0;
  const hasScopedOtherFileProhibition = NO_WRITE_RE.test(prompt) && OTHER_FILE_SCOPE_RE.test(prompt);
  const hasScopedFormalSourceProhibition = NO_WRITE_RE.test(prompt) && FORMAL_SOURCE_SCOPE_RE.test(prompt);
  const hasScopedWriteProhibition = hasScopedOtherFileProhibition || hasScopedFormalSourceProhibition;
  const hasUnscopedNoWrite = NO_WRITE_RE.test(prompt) && !hasScopedWriteProhibition;
  const standaloneCodeRaw = taskContract.taskShapes.includes('standalone')
    || (hasStandaloneCodeGenerationIntent(prompt) && !taskContract.taskShapes.includes('existing-project'))
    || (explicitSourceFileWrite && !taskContract.taskShapes.includes('existing-project'));
  const standaloneCode = standaloneCodeRaw && !hasUnscopedNoWrite;
  const taskContractSourceChange = taskContract.deliverables.includes('source-change')
    && positiveWriteAction
    && !hasUnscopedNoWrite;
  const existingProjectCodeDelivery = taskContract.taskShapes.includes('existing-project')
    && CODE_DELIVERY_RE.test(positiveIntentText)
    && !hasUnscopedNoWrite;
  const sourceChange = taskContractSourceChange || explicitSourceFileWrite || standaloneCode || existingProjectCodeDelivery;
  const fileArtifact = (taskContract.deliverables.includes('report') && positiveWriteAction)
    || explicitNonCodeFileWrite;
  const prohibited = NO_WRITE_RE.test(prompt) && !hasScopedWriteProhibition && !sourceChange && !fileArtifact;
  const destructiveIntent = DESTRUCTIVE_RE.test(prompt)
    && !NON_DESTRUCTIVE_CONTENT_DELETE_RE.test(prompt)
    && !prohibited;
  const mutationRequested = (sourceChange || fileArtifact || taskContract.deliverableTargets.length > 0)
    && !prohibited;
  const artifactPathQuery = ARTIFACT_PATH_QUERY_RE.test(prompt);
  const validationText = maskTaskTargetPaths(prompt, taskContract.inputs);
  const validationRequested = !artifactPathQuery
    && !destructiveIntent
    && (VALIDATION_RE.test(validationText) || taskContract.deliverables.includes('verification-result'));
  const positiveValidationText = maskTaskTargetPaths(prompt.replace(NO_RUN_CLAUSE_RE, ' '), taskContract.inputs);
  const compileRequested = !artifactPathQuery && COMPILE_RE.test(positiveValidationText);
  const stdoutRequested = !artifactPathQuery && STDOUT_RE.test(validationText) && !OUTPUT_ARTIFACT_RE.test(validationText);
  const runProhibited = !artifactPathQuery && NO_RUN_RE.test(validationText);
  const testRequested = !runProhibited && !artifactPathQuery && TEST_RE.test(positiveValidationText);
  const runRequested = !runProhibited && !artifactPathQuery && (RUN_RE.test(positiveValidationText) || stdoutRequested || testRequested);
  const fileCheckRequested = fileArtifact
    && (validationRequested || taskContract.verificationContract.requireArtifactReadback || explicitNonCodeFileWrite);
  const formalProjectRequired = requiresFormalProjectQualityFromTaskContract(taskContract);
  const readOnlyIntent = (READ_ONLY_RE.test(prompt) || (prohibited && !validationRequested))
    && !mutationRequested;
  const scope: TaskSemanticScope = formalProjectRequired || (
    taskContract.taskShapes.includes('existing-project') && !standaloneCode
  )
    ? 'existing-project'
    : standaloneCode
      ? 'standalone'
      : mutationRequested || validationRequested
        ? 'unknown'
      : 'none';
  const kind = resolveKind({
    readOnly: readOnlyIntent,
    standaloneCode,
    formalProjectRequired,
    fileArtifact,
    validationRequested,
    destructive: destructiveIntent,
    mutationRequested,
  });
  const signals = [
    standaloneCode ? 'standalone-code' : '',
    explicitSourceFileWrite ? 'explicit-source-file-target' : '',
    explicitNonCodeFileWrite ? 'explicit-file-artifact-target' : '',
    existingProjectCodeDelivery ? 'existing-project-code-delivery' : '',
    artifactPathQuery ? 'artifact-path-query' : '',
    hasScopedOtherFileProhibition ? 'scoped-other-file-prohibition' : '',
    hasScopedFormalSourceProhibition ? 'scoped-formal-source-prohibition' : '',
    formalProjectRequired ? 'formal-project-quality-required' : '',
    runRequested ? 'run-requested' : '',
    testRequested ? 'test-requested' : '',
    stdoutRequested ? 'stdout-requested' : '',
    fileCheckRequested ? 'file-check-requested' : '',
  ].filter(Boolean);

  return {
    version: 'devseek.task-semantic-contract/v1',
    prompt,
    taskContract,
    kind,
    scope,
    mutation: {
      requested: mutationRequested,
      prohibited,
      sourceChange,
      fileArtifact,
      targets: buildMutationTargets({
        taskContractTargets: resolveSemanticMutationTargetHints({
          prompt,
          taskContractTargets: taskContract.deliverableTargets,
          nonCodeTargets,
          sourceChange,
        }),
        sourceTargets,
        nonCodeTargets,
        includeSourceTargets: sourceChange,
        includeNonCodeTargets: fileArtifact,
      }),
    },
    validation: {
      requested: validationRequested,
      compileRequested,
      runRequested,
      testRequested,
      runProhibited,
      stdoutRequested,
      fileCheckRequested,
    },
    quality: {
      formalProjectRequired,
    },
    signals,
  };
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

function requiresFormalProjectQualityFromTaskContract(taskContract: TaskContract): boolean {
  return taskContract.taskShapes.includes('existing-project')
    && !taskContract.taskShapes.includes('standalone')
    && taskContract.qualityObligations.length > 0
    && (
      hasQualityObligation(taskContract, 'source-evidence')
      || hasQualityObligation(taskContract, 'protocol-facts')
      || hasQualityObligation(taskContract, 'interface-contract')
      || hasQualityObligation(taskContract, 'modification-plan')
      || hasQualityObligation(taskContract, 'project-communication-chain')
      || hasQualityObligation(taskContract, 'validation')
    );
}

function resolveKind(input: {
  readOnly: boolean;
  standaloneCode: boolean;
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
  if (input.fileArtifact) return 'file-artifact';
  if (input.validationRequested && !input.mutationRequested) return 'validation';
  return 'general';
}

function isSourcePath(pathValue: string): boolean {
  return SOURCE_FILE_RE.test(pathValue);
}

function isNonCodeArtifactPath(pathValue: string): boolean {
  return NON_CODE_ARTIFACT_RE.test(pathValue) && !isSourcePath(pathValue);
}

function buildMutationTargets(input: {
  taskContractTargets: readonly string[];
  sourceTargets: readonly string[];
  nonCodeTargets: readonly string[];
  includeSourceTargets: boolean;
  includeNonCodeTargets: boolean;
}): string[] {
  const targetSet = new Set(input.taskContractTargets);
  if (input.includeSourceTargets) {
    for (const sourceTarget of input.sourceTargets) {
      if (input.taskContractTargets.length === 0 || input.taskContractTargets.includes(sourceTarget)) {
        targetSet.add(sourceTarget);
      }
    }
  }
  if (input.includeNonCodeTargets) {
    for (const nonCodeTarget of input.nonCodeTargets) {
      if (input.taskContractTargets.length === 0 || input.taskContractTargets.includes(nonCodeTarget)) {
        targetSet.add(nonCodeTarget);
      }
    }
  }
  return [...targetSet];
}

function resolveSemanticMutationTargetHints(input: {
  prompt: string;
  taskContractTargets: readonly string[];
  nonCodeTargets: readonly string[];
  sourceChange: boolean;
}): string[] {
  if (input.taskContractTargets.length > 0) return [...input.taskContractTargets];
  if (!input.sourceChange
    && input.nonCodeTargets.length > 1
    && DERIVED_ARTIFACT_OUTPUT_RE.test(input.prompt)) {
    return [input.nonCodeTargets[input.nonCodeTargets.length - 1]];
  }
  return [];
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
