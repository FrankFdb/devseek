export type AgentTaskShape =
  | 'existing-project'
  | 'standalone-project'
  | 'read-only-analysis'
  | 'validation-repair'
  | 'general';

export interface AgentTaskShapeClassification {
  shape: AgentTaskShape;
  existingProjectLikely: boolean;
  standaloneLikely: boolean;
  readOnlyLikely: boolean;
  validationLikely: boolean;
}

const EXISTING_PROJECT_RE = /(?:既有|现有|原来|原项目|大项目|正式项目|生产项目|主控|平台|遥控器|模块|接口文档|参考.+模块|创建于\s*[:：]?\s*\/|\/src\/|src\/|CMakeLists\.txt|Makefile|工程|代码库)/i;
const STANDALONE_RE = /(?:独立(?:的)?(?:编程)?任务|独立项目|新建项目|从零|练习|demo|样例|原型|小工具|scratch|standalone)/i;
const READ_ONLY_RE = /(?:只读|不(?:准备|要|需要)修改|当前不准备|仅(?:分析|设计|建议|检查)|给出(?:建议|对策|task)|对策检讨|通过\s*md\s*文档提供|文档提供|分析.+建议)/i;
const WRITE_INTENT_RE = /(?:实现代码|代码实现|落地实现|修改|创建|新建|新增|添加|删除|重构|修复|写入|生成.+文件|implement|create|modify|write|fix|refactor)/i;
const NEGATED_WRITE_INTENT_RE = /(?:不(?:准备|要|需要|执行|做|进行)(?:[^。；;，,\n]{0,12})?(?:修改|创建|新建|新增|添加|删除|重构|修复|写入|实现|落地)|当前不准备(?:[^。；;，,\n]{0,12})?(?:修改|创建|新建|新增|添加|删除|重构|修复|写入|实现|落地))/i;
const VALIDATION_RE = /(?:日志|失败|报错|编译|运行|测试|验证|重试|回归|QualityGate|replay|compile|build|test|run|error|failed)/i;
const FAILURE_RE = /(?:日志|失败|报错|重试|回归|QualityGate|replay|error|failed)/i;

export function classifyAgentTaskShape(userPrompt: string): AgentTaskShapeClassification {
  const text = String(userPrompt || '');
  const existingProjectLikely = EXISTING_PROJECT_RE.test(text);
  const standaloneLikely = STANDALONE_RE.test(text) && !existingProjectLikely;
  const validationLikely = VALIDATION_RE.test(text);
  const failureRepairLikely = FAILURE_RE.test(text);
  const hasWriteIntent = WRITE_INTENT_RE.test(text) && !NEGATED_WRITE_INTENT_RE.test(text);
  const readOnlyLikely = READ_ONLY_RE.test(text) && !hasWriteIntent;

  let shape: AgentTaskShape = 'general';
  if (failureRepairLikely) {
    shape = 'validation-repair';
  } else if (readOnlyLikely) {
    shape = 'read-only-analysis';
  } else if (existingProjectLikely) {
    shape = 'existing-project';
  } else if (standaloneLikely) {
    shape = 'standalone-project';
  }

  return {
    shape,
    existingProjectLikely,
    standaloneLikely,
    readOnlyLikely,
    validationLikely,
  };
}

export function buildTaskShapeGuidancePrompt(userPrompt: string): string {
  const classification = classifyAgentTaskShape(userPrompt);
  const shapeLabel: Record<AgentTaskShape, string> = {
    'existing-project': '既有大项目/正式项目内实现',
    'standalone-project': '独立新项目/原型/练习',
    'read-only-analysis': '只读分析/设计/文档',
    'validation-repair': '验证/修复/续作',
    general: '通用编程任务',
  };
  const lines = [
    '【任务形态判定】',
    `- 初判：${shapeLabel[classification.shape]}。`,
  ];

  if (classification.shape === 'existing-project') {
    lines.push(
      '- 必须先收集既有工程集成锚点：主入口/调度链路、线程或事件模型、消息/协议、既有数据结构、配置、日志/错误处理、构建和测试入口。',
      '- 设计和实现都要说明并使用这些锚点；不要创建脱离主流程的孤岛模块、样例 main 或只为自洽而存在的小测试程序。',
      '- 如果还不知道应接入哪个既有模块或方法，继续读取/搜索项目上下文，不能直接写代码。',
    );
  } else if (classification.shape === 'standalone-project') {
    lines.push(
      '- 可以自建目录、入口和运行方式，但仍需提供可运行/可验证证据。',
    );
  } else if (classification.shape === 'read-only-analysis') {
    lines.push(
      '- 只输出分析、设计或文档交付；不要把建议清单当成要立即执行的修改任务。',
    );
  } else if (classification.shape === 'validation-repair') {
    lines.push(
      '- 先读取日志、失败输出和最近变更，定位根因后再修复；不能把旧失败证据覆盖成成功。',
    );
  }

  return lines.join('\n');
}
