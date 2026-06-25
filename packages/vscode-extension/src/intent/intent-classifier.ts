import { IntentClassification, ToolKind } from './intent-types';
import { hasExplicitWorkspaceFilePath } from '../workspace/path-patterns';

const EXPLICIT_NO_CHANGE_RE = /(不要修改|无需修改|不要改|别改|只讨论|仅讨论|只分析|仅分析|不要落地|先不要改|不需要代码|不要apply|不做变更|just\s+(?:chat|talk|discuss|explain)|only\s+(?:explain|discuss|answer))/i;

const GREETING_ONLY_RE = /^(?:hi|hello|ello|hey|你好|您好|嗨|哈喽|早上好|上午好|下午好|晚上好|在吗|在不在|辛苦了)[\s!.。！？?]*$/i;

const GREETING_PREFIX_RE = /^(?:hi|hello|hey|你好|您好|嗨|哈喽)[,，\s]+/i;

const EDIT_RE = /(修复|修正|修改|改一下|改成|实现|编写|写一个|写个|创建|新建|生成|新增|添加|补全|完善|重构|改造|替换|优化|升级|接入|封装|拆分|fix|modify|change|implement|create|write|add|update|refactor|generate)/i;

const DESTRUCTIVE_RE = /(删除|清空|覆盖|重置|移除|删掉|干掉|drop|delete|remove|reset|overwrite|truncate)/i;

const RUN_RE = /(运行|执行|编译|构建|测试|跑一下|验证|启动|调试|run|execute|compile|build|test|debug|start)/i;

const FOLLOW_UP_RUN_RE = /(?:能(?:否)?(?:执行|运行|编译|构建|测试|验证)|看(?:一下|下|看)?(?:执行|运行|编译|构建|测试|验证)?结果|看到(?:执行|运行|编译|构建|测试|验证)?结果|(?:给(?:我)?|输出|展示|显示|提供|返回).{0,12}(?:执行|运行|编译|构建|测试|验证)?结果|(?:执行|运行|编译|构建|测试|验证|跑)(?:一下|下|一遍|一次)?(?:看看|看结果)|(?:执行|运行|编译|构建|测试|验证|跑).{0,8}结果|(?:show|see|view).{0,20}(?:result|output)|(?:can|could).{0,20}(?:run|execute|compile|build|test|verify))/i;

const ARTIFACT_PATH_QUERY_RE = /(?:(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物).{0,18}(?:在哪|哪里|路径|位置|path|where)|(?:在哪|哪里|路径|位置|path|where).{0,18}(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物))/i;

const PLAN_RE = /(方案|计划|设计|架构|怎么改|如何改|重构计划|实施步骤|roadmap|plan|design|architecture|approach)/i;

const EXPLICIT_PLAN_RE = /(方案|计划|架构|怎么改|如何改|重构计划|实施步骤|roadmap|plan|architecture|approach)/i;

const INSPECT_RE = /(分析|解释|说明|查看|检查|排查|定位|阅读|梳理|总结|review|inspect|analy[sz]e|explain|check|diagnose|read|summari[sz]e)/i;

const QA_RE = /(什么是|为什么|怎么理解|区别|原理|概念|介绍一下|能介绍|请介绍|如何使用|怎么用|what\s+is|why|how\s+to|difference|explain\s+the\s+concept)/i;

const CODE_CONTEXT_RE = /(代码|文件|项目|函数|类|模块|报错|错误|日志|异常|栈|依赖|配置|接口|组件|脚本|code|file|project|function|class|module|error|log|exception|stack|config|component|script)/i;

const READ_ONLY_TOOLS: ToolKind[] = ['read', 'search', 'diagnostics', 'network'];
const PLAN_TOOLS: ToolKind[] = [...READ_ONLY_TOOLS, 'plan', 'memory'];
const EDIT_TOOLS: ToolKind[] = [...PLAN_TOOLS, 'edit', 'terminal'];
const RUN_TOOLS: ToolKind[] = [...READ_ONLY_TOOLS, 'plan', 'memory', 'terminal'];
const ALL_AGENT_TOOLS: ToolKind[] = [...EDIT_TOOLS, 'vscode', 'vscode-command', 'mcp'];

function baseDecision(
  mode: IntentClassification['mode'],
  confidence: number,
  score: number,
  signals: string[],
  reason: string,
  allowedToolKinds: ToolKind[],
  blockers: string[] = [],
  requiresConfirmation = false,
): IntentClassification {
  return {
    mode,
    confidence,
    score,
    signals,
    blockers,
    reason,
    requiresConfirmation,
    allowedToolKinds,
  };
}

export function classifyIntent(prompt: string): IntentClassification {
  const text = (prompt || '').trim();
  if (!text) {
    return baseDecision('smalltalk', 0, 0, [], 'empty-prompt', [], ['empty-prompt']);
  }

  const withoutGreeting = text.replace(GREETING_PREFIX_RE, '').trim();
  const hasPath = hasExplicitWorkspaceFilePath(text);
  const hasCodeContext = CODE_CONTEXT_RE.test(text) || hasPath;
  const isFollowUpRunRequest = !hasPath && FOLLOW_UP_RUN_RE.test(text);

  if (GREETING_ONLY_RE.test(text)) {
    return baseDecision('smalltalk', 0.95, -4, ['greeting-only'], 'greeting-only', []);
  }

  if (EXPLICIT_NO_CHANGE_RE.test(text)) {
    const isReadOnlyPlanning = EXPLICIT_PLAN_RE.test(text) && hasCodeContext;
    const mode = isReadOnlyPlanning
      ? 'plan'
      : hasCodeContext || INSPECT_RE.test(text)
        ? 'inspect'
        : 'qa';
    const signals = [
      mode === 'plan'
        ? 'read-only-planning'
        : mode === 'inspect'
          ? 'read-only-inspection'
          : 'explicit-no-change',
    ];
    if (hasPath) signals.push('explicit-file-path');
    return baseDecision(
      mode,
      0.9,
      -3,
      signals,
      'explicit-no-change',
      mode === 'plan' ? PLAN_TOOLS : mode === 'inspect' ? READ_ONLY_TOOLS : [],
      ['explicit-no-change'],
    );
  }

  if (DESTRUCTIVE_RE.test(text)) {
    return baseDecision(
      'destructive',
      0.9,
      6,
      ['destructive-operation'],
      'destructive-operation',
      ALL_AGENT_TOOLS,
      [],
      true,
    );
  }

  if (EXPLICIT_PLAN_RE.test(text) && hasCodeContext) {
    return baseDecision(
      'plan',
      hasPath ? 0.86 : 0.75,
      hasPath ? 3 : 2,
      hasPath ? ['planning-request', 'explicit-file-path'] : ['planning-request'],
      hasPath ? 'plan-with-file-path' : 'planning-request',
      PLAN_TOOLS,
    );
  }

  if (ARTIFACT_PATH_QUERY_RE.test(text)) {
    const signals = ['artifact-path-query'];
    if (hasPath) signals.push('explicit-file-path');
    return baseDecision(
      'inspect',
      hasPath ? 0.88 : 0.82,
      hasPath ? 3 : 2,
      signals,
      hasPath ? 'artifact-path-query-with-file-path' : 'artifact-path-query',
      READ_ONLY_TOOLS,
    );
  }

  if (EDIT_RE.test(text)) {
    return baseDecision(
      'edit',
      hasPath ? 0.9 : 0.82,
      hasPath ? 5 : 4,
      hasPath ? ['edit-request', 'explicit-file-path'] : ['edit-request'],
      hasPath ? 'edit-with-file-path' : 'edit-request',
      EDIT_TOOLS,
    );
  }

  if (RUN_RE.test(text)) {
    const signals = ['run-request'];
    if (isFollowUpRunRequest) signals.push('follow-up-run-request');
    if (hasPath) signals.push('explicit-file-path');
    return baseDecision(
      'run',
      hasPath ? 0.86 : isFollowUpRunRequest ? 0.84 : 0.78,
      hasPath ? 4 : 3,
      signals,
      hasPath ? 'run-with-file-path' : isFollowUpRunRequest ? 'follow-up-run-request' : 'run-request',
      RUN_TOOLS,
    );
  }

  if (PLAN_RE.test(text) && hasCodeContext) {
    return baseDecision(
      'plan',
      hasPath ? 0.86 : 0.75,
      hasPath ? 3 : 2,
      hasPath ? ['planning-request', 'explicit-file-path'] : ['planning-request'],
      hasPath ? 'plan-with-file-path' : 'planning-request',
      PLAN_TOOLS,
    );
  }

  if (INSPECT_RE.test(text) && hasCodeContext) {
    return baseDecision(
      'inspect',
      hasPath ? 0.86 : 0.74,
      hasPath ? 3 : 2,
      hasPath ? ['inspection-request', 'explicit-file-path'] : ['inspection-request'],
      hasPath ? 'inspect-with-file-path' : 'inspection-request',
      READ_ONLY_TOOLS,
    );
  }

  if (QA_RE.test(withoutGreeting) || /[?？]\s*$/.test(text)) {
    return baseDecision('qa', 0.78, -2, ['question-answer'], 'question-answer', []);
  }

  return baseDecision('qa', 0.6, -1, ['default-chat'], 'default-chat', []);
}
