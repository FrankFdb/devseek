import { IntentClassification, ToolKind } from './intent-types';
import { hasExplicitWorkspacePath } from '../workspace/path-patterns';
import {
  isAdvisoryPlanningRequest,
  isDeferredImplementationRequest,
  isDirectImplementationRequest,
} from './advisory-patterns';

const EXPLICIT_NO_CHANGE_RE = /(不要修改|无需修改|不要改|别改|只讨论|仅讨论|只分析|仅分析|不要落地|先不要改|不需要代码|不要apply|不做变更|just\s+(?:chat|talk|discuss|explain)|only\s+(?:explain|discuss|answer))/i;

const GREETING_ONLY_RE = /^(?:hi|hello|ello|hey|你好|您好|嗨|哈喽|早上好|上午好|下午好|晚上好|在吗|在不在|辛苦了)[\s!.。！？?]*$/i;

const GREETING_PREFIX_RE = /^(?:hi|hello|hey|你好|您好|嗨|哈喽)[,，\s]+/i;

const EDIT_RE = /(修复|修正|修改|改一下|改成|改为|改用|换成|换为|调整为|实现|编写|写一个|写个|创建|新建|生成|新增|添加|补全|完善|重构|改造|替换|替换为|优化|升级|接入|封装|拆分|fix|modify|change|implement|create|write|add|update|refactor|generate)/i;

const DESTRUCTIVE_RE = /(删除|清空|覆盖|重置|移除|删掉|干掉|drop|delete|remove|reset|overwrite|truncate)/i;

const RUN_RE = /(运行|执行|编译|构建|测试|跑一下|验证|启动|调试|run|execute|compile|build|test|debug|start)/i;

const FOLLOW_UP_RUN_RE = /(?:能(?:否)?(?:执行|运行|编译|构建|测试|验证)|看(?:一下|下|看)?(?:执行|运行|编译|构建|测试|验证)?结果|看到(?:执行|运行|编译|构建|测试|验证)?结果|(?:给(?:我)?|输出|展示|显示|提供|返回).{0,12}(?:执行|运行|编译|构建|测试|验证)?结果|(?:执行|运行|编译|构建|测试|验证|跑)(?:一下|下|一遍|一次)?(?:看看|看结果)|(?:执行|运行|编译|构建|测试|验证|跑).{0,8}结果|(?:show|see|view).{0,20}(?:result|output)|(?:can|could).{0,20}(?:run|execute|compile|build|test|verify))/i;

const RUN_WITH_CONDITIONAL_REPAIR_RE = /(?:(?:编译|构建|运行|执行|测试|验证|compile|build|run|execute|test|verify).{0,40}(?:如果|若|如有|有|when|if).{0,30}(?:错误|报错|失败|error|fail).{0,30}(?:修复|修正|fix|repair)|(?:如果|若|如有|when|if).{0,30}(?:编译|构建|运行|执行|测试|验证|compile|build|run|execute|test|verify).{0,30}(?:错误|报错|失败|error|fail).{0,30}(?:修复|修正|fix|repair))/i;

const ARTIFACT_PATH_QUERY_RE = /(?:(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物).{0,18}(?:在哪|哪里|路径|位置|path|where)|(?:在哪|哪里|路径|位置|path|where).{0,18}(?:可执行文件|执行文件|二进制|binary|executable|build\s+artifact|构建产物))/i;

const PLAN_RE = /(方案|计划|设计|架构|怎么改|如何改|重构计划|实施步骤|roadmap|plan|design|architecture|approach)/i;

const EXPLICIT_PLAN_RE = /(方案|计划|架构|怎么改|如何改|重构计划|实施步骤|roadmap|plan|architecture|approach)/i;
const PLAN_WITH_IMPLEMENTATION_RE = /(?:并|然后|同时|再|最后|通过|落地|完成).{0,24}(?:代码实现|实现|修改|编写|创建|新增|添加|编译|构建|运行|执行|验证|测试|implement|modify|write|create|add|compile|build|run|execute|verify|test)/i;

const INSPECT_RE = /(分析|解释|说明|查看|检查|排查|定位|阅读|梳理|总结|review|inspect|analy[sz]e|explain|check|diagnose|read|summari[sz]e)/i;

const QA_RE = /(什么是|为什么|怎么理解|区别|原理|概念|介绍一下|能介绍|请介绍|如何使用|怎么用|what\s+is|why|how\s+to|difference|explain\s+the\s+concept)/i;

const CODE_CONTEXT_RE = /(代码|文件|项目|函数|类|模块|报错|错误|日志|异常|栈|依赖|配置|接口|组件|脚本|code|file|project|function|class|module|error|log|exception|stack|config|component|script)/i;

const INTERACTIVE_FEATURE_CONTEXT_RE = /(程序|应用|功能|界面|页面|窗口|按钮|控件|图形|形状|渲染|动画|鼠标|键盘|旋转|缩放|平移|选择|切换|显示|opengl|glut|webgl|three\.?js|canvas|viewer|renderer|ui|gui|feature|interaction|interactive|mouse|keyboard|rotate|rotation|zoom|pan|select|toggle|display|render|shape|geometry|control)/i;

const CAPABILITY_FEATURE_REQUEST_RE = /(?:(?:能|可以|可否|能否|能不能|是否可以|请|帮我|麻烦).{0,40}(?:提供|支持|加上|添加|新增|增加|实现|做成|改成|改为|改用|换成|换为|调整为|替换为|做到|具备|拥有).{0,40}(?:功能|能力|控制|操作|交互|显示|旋转|缩放|平移|选择|切换|独立|单独|feature|support|control|interaction|display|rotate|rotation|zoom|pan|select|toggle)|(?:不能|无法|没有|缺少|不支持).{0,40}(?:单独|独立|控制|操作|交互|显示|旋转|缩放|平移|选择|切换|support|control|rotate|rotation|select))/i;

const READ_ONLY_CAPABILITY_QUESTION_RE = /(什么是|为什么|什么原因|怎么理解|区别|介绍|解释|说明|原理|概念|文档|教程|示例|怎么用|如何使用|用法|what\s+is|why|how\s+to|explain|describe|introduction)/i;

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
  const hasPath = hasExplicitWorkspacePath(text);
  const hasInteractiveFeatureContext = INTERACTIVE_FEATURE_CONTEXT_RE.test(text);
  const hasCodeContext = CODE_CONTEXT_RE.test(text) || hasInteractiveFeatureContext || hasPath;
  const isFollowUpRunRequest = !hasPath && FOLLOW_UP_RUN_RE.test(text);
  const isCapabilityFeatureRequest = hasCodeContext
    && CAPABILITY_FEATURE_REQUEST_RE.test(text)
    && !READ_ONLY_CAPABILITY_QUESTION_RE.test(withoutGreeting);

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

  if (isAdvisoryPlanningRequest(text) && hasCodeContext && (!isDirectImplementationRequest(text) || isDeferredImplementationRequest(text))) {
    const signals = ['advisory-planning-request'];
    if (hasPath) signals.push('explicit-file-path');
    if (isDeferredImplementationRequest(text)) signals.push('deferred-implementation');
    return baseDecision(
      'plan',
      hasPath ? 0.9 : 0.8,
      hasPath ? 3 : 2,
      signals,
      hasPath ? 'advisory-plan-with-file-path' : 'advisory-planning-request',
      PLAN_TOOLS,
    );
  }

  if (EXPLICIT_PLAN_RE.test(text) && hasCodeContext && !PLAN_WITH_IMPLEMENTATION_RE.test(text)) {
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

  const isRunRequest = RUN_RE.test(text);
  const isConditionalRunRepairRequest = isRunRequest && RUN_WITH_CONDITIONAL_REPAIR_RE.test(text);
  if (isConditionalRunRepairRequest) {
    const signals = ['run-request', 'conditional-repair-on-failure'];
    if (isFollowUpRunRequest) signals.push('follow-up-run-request');
    if (hasPath) signals.push('explicit-file-path');
    return baseDecision(
      'run',
      hasPath ? 0.88 : 0.84,
      hasPath ? 4 : 3,
      signals,
      hasPath ? 'run-conditional-repair-with-file-path' : 'run-conditional-repair',
      RUN_TOOLS,
    );
  }

  const isDirectEditRequest = EDIT_RE.test(text);
  if (isDirectEditRequest || isCapabilityFeatureRequest) {
    const signals = isDirectEditRequest ? ['edit-request'] : ['capability-feature-request'];
    if (isDirectEditRequest && isCapabilityFeatureRequest) signals.push('capability-feature-request');
    if (hasInteractiveFeatureContext) signals.push('interactive-feature-context');
    if (hasPath) signals.push('explicit-file-path');
    return baseDecision(
      'edit',
      hasPath ? 0.9 : 0.82,
      hasPath ? 5 : 4,
      signals,
      hasPath
        ? 'edit-with-file-path'
        : isCapabilityFeatureRequest && !isDirectEditRequest
          ? 'capability-feature-request'
          : 'edit-request',
      EDIT_TOOLS,
    );
  }

  if (isRunRequest) {
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

  if (PLAN_RE.test(text) && hasCodeContext && !PLAN_WITH_IMPLEMENTATION_RE.test(text)) {
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
