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
    plannerLine,
    `- 生产代码文件超过 ${CODE_FILE_REVIEW_LINE_LIMIT} 行必须先审计职责；超过 ${CODE_FILE_SPLIT_PLAN_LINE_LIMIT} 行必须优先制定拆分/迁移方案；超过 ${CODE_FILE_REFACTOR_PRIORITY_LINE_LIMIT} 行视为重构优先级。`,
    `- 普通函数目标控制在 ${FUNCTION_LINE_LIMIT} 行以内；复杂编排函数不得超过 ${COMPLEX_FUNCTION_LINE_LIMIT} 行。`,
    '- 修复问题时要修缺陷类别：审计同类入口、状态流、工具/协议边界、验证和 UI 展示路径；相同逻辑原则上只能有一份。',
    '- 除非用户明确要求单文件交付，否则不要生成超长单文件或超长函数；必要时拆分文件并说明边界。',
  ].join('\n');
}
