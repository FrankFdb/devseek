export type TaskShape =
  | 'existing-project'
  | 'standalone'
  | 'inspection'
  | 'documentation'
  | 'verification'
  | 'repair'
  | 'resume'
  | 'destructive';

export type QualityObligation =
  | 'source-evidence'
  | 'protocol-facts'
  | 'interface-contract'
  | 'modification-plan'
  | 'project-communication-chain'
  | 'validation';

export interface TaskContract {
  taskShapes: TaskShape[];
  objectives: string[];
  inputs: string[];
  deliverables: Array<'report' | 'source-change' | 'verification-result'>;
  constraints: string[];
  qualityObligations: QualityObligation[];
}

const PATH_RE = /(?:^|[\s`'"(])((?:\/|\.\/|\.\.\/)[\w.@+~/-]+(?:\.[\w-]+)?)/g;
const DOCUMENT_RE = /(?:文档|报告|说明|设计|方案|markdown|\.md\b|document|report)/i;
const INSPECTION_RE = /(?:读取|提取|检查|审计|分析|列出|查看|只读|read|extract|inspect|audit|analy[sz]e)/i;
const CHANGE_RE = /(?:修复|修改|实现|新增|添加|重构|集成|落地|fix|modify|implement|add|refactor)/i;
const STANDALONE_RE = /(?:独立(?:项目|工具|程序|脚本)|standalone|从零|new\s+(?:project|tool))/i;
const PROTOCOL_RE = /(?:协议|schema|request|response|消息字段|命令号|topic|MAVLink|tunnel|串口|通讯方式|通信方式|protocol)/i;
const INTERFACE_RE = /(?:接口文档|接口设计|交互接口|API\b|request.{0,40}response|schema)/i;
const COMMUNICATION_CHAIN_RE = /(?:通信链路|通讯链路|收发链路|端到端链路|主控.{0,100}(?:平台|遥控器)|(?:平台|遥控器).{0,100}主控|(?:参考|复用|对齐).{0,80}(?:通讯|通信|通道|传输|tunnel|MAVLink)|project.?wide communication)/i;
const VALIDATION_RE = /(?:测试|验证|编译|运行|回归|test|verify|validation|compile|build)/i;
const DESTRUCTIVE_RE = /(?:删除|清空|覆盖|重置|drop|delete|remove|reset)/i;
const NO_SOURCE_CHANGE_RE = /(?:不要|禁止|无需|不允许|不得).{0,24}(?:修改|改动).{0,12}(?:源码|代码|文件)|(?:do not|don't|must not).{0,24}(?:modify|change).{0,12}(?:source|code|files?)/i;

/** Provider-independent interpretation of what this task actually requires. */
export function buildTaskContract(promptText: string): TaskContract {
  const prompt = String(promptText || '');
  const documentation = DOCUMENT_RE.test(prompt);
  const inspection = INSPECTION_RE.test(prompt);
  const sourceChange = CHANGE_RE.test(prompt)
    && !NO_SOURCE_CHANGE_RE.test(prompt)
    && (!documentation || /(?:(?:修改|改动|新增|重构|修复).{0,20}(?:源码|代码|文件)|代码实现|实现代码|落地实现|fix|modify|implement|refactor)/i.test(prompt));
  const standalone = STANDALONE_RE.test(prompt);
  const protocol = PROTOCOL_RE.test(prompt);
  const interfaceContract = INTERFACE_RE.test(prompt);
  const communicationChain = COMMUNICATION_CHAIN_RE.test(prompt);
  const explicitModificationPlan = /(?:原有代码修改清单|代码修改清单|修改点清单|existing.?code modification plan)/i.test(prompt);
  const hasSourceInput = /(?:\/src\/|\.(?:c|cc|cpp|h|hpp|ts|tsx|js|py|json|ya?ml|toml)\b)/i.test(prompt);
  const extractsSourceFacts = /(?:提取|列出|核对|读取).{0,40}(?:常量|数值|配置|字段|版本|路径|值)|(?:extract|list|verify|read).{0,40}(?:constant|value|config|field|version)/i.test(prompt);
  const shapes = new Set<TaskShape>();
  if (standalone) shapes.add('standalone');
  else if (sourceChange || /(?:既有|现有|原项目|代码库|工程|\/src\/)/i.test(prompt)) shapes.add('existing-project');
  if (inspection) shapes.add('inspection');
  if (documentation) shapes.add('documentation');
  if (sourceChange) shapes.add('repair');
  if (DESTRUCTIVE_RE.test(prompt)) shapes.add('destructive');

  const obligations = new Set<QualityObligation>();
  if (sourceChange || extractsSourceFacts || (inspection && hasSourceInput && protocol)) obligations.add('source-evidence');
  if (protocol) obligations.add('protocol-facts');
  if (interfaceContract) obligations.add('interface-contract');
  if ((sourceChange && !standalone) || explicitModificationPlan) obligations.add('modification-plan');
  if (communicationChain) obligations.add('project-communication-chain');
  if (VALIDATION_RE.test(prompt) && sourceChange) obligations.add('validation');

  const inputs: string[] = [];
  for (const match of prompt.matchAll(PATH_RE)) inputs.push(match[1]);
  return {
    taskShapes: [...shapes],
    objectives: [prompt.trim()].filter(Boolean),
    inputs: [...new Set(inputs)],
    deliverables: [
      ...(documentation ? ['report' as const] : []),
      ...(sourceChange ? ['source-change' as const] : []),
      ...(VALIDATION_RE.test(prompt) ? ['verification-result' as const] : []),
    ],
    constraints: NO_SOURCE_CHANGE_RE.test(prompt) ? ['no-source-change'] : [],
    qualityObligations: [...obligations],
  };
}

export function hasQualityObligation(contract: TaskContract, obligation: QualityObligation): boolean {
  return contract.qualityObligations.includes(obligation);
}
