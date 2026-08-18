import { stableStringify } from './stable-stringify';

export interface ContextToolRequest {
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const CONTEXT_GATHERING_TOOL_NAMES = new Set([
  'read_file', 'list_dir', 'grep_search', 'file_search',
  'semantic_search', 'memory_search', 'memory_read',
]);

export function isContextGatheringToolName(name: string): boolean {
  return CONTEXT_GATHERING_TOOL_NAMES.has(name);
}

export function makeContextToolSignature(tool: ContextToolRequest): string {
  return `${tool.name}:${stableStringify(tool.input ?? {})}`;
}

export function buildRepeatedContextToolFeedback(tool: ContextToolRequest, count: number): string {
  return [
    `【系统反馈】检测到上下文工具重复 ${count} 次：${tool.name}`,
    '这批读取/搜索已经执行过，且期间没有新的写盘或验证进展。',
    '请不要重复读取相同路径或重复相同搜索；下一轮必须基于已有事实进入设计/写入/验证，或换用更精确的新文件范围。',
  ].join('\n');
}
