const NEGATED_REPAIR_CLAUSE_RE = /(?:不要|无需|无须|不需要|别|不得|禁止|不允许|不|do\s+not|don't|must\s+not|should\s+not|never|without)[^，,。；;\n]{0,28}(?:修复|修正|修改|改动|修|改|处理|解决|fix|repair|resolve|modify|change)/gi;

const RUN_ACTION = '(?:编译|构建|运行|执行|测试|验证|跑(?:一下|下|一遍|一次)?(?:测试)?|compile|build|run|execute|test|verify)';
const FAILURE_CONDITION = '(?:错误|报错|失败|不通过|挂了|fail(?:s|ed|ure)?|error|broken|red)';
const REPAIR_ACTION = '(?:修复|修正|修一下|改一下|处理|解决|搞定|fix(?:es|ed)?|repair|resolve)';
const CONDITIONAL_MARKER = '(?:如果|若|如有|有|when|if|on)';

const RUN_THEN_REPAIR_RE = new RegExp(
  `${RUN_ACTION}[\\s\\S]{0,80}${FAILURE_CONDITION}[\\s\\S]{0,60}${REPAIR_ACTION}`,
  'i',
);
const CONDITIONAL_RUN_REPAIR_RE = new RegExp(
  `${CONDITIONAL_MARKER}[\\s\\S]{0,40}${RUN_ACTION}[\\s\\S]{0,60}${FAILURE_CONDITION}[\\s\\S]{0,60}${REPAIR_ACTION}`,
  'i',
);
const RUN_REPAIR_ANY_FAILURE_RE = new RegExp(
  `${RUN_ACTION}[\\s\\S]{0,80}${REPAIR_ACTION}[\\s\\S]{0,60}${FAILURE_CONDITION}`,
  'i',
);

export function stripNegatedRepairClauses(text: string): string {
  return String(text || '').replace(NEGATED_REPAIR_CLAUSE_RE, ' ');
}

export function hasRunToRepairIntent(text: string): boolean {
  const positive = stripNegatedRepairClauses(text).trim();
  if (!positive) return false;
  return RUN_THEN_REPAIR_RE.test(positive)
    || CONDITIONAL_RUN_REPAIR_RE.test(positive)
    || RUN_REPAIR_ANY_FAILURE_RE.test(positive);
}
