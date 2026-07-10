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
    '- A 类任务的设计文档必须包含可追溯的源项目事实矩阵：文件路径、类/函数/常量、关键数值、协议字段、topic/命令号、复用方式和证据来源；不能只写“参考某模块”。',
    '- A 类任务中的协议数值、topic、payload_type、命令号、字段名、分片大小、超时和重试次数必须来自源码或接口文档证据；不知道时继续调查或标为开放风险，不能编造默认值。',
    '- A 类任务涉及主控、平台、遥控器、通讯或接口时，必须给出接口交付文档：方向、承载通道、消息类型、JSON/schema 字段、必填/可选、枚举值、分片/超时/重试/幂等/错误码、版本兼容、request JSON 示例和 response JSON 示例；示例必须使用标准 Markdown 三反引号代码块，例如 ```json，不能使用单反引号伪代码块。',
    '- A 类任务涉及“参考既有通讯模块方式”时，必须先做项目级通讯链路追踪：从参考模块入口反查真实收发文件、uart*_tx/rx_main 或等价通道入口、TunnelTransport/分片组装、MAVLink tunnel、HDStringPublisher/Subscriber、topic/payload_type/命令号、路由/调度和主流程调用点；不能只在用户给出的目录内自认为实现。',
    '- A 类任务涉及新增或修改代码时，必须给出原有代码修改清单：目标文件、函数/类、改动内容、原因、风险、验证方式；测试或仿真产物应放入独立目录，文件名保持正式可读，不靠随机后缀避免冲突。',
    '- A 类任务涉及自闭环验证但产物隔离在测试目录、无法直接编译正式工程时，至少创建可审计的验证钩子或验证脚本，并在结论中区分“静态审计通过”和“项目级编译/运行未覆盖”的剩余风险。',
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
