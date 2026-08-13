const NEGATED_REPAIR_CLAUSE_RE = /(?:不要|无需|无须|不需要|别|不得|禁止|不允许|不|do\s+not|don't|must\s+not|should\s+not|never|without)[^，,。；;\n]{0,28}(?:修复|修正|修改|改动|修|改|处理|解决|恢复|修好|弄好|搞定|fix|repair|resolve|modify|change|restore|recover|stabili[sz]e|clean|unbreak)/gi;

const RUN_ACTION = '(?:编译|构建|运行|执行|测试|验证|跑(?:一下|下|一遍|一次)?(?:测试)?|compile|build|run|execute|test|verify)';
const VALIDATION_SUBJECT = '(?:CI|ci|checks?|test(?:s|\\s+suite)?|suite|build|compile|pipeline|workflow|job|lint|typecheck|e2e|测试|单元测试|用例|套件|构建|编译|检查|流水线)';
const FAILURE_CONDITION = '(?:错误|报错|失败|不通过|不过|没过|挂了|红了|fail(?:s|ed|ure|ing)?|not\\s+passing|error|broken|red)';
const HEALTH_GOAL = '(?:通过|过掉|跑通|变绿|绿了|green|passing|pass(?:es)?|clean|healthy)';
const REPAIR_ACTION = '(?:修复|修正|修一下|修到|改一下|处理|解决|搞定|修好|恢复|过掉|跑通|变绿|fix(?:es|ed)?|repair|resolve|unbreak)';
const MAKE_HEALTHY_ACTION = '(?:让|把|帮(?:我|忙)?|修到|改到|恢复|搞到|弄到|make|get|turn|bring|restore)';
const CONDITIONAL_MARKER = '(?:如果|若|如有|有|when|if|on)';
const PROJECT_HEALTH_SUBJECT = '(?:app|application|project|repo(?:sitory)?|codebase|site|website|page|screen|view|route|flow|workflow|login\\s+flow|checkout\\s+flow|service|server|endpoint|api|feature|component|module|program|ui|项目|仓库|代码库|应用|程序|站点|网站|页面|界面|视图|路由|流程|工作流|登录流程|支付流程|服务|服务器|接口|功能|组件|模块)';
const PROJECT_FAILURE_CONDITION = "(?:坏了|出问题|有问题|不可用|不能用|无法使用|打不开|跑不起来|起不来|启动不了|启动失败|崩溃|闪退|异常|报错|失败|挂了|挂掉|不稳定|退化|回归|broken|not\\s+working|doesn(?:'|\\u2019)?t\\s+work|won(?:'|\\u2019)?t\\s+work|will\\s+not\\s+work|not\\s+starting|won(?:'|\\u2019)?t\\s+start|will\\s+not\\s+start|crash(?:es|ed|ing)?|regress(?:ed|ion|ing)?|unstable|unusable|down|failing|error(?:ing)?|faulty)";
const PROJECT_HEALTH_GOAL = '(?:可用|能用|正常|恢复|恢复可用|跑起来|启动起来|稳定|不崩|\\bwork(?:ing)?\\b|\\brun(?:ning)?\\b|\\bstart(?:ing)?\\b|\\busable\\b|\\bstable\\b|\\bhealthy\\b|\\bnormal\\b|\\bback\\s+up\\b|\\bup\\s+again\\b)';
const PROJECT_DIRECT_REPAIR_ACTION = '(?:处理一下|处理|解决|搞定|修好|修复|修正|恢复|弄好|clean\\s+it\\s+up|clean\\s+up|fix(?:es|ed)?|repair|resolve|restore|recover|stabili[sz]e|unbreak)';
const PROJECT_REPAIR_ACTION = `(?:${PROJECT_DIRECT_REPAIR_ACTION}|帮(?:我|忙)?|请|麻烦|make|get|bring)`;
const PROJECT_DIAGNOSTIC_FAILURE = '(?:red\\s+squiggles?|squiggles?|diagnostics?|type\\s+errors?|lint\\s+errors?|编译红线|红线|诊断|类型错误|lint\\s*错误)';

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
const VALIDATION_FAILURE_REPAIR_RE = new RegExp(
  `(?:${VALIDATION_SUBJECT}[\\s\\S]{0,50}${FAILURE_CONDITION}[\\s\\S]{0,80}${REPAIR_ACTION}`
    + `|${REPAIR_ACTION}[\\s\\S]{0,60}${FAILURE_CONDITION}[\\s\\S]{0,50}${VALIDATION_SUBJECT}`
    + `|${FAILURE_CONDITION}[\\s\\S]{0,50}${VALIDATION_SUBJECT}[\\s\\S]{0,80}${REPAIR_ACTION})`,
  'i',
);
const VALIDATION_HEALTH_GOAL_RE = new RegExp(
  `(?:${MAKE_HEALTHY_ACTION}[\\s\\S]{0,50}${VALIDATION_SUBJECT}[\\s\\S]{0,60}${HEALTH_GOAL}`
    + `|${VALIDATION_SUBJECT}[\\s\\S]{0,60}${MAKE_HEALTHY_ACTION}[\\s\\S]{0,50}${HEALTH_GOAL}`
    + `|${VALIDATION_SUBJECT}[\\s\\S]{0,50}${FAILURE_CONDITION}[\\s\\S]{0,80}${HEALTH_GOAL})`,
  'i',
);
const PROJECT_FAILURE_REPAIR_RE = new RegExp(
  `(?:${PROJECT_HEALTH_SUBJECT}[\\s\\S]{0,70}${PROJECT_FAILURE_CONDITION}[\\s\\S]{0,90}${PROJECT_DIRECT_REPAIR_ACTION}`
    + `|${PROJECT_FAILURE_CONDITION}[\\s\\S]{0,70}${PROJECT_HEALTH_SUBJECT}[\\s\\S]{0,90}${PROJECT_DIRECT_REPAIR_ACTION}`
    + `|${PROJECT_REPAIR_ACTION}[\\s\\S]{0,70}${PROJECT_HEALTH_SUBJECT}[\\s\\S]{0,90}${PROJECT_HEALTH_GOAL})`,
  'i',
);
const PROJECT_FAILURE_HEALTH_GOAL_RE = new RegExp(
  `(?:${PROJECT_HEALTH_SUBJECT}[\\s\\S]{0,70}${PROJECT_FAILURE_CONDITION}[\\s\\S]{0,90}${MAKE_HEALTHY_ACTION}[\\s\\S]{0,60}${PROJECT_HEALTH_GOAL}`
    + `|${PROJECT_FAILURE_CONDITION}[\\s\\S]{0,70}${PROJECT_HEALTH_SUBJECT}[\\s\\S]{0,90}${MAKE_HEALTHY_ACTION}[\\s\\S]{0,60}${PROJECT_HEALTH_GOAL})`,
  'i',
);
const PROJECT_DIAGNOSTIC_REPAIR_RE = new RegExp(
  `${PROJECT_DIAGNOSTIC_FAILURE}[\\s\\S]{0,80}${PROJECT_REPAIR_ACTION}`,
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

export function hasValidationHealthRepairIntent(text: string): boolean {
  const positive = stripNegatedRepairClauses(text).trim();
  if (!positive) return false;
  return hasRunToRepairIntent(positive)
    || VALIDATION_FAILURE_REPAIR_RE.test(positive)
    || VALIDATION_HEALTH_GOAL_RE.test(positive);
}

export function hasProjectHealthRepairIntent(text: string): boolean {
  const positive = stripNegatedRepairClauses(text).trim();
  if (!positive) return false;
  return PROJECT_FAILURE_REPAIR_RE.test(positive)
    || PROJECT_FAILURE_HEALTH_GOAL_RE.test(positive)
    || PROJECT_DIAGNOSTIC_REPAIR_RE.test(positive);
}
