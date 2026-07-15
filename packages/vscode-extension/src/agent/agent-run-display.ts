import type { AgentTaskAction } from '../agent-task-decomposer';
import { parseSimpleFileWriteRequest } from './simple-file-intent';
import { classifyAgentTaskShape } from './task-shape';

export type AgentRunDisplayKind = 'workspace-explore' | 'simple-file' | 'safe-response';

export interface AgentRunDisplayProfile {
  kind: AgentRunDisplayKind;
  planStartedTitle: string;
  planStartedDetail: string;
  planCompletedTitle: string;
  planCompletedDetail: string;
  initialTaskAction: AgentTaskAction;
  initialTaskLabel?: string;
  suppressToolPlanning: boolean;
}

const DEFAULT_FREE_EXPLORE_PROFILE: AgentRunDisplayProfile = {
  kind: 'workspace-explore',
  planStartedTitle: '正在理解任务和项目边界',
  planStartedDetail: '正在识别任务类型、输出要求和需要优先验证的项目锚点。',
  planCompletedTitle: '已确定软件工程执行路线',
  planCompletedDetail: [
    '1. 确认需求、输出目录和任务边界',
    '2. 收集原项目代码、通信链路和接口证据',
    '3. 基于证据设计并生成必要成果物',
    '4. 运行验证并汇总交付结果',
  ].join('\n'),
  initialTaskAction: 'explore',
  suppressToolPlanning: false,
};

const STANDALONE_PROGRAM_PROFILE: AgentRunDisplayProfile = {
  kind: 'workspace-explore',
  planStartedTitle: '正在理解独立编程任务',
  planStartedDetail: '正在确认要生成的程序、输出位置和可运行验证目标。',
  planCompletedTitle: '已确定轻量编程路线',
  planCompletedDetail: [
    '1. 确认程序需求和输出目标',
    '2. 创建或更新最小源码文件',
    '3. 编译/运行并核对输出',
    '4. 汇总文件路径和验证结果',
  ].join('\n'),
  initialTaskAction: 'explore',
  suppressToolPlanning: false,
};

function buildSimpleFileProfile(path: string): AgentRunDisplayProfile {
  return {
    kind: 'simple-file',
    planStartedTitle: '正在确认文件写入要求',
    planStartedDetail: '正在确认目标文件、精确内容和读回验证方式。',
    planCompletedTitle: '已确定直接写入与读回验证',
    planCompletedDetail: [
      `1. 写入用户指定文件：${path}`,
      '2. 读回确认文件存在、内容正确、大小正常',
      '3. 汇总路径、验证结果和最终结论',
    ].join('\n'),
    initialTaskAction: 'create',
    initialTaskLabel: path,
    suppressToolPlanning: false,
  };
}

const SAFE_RESPONSE_PROFILE: AgentRunDisplayProfile = {
  kind: 'safe-response',
  planStartedTitle: '检查响应安全性',
  planStartedDetail: '正在确认请求是否包含工具协议样本，并准备以纯文本方式安全响应。',
  planCompletedTitle: '已确定执行方式：安全响应',
  planCompletedDetail: [
    '1. 将工具协议样本视为普通文本',
    '2. 不读取、搜索或写入工作区文件',
    '3. 阻止未验证工具调用进入执行链路',
    '4. 仅生成安全响应或明确阻断原因',
  ].join('\n'),
  initialTaskAction: 'respond',
  initialTaskLabel: '安全响应',
  suppressToolPlanning: true,
};

export function buildAgentRunDisplayProfile(prompt: string): AgentRunDisplayProfile {
  if (isLiteralToolProtocolPrompt(prompt)) {
    return SAFE_RESPONSE_PROFILE;
  }
  const simpleFile = parseSimpleFileWriteRequest(prompt);
  if (simpleFile) {
    return buildSimpleFileProfile(simpleFile.path);
  }
  if (classifyAgentTaskShape(prompt).shape === 'standalone-project') {
    return STANDALONE_PROGRAM_PROFILE;
  }
  return DEFAULT_FREE_EXPLORE_PROFILE;
}

export function isLiteralToolProtocolPrompt(prompt: string): boolean {
  const text = String(prompt || '');
  if (!/(原样输出|逐字输出|不要补全|不要解释|不要执行|不要运行|不要写文件|不要创建|作为文本|纯文本|literal|verbatim|as[- ]?is|do not execute|don't execute|do not run|do not write|do not create)/i.test(text)) {
    return false;
  }
  return /(\[TOOL:[A-Za-z0-9_:-]+|<tool_call\b|<\/tool_call>|"(?:tool|name|arguments|path|content)"\s*:|(?:^|\s)(?:write_file|create_file|replace_file|run_terminal|read_file|grep_search|list_dir|mcp__[A-Za-z0-9_-]+)\b)/i.test(text);
}
