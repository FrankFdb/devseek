const ADVISORY_PLAN_RE = /(?:(?:给出|提供|输出|列出|制定|梳理).{0,40}(?:建议|对策|检讨|方案|计划|任务|task|步骤|清单)|(?:建议|对策|检讨).{0,30}(?:分析|方案|计划|任务|task)|(?:从|站在).{0,24}(?:角度|视角).{0,24}(?:给出|输出|列出).{0,20}(?:task|任务|建议|对策))/i;
const DIRECT_IMPLEMENTATION_RE = /(?:(?:直接|现在|马上|开始).{0,12}(?:修改|改造|实现|新增|添加|重构|落地|执行)|(?:并|然后|同时|再|最后).{0,8}(?:实现|修改|新增|添加|重构|落地|执行)|(?:修改|新增|添加|重构|改造|实现).{0,8}(?:代码|文件))/i;
const DEFERRED_IMPLEMENTATION_RE = /(?:(?:当前|现在|暂时|先).{0,10}(?:不准备|不打算|不需要|不要|暂不|先不).{0,24}(?:修改|实现|落地|改代码|使用原来|采用原来|写代码)|(?:准备|打算).{0,18}(?:重新做|重做|按.{0,8}需求).{0,24}(?:分析|建议|对策|方案|计划|任务|task))/i;

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
