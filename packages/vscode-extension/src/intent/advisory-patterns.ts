import { hasExplicitWorkspacePath } from '../workspace/path-patterns';

const ADVISORY_PLAN_RE = /(?:(?:给出|提供|输出|列出|制定|梳理).{0,40}(?:建议|对策|检讨|方案|计划|任务|task|步骤|清单)|(?:建议|对策|检讨).{0,30}(?:分析|方案|计划|任务|task)|(?:从|站在).{0,24}(?:角度|视角).{0,24}(?:给出|输出|列出).{0,20}(?:task|任务|建议|对策))/i;
const DIRECT_IMPLEMENTATION_RE = /(?:(?:直接|现在|马上|开始).{0,12}(?:修改|改造|实现|新增|添加|重构|落地|执行)|(?:并|然后|同时|再|最后).{0,8}(?:实现|修改|新增|添加|重构|落地|执行)|(?:修改|新增|添加|重构|改造|实现).{0,8}(?:代码|文件)|(?:代码实现|实现代码).{0,40}(?:创建于|放到|放入|输出到|写入到|保存到|目录|路径|\/)|(?:新增|创建|新建|生成|编写|写入|输出|保存).{0,32}(?:代码|文件|文档|Markdown|md).{0,48}(?:创建于|放到|放入|输出到|写入到|保存到|目录|路径|\/))/i;
const DEFERRED_IMPLEMENTATION_RE = /(?:(?:当前|现在|暂时|先).{0,10}(?:不准备|不打算|不需要|不要|暂不|先不).{0,24}(?:修改|实现|落地|改代码|使用原来|采用原来|写代码)|(?:准备|打算).{0,18}(?:重新做|重做|按.{0,8}需求).{0,24}(?:分析|建议|对策|方案|计划|任务|task))/i;
const DELIVERABLE_WRITE_RE = /(?:(?:新增|创建|新建|生成|编写|写入|输出|保存|落盘|提供).{0,36}(?:代码|文件|文档|Markdown|md|报告|src|docs)|(?:代码实现|实现代码).{0,40}(?:创建于|放到|放入|输出到|写入到|保存到|目录|路径|\/)|(?:所有|全部|本次).{0,24}(?:新增|生成|输出).{0,36}(?:文档|代码|文件).{0,48}(?:目录|路径|docs|src|\/)|(?:文档|代码|文件).{0,24}(?:放入|放到|输出到|写入到|保存到).{0,48}(?:目录|路径|docs|src|\/))/i;
const SCOPED_EXISTING_SOURCE_NO_CHANGE_RE = /(?:(?:不要|不用|无需|不需要|禁止|避免|不得|请勿|别).{0,16}(?:修改|改动|改|变更|覆盖|写入).{0,28}(?:正式源码|正式代码|正式源码目录|正式文件|原有代码|原代码|既有代码|既有文件|原项目|主项目|生产源码|生产代码)|(?:不修改|不改动|不覆盖).{0,28}(?:正式源码|正式代码|正式源码目录|正式文件|原有代码|原代码|既有代码|既有文件|原项目|主项目|生产源码|生产代码))/i;
const DELIVERABLE_PATH_ACTION_RE = /(?:新增|创建|新建|生成|编写|写入|输出|保存|落盘|放入|放到|写到|存到|create|generate|write|save|output)/gi;
const NEGATED_ACTION_PREFIX_RE = /(?:不|未|别|勿|无须|无需|不要|不能|不可|禁止|避免|不得|请勿|不需要|不允许|do\s+not|don't|must\s+not|without|avoid)(?:再|去|直接|继续|允许|需要|应该|可以|可)?\s*$/i;

export function isAdvisoryPlanningRequest(text: string | undefined): boolean {
  return ADVISORY_PLAN_RE.test(text || '');
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
  return SCOPED_EXISTING_SOURCE_NO_CHANGE_RE.test(value)
    && (isDeliverableWriteRequest(value) || isDirectImplementationRequest(value));
}
