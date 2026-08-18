const NEGATED_WRITE_ACTION_RE = /(?:当前不准备|先不准备|不准备|先不要|暂不|不要|不得|禁止|不允许|无需|无须|不需要|别|勿|请勿)\s*(?:再|去|直接|继续|允许|需要|应该|可以|可)?\s*(?:创建|新建|生成|编写|写|写入|写到|保存|输出|新增|添加|修改|改|更新|修复|修正|补全|完善|重构|改造|替换|重命名|改名|移动|移到|挪到|挪动|复制|拷贝|追加|插入|翻译|总结|摘要|概括|提取|接入|封装|拆分|实现|交付|应用|套用|采纳|落地|改动|动|触碰|碰|覆盖|删除)\s*(.*)$/i;
const ENGLISH_NEGATED_WRITE_ACTION_RE = /(?:do\s+not|don't|must\s+not|should\s+not|never|without)\s+(?:create|write|generate|save|add|update|modify|change|edit|fix|repair|implement|refactor|replace|rename|move|copy|append|insert|deliver|apply|land|touch|overwrite|delete)\s*(.*)$/i;
const BROAD_WRITE_OBJECT_RE = /^(?:(?:任何|所有|全部|整个|一切|当前|这个|本次|工作区|项目|原有|现有|已有|既有|the|these|those)\s*)?(?:文件|代码|源码|内容|实现|改动|修改|变更|项目|工作区|东西|它|这些|workspace|project|files?|code|source\s+code|implementation|changes?|patch(?:es)?|it|them|this|these|those)?(?:\s*(?:文件|代码|源码|内容|实现|改动|修改|变更|files?|code|implementation|changes?|patch(?:es)?))?(?:\s+yet)?\s*$/i;

/**
 * A negative write clause can narrow a mutating request without revoking the
 * whole task. This boundary recognizes explicitly named objects while keeping
 * broad or object-free prohibitions fail-closed.
 */
export function isNamedWriteObjectProhibition(
  clause: string,
  hasPositiveMutationContext: boolean,
): boolean {
  if (!hasPositiveMutationContext) return false;
  const normalized = String(clause || '').trim().replace(/^[-*]\s*/, '');
  const match = NEGATED_WRITE_ACTION_RE.exec(normalized)
    ?? ENGLISH_NEGATED_WRITE_ACTION_RE.exec(normalized);
  if (!match) return false;
  const object = String(match[1] || '')
    .replace(/[.!。！？?]+$/, '')
    .trim();
  return object.length > 0 && !BROAD_WRITE_OBJECT_RE.test(object);
}
