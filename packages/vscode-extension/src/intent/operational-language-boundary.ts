export type ExternalEffectIntent = 'none' | 'question' | 'requested';

const UNAMBIGUOUS_EXTERNAL_EFFECT_RE = /(?:上线|部署|安装插件|安装扩展|提交(?:当前)?(?:修改|变更)|推送(?:当前)?(?:分支)|拉取(?:最新)?代码|安装\s*(?:依赖|npm\s*包|包)|\bdeploy\b|install\s+extension|git\s+(?:commit|push|pull|fetch|merge|rebase)|commit\s+(?:changes?|current)|push\s+(?:current\s+)?branch|npm\s+(?:install|i|add|ci)|pnpm\s+(?:install|i|add)|yarn\s+(?:install|add)|pip\s+install)/i;
const AMBIGUOUS_RELEASE_ACTION_RE = /(?:发布|\b(?:release|publish)\b)/i;
const RELEASE_TARGET_RE = /(?:版本|软件包|依赖包|npm\s*包|插件|扩展|应用|服务|网站|镜像|构建产物|制品|代码|当前修改|当前变更|生产环境|注册表|市场|\b(?:version|packages?|plugin|extension|app|service|site|image|artifact|changes?|code|production|registry|marketplace)\b)/i;
const DOMAIN_OPERATION_RE = /(?:事件|订阅|处理器|回调|消息|主题|发布快照|\b(?:event|subscription|subscriber|handler|callback|message|topic)\b|\b(?:publish|release)\s*\()/i;
const EXTERNAL_EFFECT_QUESTION_RE = /(?:如何|怎么|怎样|为什么|什么是|介绍|说明|方案|计划|\bhow\s+to\b|\bwhat\s+is\b|\bwhy\b|\bplan\b|\bdesign\b|\bapproach\b)/i;
const NEGATED_EXTERNAL_EFFECT_RE = /(?:不要|不得|禁止|不允许|无需|无须|不需要|别|勿|请勿)[^，,。；;\n]{0,28}(?:发布|上线|部署|安装|提交|推送|拉取)|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,36}(?:release|deploy|publish|install|commit|push|pull|fetch|merge|rebase)/i;
const BARE_RELEASE_IMPERATIVE_RE = /^(?:请|现在|立即|帮我|麻烦)?\s*(?:发布|release|publish)\s*(?:吧)?$/i;

const STRONG_RUN_PROHIBITION_RE = /(?:不要|不用|无需|无须|不需要|不必|不得|不准|不能|禁止|别|勿|请勿)[^，,。；;\n]{0,24}(?:运行|执行|启动|测试)|(?:do\s+not|don't|must\s+not|should\s+not|may\s+not|never|without)[^,.;\n]{0,32}\b(?:run|execute|start|test)(?:ing)?\b|\bno\s+tests?\b/i;
const WEAK_RUN_PROHIBITION_RE = /(?:不|未)(?:运行|执行|启动|测试)|\bnot\s+(?:run|executed?|started?|tested?)\b/i;
const DIRECT_WEAK_RUN_PROHIBITION_RE = /^(?:但|并且|同时|然后)?\s*(?:不|未)(?:运行|执行|启动|测试)(?:\s|$)/i;
const DOMAIN_EXECUTION_SUBJECT_RE = /(?:事件|订阅|处理器|回调|消息|发布|\b(?:event|subscription|subscriber|handler|callback|message|publish)\b)/i;
const OPERATIONAL_EXECUTION_TARGET_RE = /(?:命令|脚本|终端|编译|构建|测试套件|程序|项目|test\.sh|ctest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|\b(?:command|script|terminal|compile|build|test\s+suite|program|project)\b)/i;

/** Splits user intent at top-level prose boundaries used by action classifiers. */
export function splitOperationalClauses(text: string): string[] {
  return String(text || '')
    .split(/[\r\n，,。；;！？!?]+/u)
    .map(clause => clause.trim())
    .filter(Boolean);
}

/**
 * Classifies host-visible release/deploy actions without treating domain APIs
 * named publish/release as external effects.
 */
export function classifyExternalEffectIntent(text: string): ExternalEffectIntent {
  let questionSeen = false;
  for (const clause of splitOperationalClauses(text)) {
    if (NEGATED_EXTERNAL_EFFECT_RE.test(clause)) continue;
    const unambiguous = UNAMBIGUOUS_EXTERNAL_EFFECT_RE.test(clause);
    const ambiguousRelease = AMBIGUOUS_RELEASE_ACTION_RE.test(clause)
      && !DOMAIN_OPERATION_RE.test(clause)
      && (RELEASE_TARGET_RE.test(clause) || BARE_RELEASE_IMPERATIVE_RE.test(clause));
    if (!unambiguous && !ambiguousRelease) continue;
    if (EXTERNAL_EFFECT_QUESTION_RE.test(clause)) {
      questionSeen = true;
      continue;
    }
    return 'requested';
  }
  return questionSeen ? 'question' : 'none';
}

/**
 * Detects a request not to run host commands. Behavioral requirements saying
 * that a handler/subscription does not execute are deliberately outside this
 * boundary.
 */
export function hasOperationalRunProhibition(text: string): boolean {
  return splitOperationalClauses(text).some(clause => {
    const strong = STRONG_RUN_PROHIBITION_RE.test(clause);
    const weak = WEAK_RUN_PROHIBITION_RE.test(clause);
    if (!strong && !weak) return false;
    if (DOMAIN_EXECUTION_SUBJECT_RE.test(clause)
      && !OPERATIONAL_EXECUTION_TARGET_RE.test(clause)) {
      return false;
    }
    return strong
      || OPERATIONAL_EXECUTION_TARGET_RE.test(clause)
      || DIRECT_WEAK_RUN_PROHIBITION_RE.test(clause);
  });
}
