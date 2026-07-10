export interface FormalProjectDocumentQuality {
  required: boolean;
  ok: boolean;
  requiresRemoteControllerInterface: boolean;
  requiresLicenseReference: boolean;
  requiresModificationPlan: boolean;
  sourceReferenceCount: number;
  numericFactCount: number;
  protocolSignalCount: number;
  interfaceSignalCount: number;
  modificationPlanSignalCount: number;
  projectCommunicationEntryCount: number;
  communicationTransportSignalCount: number;
  hasSourceFactMatrix: boolean;
  hasConcreteProtocolFacts: boolean;
  hasRemoteControllerInterfaceDoc: boolean;
  hasExistingCodeModificationPlan: boolean;
  hasProjectWideCommunicationChain: boolean;
  reasons: string[];
}

const FORMAL_PROJECT_RE = /(?:既有|现有|原项目|大项目|正式项目|生产项目|主控|平台|遥控器|模块|接口文档|参考.+模块|\/src\/|CMakeLists\.txt|Makefile|工程|代码库)/i;
const REMOTE_CONTROLLER_INTERFACE_RE = /(?:遥控器|遥控|remote.?controller|RC).{0,100}(?:接口|交互|通讯|通信|JSON|schema|字段|协议|topic|command|MAVLink|tunnel|主控|平台)|(?:接口|交互|通讯|通信|JSON|schema|字段|协议|topic|command|MAVLink|tunnel|主控|平台).{0,100}(?:遥控器|遥控|remote.?controller|RC)|(?:主控).{0,120}(?:平台).{0,120}(?:接口|交互|通讯|通信|JSON|schema|字段|协议|topic|command|MAVLink|tunnel)/i;
const LICENSE_REFERENCE_RE = /(?:license|License|授权|许可|参考.+license|license.+模块)/i;
const COMMUNICATION_REFERENCE_RE = /(?:(?:参考|复用|对齐).{0,80}(?:通讯|通信|通道|传输|tunnel|MAVLink|license)|(?:通讯|通信|通道|传输|tunnel|MAVLink).{0,80}(?:参考|复用|对齐|license)|遥控器.{0,120}(?:主控|平台).{0,120}(?:通讯|通信|交互|接口))/i;
const CODE_IMPLEMENTATION_RE = /(?:代码实现|实现代码|落地实现|实现.+代码|新增(?:代码|文件|功能)?|创建于|修改|重构|集成|implement|modify|refactor)/i;
const SOURCE_REFERENCE_RE = /(?:^|\s|`)(?:(?:[\w.-]+\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|md|txt|cmake)|src\/[\w./-]+|\/src\/[\w./-]+)(?::\d+)?)(?:`|\s|\||$)/gi;
const NUMERIC_FACT_RE = /(?:=\s*)?(?:0x[0-9a-f]+|\b\d{2,}\b|\b\d+\s*\*\s*\d+\b|\b\d+\s*(?:ms|s|KB|MB|Hz)\b)/gi;
const SOURCE_FACT_LABEL_RE = /(?:源项目事实|事实矩阵|调查证据|代码锚点|集成锚点|原项目代码|参考实现|既有实现|关键常量|关键数值|协议字段)/i;
const PROTOCOL_SIGNAL_RE = /(?:kTunnel\w*|kMavTunnel\w*|TunnelMsgType|MAVLINK_MSG_TUNNEL|MAVLINK_MSG_TUNNEL_FIELD_PAYLOAD_LEN|LicenseTunnelHeader|sessionId|payloadLen|totalLen|crc32|seq|total|topic|payload_type|COMMAND_LONG|UAV_EVENT|msgType|flags|timeout|超时|分片|重试|幂等|错误码|版本)/gi;
const LICENSE_STRONG_SIGNAL_RE = /(?:kMavTunnelCmdLicense|33007|kTunnelMaxTotalLen|64\s*\*\s*1024|kTunnelSessionTimeoutMs|5000|kTunnelVersion|TunnelMsgType|kTunnelFlagEnd|kTunnelFlagNeedAck|MAVLINK_MSG_TUNNEL|MAVLINK_MSG_TUNNEL_FIELD_PAYLOAD_LEN|LicenseTunnelHeader|crc32|sessionId|payloadLen|totalLen|seq|total|kTopicLicenseTunnelRx|kTopicLicenseTunnelTx|\/uav\/license\/tunnel\/(?:rx|tx))/gi;
const INTERFACE_SIGNAL_RE = /(?:方向|承载|通道|topic|命令|command|消息类型|request|response|JSON|schema|字段|payload|枚举|状态码|错误码|超时|重试|幂等|版本|兼容|示例|遥控器|主控|平台)/gi;
const MODIFICATION_PLAN_SIGNAL_RE = /(?:原有代码修改清单|修改点|需要修改|集成点|目标文件|函数|类|方法|改动内容|原因|风险|验证方式|回归|影响范围)/gi;
const PROJECT_COMMUNICATION_ENTRY_RE = /(?:uart\d+_(?:tx|rx)_main\.(?:c|cc|cpp|h|hpp)|(?:^|\s|`)(?:[\w./-]+\/)?(?:uart\d+|mavlink|tunnel|oam_msg|publisher|subscriber)[\w./-]*\.(?:c|cc|cpp|h|hpp)(?::\d+)?|(?:收发入口|通讯入口|通信入口|发送入口|接收入口|串口入口|全项目搜索|项目级通讯链路))/gi;
const COMMUNICATION_TRANSPORT_SIGNAL_RE = /(?:TunnelTransport|tunnel_transport|license_tunnel_transport|分片传输|分片组装|MAVLINK_MSG_TUNNEL|payload_type|HDStringPublisher|HDStringSubscriber|Publisher|Subscriber|topic|sessionId|payloadLen|totalLen|crc32|route|路由|调度|uart\d+)/gi;

export function assessFormalProjectDocumentQuality(
  text: string,
  promptText = '',
): FormalProjectDocumentQuality {
  const content = String(text || '');
  const prompt = String(promptText || '');
  const combined = `${prompt}\n${content}`;
  const requiresRemoteControllerInterface = REMOTE_CONTROLLER_INTERFACE_RE.test(prompt);
  const requiresLicenseReference = LICENSE_REFERENCE_RE.test(prompt);
  const requiresCommunicationChain = COMMUNICATION_REFERENCE_RE.test(prompt);
  const requiresModificationPlan = CODE_IMPLEMENTATION_RE.test(prompt);
  const required = (FORMAL_PROJECT_RE.test(prompt) || /(?:正式项目|大项目|生产项目)/i.test(combined))
    && (requiresRemoteControllerInterface
      || requiresLicenseReference
      || requiresModificationPlan
      || /(?:正式项目|大项目|生产项目)/i.test(prompt));
  const sourceReferenceCount = countMatches(content, SOURCE_REFERENCE_RE);
  const numericFactCount = countMatches(stripLikelyLineCountRows(content), NUMERIC_FACT_RE);
  const protocolSignalCount = countMatches(content, PROTOCOL_SIGNAL_RE);
  const licenseStrongSignalCount = countMatches(content, LICENSE_STRONG_SIGNAL_RE);
  const interfaceSignalCount = countMatches(content, INTERFACE_SIGNAL_RE);
  const modificationPlanSignalCount = countMatches(content, MODIFICATION_PLAN_SIGNAL_RE);
  const projectCommunicationEntryCount = countMatches(content, PROJECT_COMMUNICATION_ENTRY_RE);
  const communicationTransportSignalCount = countMatches(content, COMMUNICATION_TRANSPORT_SIGNAL_RE);
  const hasSourceFactMatrix = sourceReferenceCount >= 4
    && numericFactCount >= 3
    && SOURCE_FACT_LABEL_RE.test(content);
  const hasConcreteProtocolFacts = protocolSignalCount >= 6
    && (!requiresLicenseReference || licenseStrongSignalCount >= 4);
  const hasRemoteControllerInterfaceDoc = !requiresRemoteControllerInterface
    || (interfaceSignalCount >= 12 && /(?:JSON|schema|字段|payload)/i.test(content) && /(?:示例|example|request|response)/i.test(content));
  const hasExistingCodeModificationPlan = !requiresModificationPlan
    || (modificationPlanSignalCount >= 8 && sourceReferenceCount >= 4 && /(?:风险|验证|回归)/i.test(content));
  const hasProjectWideCommunicationChain = !requiresCommunicationChain
    || (projectCommunicationEntryCount >= 1 && communicationTransportSignalCount >= 6);
  const reasons = [
    required && !hasSourceFactMatrix ? 'missing-source-fact-matrix' : '',
    required && !hasConcreteProtocolFacts ? 'missing-concrete-protocol-facts' : '',
    required && requiresRemoteControllerInterface && !hasRemoteControllerInterfaceDoc ? 'missing-remote-controller-interface-doc' : '',
    required && requiresModificationPlan && !hasExistingCodeModificationPlan ? 'missing-existing-code-modification-plan' : '',
    required && requiresCommunicationChain && !hasProjectWideCommunicationChain ? 'missing-project-wide-communication-chain' : '',
  ].filter(Boolean);

  return {
    required,
    ok: !required || reasons.length === 0,
    requiresRemoteControllerInterface,
    requiresLicenseReference,
    requiresModificationPlan,
    sourceReferenceCount,
    numericFactCount,
    protocolSignalCount,
    interfaceSignalCount,
    modificationPlanSignalCount,
    projectCommunicationEntryCount,
    communicationTransportSignalCount,
    hasSourceFactMatrix,
    hasConcreteProtocolFacts,
    hasRemoteControllerInterfaceDoc,
    hasExistingCodeModificationPlan,
    hasProjectWideCommunicationChain,
    reasons,
  };
}

function countMatches(text: string, pattern: RegExp): number {
  pattern.lastIndex = 0;
  return Array.from(String(text || '').matchAll(pattern)).length;
}

function stripLikelyLineCountRows(text: string): string {
  return String(text || '')
    .split(/\r?\n/)
    .filter(line => !/\|\s*(?:~?\d+|\d+\s*行)\s*\|/.test(line))
    .join('\n');
}
