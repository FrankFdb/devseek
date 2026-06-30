import { containsFakeToolCallProtocol, stripToolCallBlocks } from '../agent/fake-tool-parser';

export interface NonAgentResponseGuardResult {
  visibleText: string;
  artifactText: string;
  containsInternalToolProtocol: boolean;
  usedProtocolNotice: boolean;
}

export const NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE =
  '（模型返回了内部工具调用协议，但当前对话路径不会执行工具。已隐藏协议内容，未对工作区做任何修改。请开启 Agent 模式重新发送，或使用 Agent/自动模式执行读取、写入和验证。）';

const PROCESS_ONLY_ANNOUNCEMENT_RE =
  /^(?:好的[，,。！\s]*)?(?:我来|我先|让我|现在|接下来|首先|先)(?:[^。！\n]{0,80})(?:查看|读取|检查|分析|了解|实现|修改|创建|更新|执行|调用)(?:[^。！\n]{0,80})[。！：:\s]*$/u;

function isProcessOnlyAnnouncement(text: string): boolean {
  const cleaned = text.trim();
  if (!cleaned) return true;
  if (cleaned.length > 140) return false;
  return PROCESS_ONLY_ANNOUNCEMENT_RE.test(cleaned);
}

export function guardNonAgentResponse(text: string): NonAgentResponseGuardResult {
  const raw = String(text || '');
  const visible = stripToolCallBlocks(raw).trim();
  const containsInternalToolProtocol = containsFakeToolCallProtocol(raw);

  if (!containsInternalToolProtocol) {
    return {
      visibleText: visible,
      artifactText: raw,
      containsInternalToolProtocol: false,
      usedProtocolNotice: false,
    };
  }

  const visibleText = visible && !isProcessOnlyAnnouncement(visible)
    ? `${visible}\n\n${NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE}`
    : NON_AGENT_INTERNAL_TOOL_PROTOCOL_NOTICE;

  return {
    visibleText,
    artifactText: visibleText,
    containsInternalToolProtocol: true,
    usedProtocolNotice: true,
  };
}
