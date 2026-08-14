import { hasExplicitWorkspacePath } from '../workspace/path-patterns';

const ADVISORY_PLAN_RE = /(?:(?:给出|提供|输出|列出|制定|梳理).{0,40}(?:建议|对策|检讨|方案|计划|思路|任务|task|步骤|清单)|(?:建议|对策|检讨|思路).{0,30}(?:分析|方案|计划|任务|task|修复|修改|重构)|(?:从|站在).{0,24}(?:角度|视角).{0,24}(?:给出|输出|列出).{0,20}(?:task|任务|建议|对策)|(?:suggest|recommend|propose|list|outline|draft).{0,60}(?:ways?|options?|recommendations?|plan|steps?|approach|how\s+to|fix|repair|refactor)|(?:how\s+to|ways?\s+to).{0,40}(?:fix|repair|refactor|improve|change|update))/i;
const ADVISORY_ACTION_QUESTION_PATTERNS = [
  String.raw`\bwhat\s+(?:changes?|edits?|patch(?:es)?|fix(?:es)?|approach|steps?)\s+(?:are|is)\s+(?:needed|required|necessary)\s+(?:to\s+)?(?:fix|repair|implement|refactor|change|modify|update|improve|test|validate)\b`,
  String.raw`\bcan\s+you\s+(?:explain|describe|walk\s+me\s+through|tell\s+me)\s+(?:how\s+to\s+)?(?:fix|repair|implement|refactor|change|modify|update|test|run|execute|compile|build)\b`,
  String.raw`\b(?:how\s+(?:would|should)\s+(?:i|we|you)|how\s+to)\s+(?:fix|repair|implement|refactor|change|modify|update|test|run|execute|compile|build)\b`,
  String.raw`\bshould\s+(?:i|we)\s+(?:fix|repair|implement|refactor|change|modify|update|test|run|execute|compile|build)\b`,
  String.raw`\bwhat\s+would\s+you\s+(?:change|modify|fix|repair|refactor|implement|update)\b`,
  String.raw`\b(?:what|which)\s+command\s+should\s+(?:i|we)\s+(?:run|execute|use)\b`,
  String.raw`(?:(?:应该|该|要不要|是否应该|是否需要)[^，,。；;\n]{0,24}(?:怎么|如何)?|需要[^，,。；;\n]{0,12}(?:怎么|如何))[^，,。；;\n]{0,12}(?:修复|修改|改|实现|重构|测试|运行|执行|编译|构建)`,
  String.raw`(?:怎么|如何)[^，,。；;\n]{0,24}(?:修复|修改|改|实现|重构|测试|运行|执行|编译|构建)`,
  String.raw`(?:解释|说明)[^，,。；;\n]{0,24}(?:怎么|如何)[^，,。；;\n]{0,24}(?:修复|修改|改|实现|重构|测试|运行|执行|编译|构建)`,
  String.raw`(?:应该|该)[^，,。；;\n]{0,12}(?:运行|执行|测试|编译|构建)[^，,。；;\n]{0,30}(?:什么|哪个|哪条|命令)`,
] as const;
const ADVISORY_ACTION_QUESTION_SOURCE = ADVISORY_ACTION_QUESTION_PATTERNS.join('|');
const ADVISORY_ACTION_QUESTION_RE = new RegExp(ADVISORY_ACTION_QUESTION_SOURCE, 'i');
const ADVISORY_ACTION_QUESTION_PHRASE_RE = new RegExp(ADVISORY_ACTION_QUESTION_SOURCE, 'gi');
const DIRECT_ACTION_AFTER_ADVICE_RE = /(?:\b(?:then|also|now|please|go\s+ahead\s+and)\s+(?:fix|repair|implement|refactor|change|modify|update|run|execute|test|compile|build|apply|do|make)\b|\b(?:do|make|apply|implement)\s+(?:it|them|those|the\s+(?:changes?|fix(?:es)?|patch(?:es)?))\b|(?:然后|同时|现在|直接|请|帮我|麻烦)[^，,。；;\n]{0,12}(?:修复|修改|改|实现|重构|运行|执行|测试|编译|构建|应用|套用|落地))/i;
const DIRECT_IMPLEMENTATION_RE = /(?:(?:直接|现在|马上|开始).{0,12}(?:修改|改造|实现|新增|添加|重构|落地|执行|重命名|移动|复制|追加)|(?:并|然后|同时|再|最后).{0,8}(?:实现|修改|新增|添加|重构|落地|执行|重命名|移动|复制|追加)|(?:修改|新增|添加|重构|改造|实现|重命名|移动|复制|追加).{0,8}(?:代码|文件)|(?:代码实现|实现代码).{0,40}(?:创建于|放到|放入|输出到|写入到|保存到|目录|路径|\/)|(?:新增|创建|新建|生成|编写|写入|输出|保存|翻译|总结|摘要|概括|提取|重命名|移动|复制|追加|插入).{0,32}(?:代码|文件|文档|Markdown|md).{0,48}(?:创建于|放到|放入|输出到|写入到|保存到|目录|路径|\/))/i;
const DEFERRED_IMPLEMENTATION_RE = /(?:(?:当前|现在|暂时|先).{0,10}(?:不准备|不打算|不需要|不要|暂不|先不).{0,24}(?:修改|实现|落地|改代码|使用原来|采用原来|写代码)|(?:准备|打算).{0,18}(?:重新做|重做|按.{0,8}需求).{0,24}(?:分析|建议|对策|方案|计划|任务|task))/i;
const DELIVERABLE_WRITE_RE = /(?:(?:新增|创建|新建|生成|编写|写入|输出|保存|落盘|提供|整理|记录|汇总|重命名|改名|移动|移到|挪到|挪动|复制|拷贝|追加|插入).{0,36}(?:代码|文件|文档|Markdown|md|报告|src|docs)|(?:翻译|总结|摘要|概括|提取).{0,36}(?:成|为|到|至|入|保存|输出|写入).{0,48}(?:代码|文件|文档|Markdown|md|报告|目录|路径|src|docs|\/)|(?:代码实现|实现代码).{0,40}(?:创建于|放到|放入|输出到|写入到|保存到|目录|路径|\/)|(?:所有|全部|本次).{0,24}(?:新增|生成|输出|整理|记录|汇总|翻译|总结|摘要|概括|提取).{0,36}(?:文档|代码|文件).{0,48}(?:目录|路径|docs|src|\/)|(?:文档|代码|文件).{0,24}(?:放入|放到|输出到|写入到|保存到).{0,48}(?:目录|路径|docs|src|\/))/i;
const SCOPED_EXISTING_SOURCE_NO_CHANGE_RE = /(?:(?:不要|不用|无需|不需要|禁止|避免|不得|请勿|别).{0,16}(?:修改|改动|改|变更|覆盖|写入).{0,28}(?:正式源码|正式代码|正式源码目录|正式文件|原有代码|原代码|既有代码|既有文件|任何源码|所有源码|全部源码|源码|source\s+code|原项目|主项目|生产源码|生产代码)|(?:不修改|不改动|不覆盖).{0,28}(?:正式源码|正式代码|正式源码目录|正式文件|原有代码|原代码|既有代码|既有文件|任何源码|所有源码|全部源码|源码|source\s+code|原项目|主项目|生产源码|生产代码)|(?:do\s+not|don't|must\s+not|without|avoid).{0,32}(?:modify|change|touch|overwrite|write).{0,32}(?:source(?:\s+(?:code|files?))?|production\s+code|existing\s+code|original\s+code))/i;
const SCOPED_HISTORICAL_REQUIREMENT_NO_WRITE_RE = /(?:(?:不要|不用|无需|不需要|禁止|避免|不得|请勿|别).{0,16}(?:创建|新建|生成|编写|写|写入|输出|保存).{0,28}(?:旧要求|旧需求|旧版本|原要求|原需求|先前要求|之前要求|前面(?:曾)?说|历史要求|历史需求)|(?:do\s+not|don't|must\s+not|without|avoid).{0,32}(?:create|write|generate|save|output).{0,32}(?:old|previous|prior|earlier)\s+(?:requirement|request|version|file))/i;
const DELIVERABLE_PATH_ACTION_RE = /(?:新增|创建|新建|生成|编写|写入|输出|保存|落盘|放入|放到|写到|存到|整理|记录|汇总|翻译|总结|摘要|概括|提取|重命名|改名|移动|移到|挪到|挪动|复制|拷贝|追加|插入|create|generate|write|save|output|translate|summari[sz]e|rename|move|copy|append|insert)/gi;
const NEGATED_ACTION_PREFIX_RE = /(?:不|未|别|勿|无须|无需|不要|不能|不可|禁止|避免|不得|请勿|不需要|不允许|do\s+not|don't|must\s+not|without|avoid)(?:再|去|直接|继续|允许|需要|应该|可以|可)?\s*$/i;

export function isAdvisoryPlanningRequest(text: string | undefined): boolean {
  const value = text || '';
  return ADVISORY_PLAN_RE.test(value) || ADVISORY_ACTION_QUESTION_RE.test(value);
}

export function isDirectImplementationRequest(text: string | undefined): boolean {
  return DIRECT_IMPLEMENTATION_RE.test(text || '');
}

export function isDeferredImplementationRequest(text: string | undefined): boolean {
  return DEFERRED_IMPLEMENTATION_RE.test(text || '');
}

export function isReadOnlyAdvisoryPlanningRequest(text: string | undefined): boolean {
  const value = text || '';
  return isAdvisoryPlanningRequest(value)
    && (!isDirectImplementationRequest(value) || isDeferredImplementationRequest(value));
}

export function isAdvisoryActionQuestion(text: string | undefined): boolean {
  const value = text || '';
  if (!ADVISORY_ACTION_QUESTION_RE.test(value)) return false;
  const residual = stripAdvisoryActionQuestionPhrasesOnly(value);
  return (!isDirectImplementationRequest(value) || isDeferredImplementationRequest(value))
    && !DIRECT_ACTION_AFTER_ADVICE_RE.test(residual);
}

export function stripAdvisoryActionQuestionPhrases(text: string | undefined): string {
  const parts = String(text || '').split(/([。！？?；;\n])/);
  return parts.map(part => (
    ADVISORY_ACTION_QUESTION_RE.test(part)
      ? ' '
      : stripAdvisoryActionQuestionPhrasesOnly(part)
  )).join('');
}

function stripAdvisoryActionQuestionPhrasesOnly(text: string): string {
  return text.replace(ADVISORY_ACTION_QUESTION_PHRASE_RE, ' ');
}

export function isDeliverableWriteRequest(text: string | undefined): boolean {
  const value = text || '';
  return isExplicitDeliverablePathWriteRequest(value) || DELIVERABLE_WRITE_RE.test(value);
}

/** Distinguishes a requested output artifact from a read-only constraint on source files. */
export function isExplicitDeliverablePathWriteRequest(text: string | undefined): boolean {
  const clauses = String(text || '').split(/[\n。！？；;]/);
  return clauses.some((clause) => {
    if (!hasExplicitWorkspacePath(clause)) return false;
    DELIVERABLE_PATH_ACTION_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DELIVERABLE_PATH_ACTION_RE.exec(clause)) !== null) {
      const prefix = clause.slice(Math.max(0, match.index - 24), match.index);
      if (!NEGATED_ACTION_PREFIX_RE.test(prefix)) return true;
    }
    return false;
  });
}

export function isScopedNoChangeWithDeliverableWriteRequest(text: string | undefined): boolean {
  const value = text || '';
  return (SCOPED_EXISTING_SOURCE_NO_CHANGE_RE.test(value)
    || SCOPED_HISTORICAL_REQUIREMENT_NO_WRITE_RE.test(value))
    && (isDeliverableWriteRequest(value) || isDirectImplementationRequest(value));
}
