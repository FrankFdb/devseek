const DESTRUCTIVE_ACTION_RE = /(删除|清空|覆盖|重置|移除|删掉|干掉|drop|delete|remove|reset|overwrite|truncate)/gi;
const NEGATION_PREFIX_RE = /(?:不|未|尚未|没有|不要|不能|不可|禁止|避免|不得|请勿|无需|无须|不需要|不允许|do\s+not|don't|must\s+not|without|avoid).{0,16}$/i;
const COVERAGE_PREFIX_RE = /(?:测试|代码|分支|条件|路径|需求|场景|功能|风险|验证|证据|用例|范围|协议|接口|平台|环境).{0,12}$/i;
const COVERAGE_SUFFIX_RE = /^(?:率|范围|情况|不足|缺口|风险|场景|证据|用例|分析|检查)/i;
const CONTENT_DELETE_SUFFIX_RE = /^(?:[^，,。；;\n]{0,48}(?:里|中|内|里的|中的|行|内容|注释|字段|配置项|段落|语句|line|lines?|content|comment|field|statement))/i;

/** Canonical local safety detector for destructive workspace intent. */
export function hasDestructiveIntent(text: string): boolean {
  DESTRUCTIVE_ACTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DESTRUCTIVE_ACTION_RE.exec(text)) !== null) {
    const prefix = text.slice(Math.max(0, match.index - 24), match.index);
    const suffix = text.slice(match.index + match[0].length, match.index + match[0].length + 64);
    if (NEGATION_PREFIX_RE.test(prefix)) continue;
    if (match[0] === '覆盖' && isCoverageUsage(prefix, suffix)) continue;
    if (isContentDelete(match[0], suffix)) continue;
    return true;
  }
  return false;
}

function isCoverageUsage(prefix: string, suffix: string): boolean {
  return COVERAGE_PREFIX_RE.test(prefix) || COVERAGE_SUFFIX_RE.test(suffix);
}

function isContentDelete(action: string, suffix: string): boolean {
  return /^(?:删除|移除|删掉|delete|remove)$/i.test(action)
    && CONTENT_DELETE_SUFFIX_RE.test(suffix);
}
