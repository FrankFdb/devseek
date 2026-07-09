export const CODE_FILE_REVIEW_LINE_LIMIT = 1024;
export const CODE_FILE_SPLIT_PLAN_LINE_LIMIT = 2048;
export const CODE_FILE_REFACTOR_PRIORITY_LINE_LIMIT = 3000;
export const FUNCTION_LINE_LIMIT = 100;
export const COMPLEX_FUNCTION_LINE_LIMIT = 300;

export function buildEngineeringGuidelinesPrompt(role: 'agent' | 'planner' = 'agent'): string {
  const plannerLine = role === 'planner'
    ? '- 任务计划要优先拆分到职责清晰的小文件/模块；不要默认把所有实现塞进一个文件。'
    : '- 生成或修改代码时优先新增小型领域服务、纯函数和清晰模块边界；不要把新逻辑继续堆进大入口文件。';

  return [
    '【工程设计与代码规模约束】',
    '- 默认遵循 SOLID、DRY、KISS、单一职责、依赖倒置、接口隔离和迪米特法则。',
    '- 落代码前先判断任务形态：A. 既有大项目/正式项目内新增或修改；B. 独立新项目/原型/练习；C. 只读分析、设计或文档；D. 验证、修复或续作。',
    '- A 类任务必须先收集并复用既有工程锚点：模块边界、主入口/调度、线程或事件模型、消息/协议、数据结构、配置、日志/错误处理、构建和测试入口。',
    '- A 类任务的设计和代码必须嵌入既有主流程；禁止交付与原主控/平台/遥控器等整体架构脱节的孤岛模块、样例 main 或只为自洽而存在的小测试程序。',
    '- 如果 A 类任务缺少集成锚点，继续通过 list_dir/read_file/grep_search 收集上下文；不要提前写代码。',
    '- 只有 B 类任务才可以自建入口、目录和独立运行方式；C 类只输出分析/文档，不把建议清单当成待执行修改；D 类先复用历史日志、变更和失败证据定位根因。',
    plannerLine,
    `- 生产代码文件超过 ${CODE_FILE_REVIEW_LINE_LIMIT} 行必须先审计职责；超过 ${CODE_FILE_SPLIT_PLAN_LINE_LIMIT} 行必须优先制定拆分/迁移方案；超过 ${CODE_FILE_REFACTOR_PRIORITY_LINE_LIMIT} 行视为重构优先级。`,
    `- 普通函数目标控制在 ${FUNCTION_LINE_LIMIT} 行以内；复杂编排函数不得超过 ${COMPLEX_FUNCTION_LINE_LIMIT} 行。`,
    '- 修复问题时要修缺陷类别：审计同类入口、状态流、工具/协议边界、验证和 UI 展示路径；相同逻辑原则上只能有一份。',
    '- 除非用户明确要求单文件交付，否则不要生成超长单文件或超长函数；必要时拆分文件并说明边界。',
  ].join('\n');
}
