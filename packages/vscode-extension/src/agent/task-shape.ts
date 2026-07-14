import {
  isDeliverableWriteRequest,
  isScopedNoChangeWithDeliverableWriteRequest,
} from '../intent/advisory-patterns';
import { hasStandaloneCodeGenerationIntent } from './task-contract';

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
  const standaloneLikely = (STANDALONE_RE.test(text) || hasStandaloneCodeGenerationIntent(text))
    && !existingProjectLikely;
  const validationLikely = VALIDATION_RE.test(text);
  const failureRepairLikely = FAILURE_RE.test(text);
  const hasScopedDeliverableWrite = isScopedNoChangeWithDeliverableWriteRequest(text);
  const hasWriteIntent = (WRITE_INTENT_RE.test(text) || isDeliverableWriteRequest(text))
    && (!NEGATED_WRITE_INTENT_RE.test(text) || hasScopedDeliverableWrite);
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
      '- 开始执行前的 manage_todo_list 必须按软件工程阶段组织：项目调查 → 设计/接口与原代码修改清单 → 代码实现 → 编译/测试/QualityGate 验证；不能只用一个“完成整个需求”的粗任务。',
      '- 若用户要求文档或通过 docs 交付，按任务需要拆成正式可读成果物：源项目事实矩阵/调查证据、对端接口文档、原有代码修改清单、实现设计/实施说明、验证说明；可以合并为总文档，但每个交付主题必须有独立标题、证据和路径。',
      '- 设计阶段必须形成可追溯的源项目事实矩阵，写明文件路径、类/函数/常量、关键数值、topic/命令号、协议字段和复用方式；不能用泛泛的“参考某模块”替代调查事实。',
      '- 任何协议数值、topic、payload_type、命令号、字段名、分片大小、超时、重试次数都必须来自 read_file/grep_search/run_terminal 的源代码或接口文档证据；不知道时继续调查或明确列为开放风险，不能编造默认值。',
      '- 涉及主控、平台、遥控器或通讯接口时，必须补齐面向对端的接口文档：方向、承载通道、消息类型、JSON/schema 字段、必填/可选、枚举值、分片/超时/重试/幂等/错误码、版本兼容、request JSON 示例和 response JSON 示例；示例必须使用标准 Markdown 三反引号代码块，例如 ```json，不能使用单反引号伪代码块。',
      '- 涉及“参考某模块通讯方式”时，必须像 Claude Code/Codex 一样从参考模块反向追踪真实通讯链路，并扩大到全项目搜索入口/出口：uart*_tx/rx_main、TunnelTransport/分片传输、MAVLink tunnel、HDStringPublisher/Subscriber、topic/payload_type/命令号、路由和调度调用点；不能只在用户给出的目录内自洽实现。',
      '- 涉及代码落地时，必须列出原有代码修改清单：文件、函数/类、改动内容、原因、风险和验证方式；仿真/验证产物应隔离在独立输出目录中，文件名保持正式可读。',
      '- 涉及自闭环验证但产物隔离在测试目录、无法直接编译正式工程时，至少创建可审计的验证钩子或验证脚本，并在结论中区分“静态审计通过”和“项目级编译/运行未覆盖”的剩余风险。',
      '- 设计和实现都要说明并使用这些锚点；不要创建脱离主流程的孤岛模块、样例 main 或只为自洽而存在的小测试程序。',
      '- 如果还不知道应接入哪个既有模块或方法，继续读取/搜索项目上下文，不能直接写代码。',
    );
  } else if (classification.shape === 'standalone-project') {
    lines.push(
      '- 可以自建目录、入口和运行方式，但仍需提供可运行/可验证证据。',
      '- 简单程序优先直接创建最小源码、编译/运行并核对用户要求的输出。',
      '- 不要套用正式项目集成门禁；除非用户同时提供既有项目、模块或源码锚点。',
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
