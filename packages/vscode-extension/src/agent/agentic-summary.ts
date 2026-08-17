import { containsFakeToolCallProtocol, stripToolCallBlocks } from './fake-tool-parser';

export function normalizeAgentUserAnnouncement(text: string): string {
  const cleaned = stripToolCallBlocks(text || '').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return '';
  if (/^【系统反馈】/.test(cleaned)) return '';
  if (/^(?:还缺少|已完成部分工作|不能结束任务|不能停在检查目录|任务清单已收到)/.test(cleaned)) return '';
  if (/(?:memory_(?:write|search|read)|项目记忆|智能体记忆|写入记忆)/i.test(cleaned)) return '';
  // Strip AI acknowledgment boilerplate prefixes ("收到反馈，我来X" / "好的，我来X" etc.).
  // If the text after the prefix has meaningful content (≥15 chars), keep that part.
  // If the entire message is just boilerplate, filter it entirely.
  const boilerplateRe = /^(?:收到反馈[，,。\s]*(?:我来|我将|我会|立即)[^。！\n]{0,30}[。！]?\s*|好的[，,。！]\s*(?:我来|我将|我会)[^。！\n]{0,30}[。！]?\s*|明白了?[，,。！]?\s*(?:我来|我将|我会)[^。！\n]{0,30}[。！]?\s*|了解[了一下]?[，,。！]?\s*(?:我来|我将|我会)[^。！\n]{0,30}[。！]?\s*)/u;
  const bpMatch = boilerplateRe.exec(cleaned);
  if (bpMatch) {
    const remainder = cleaned.slice(bpMatch[0].length).trim().replace(/^[，,。！\s]+/, '');
    if (!remainder || remainder.length < 15) return '';  // pure/near-pure boilerplate → suppress
    return remainder;  // keep meaningful content that follows the boilerplate phrase
  }
  // Also suppress standalone "我来写/创建/实现..." openers (no preceding phrase).
  // These are pure announcement lines like "我来写一个C程序：" followed by a tool call.
  const standaloneOpenerRe = /^我来(?:写|创建|实现|编写|修复|处理|添加|补充)[^。！\n]{0,50}[，。！：:]\s*/u;
  const soMatch = standaloneOpenerRe.exec(cleaned);
  if (soMatch) {
    const remainder = cleaned.slice(soMatch[0].length).trim().replace(/^[，,。！：:\s]+/, '');
    if (!remainder || remainder.length < 20) return '';
    return remainder;
  }
  return cleaned;
}

function containsAgentInternalTranscript(text: string): boolean {
  return containsFakeToolCallProtocol(text || '')
    || /(?:^|\n)\s*(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(?:bash|shell|sh|zsh|console|terminal|cmd|powershell|pwsh|run_terminal|read_file|grep_search|search_file|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_(?:write|search|read)|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n)\s*\[(?:工具结果|run_terminal|read_file|grep_search|search_file|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_(?:write|search|read)|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(text)
    || /\b(?:run_terminal|manage_todo_list|task_complete|stdout|stderr|exitCode|exit code)\b/i.test(text)
    || /(?:^|\n)\s*\$\s+\S+/.test(text)
    || /(?:^|\n)\s*(?:命令输出|执行命令|终端输出)\s*[:：]/.test(text);
}

export function cleanAgentFinalSummaryForUser(text: string): string {
  if (containsAgentInternalTranscript(text || '')) return '';
  let cleaned = stripToolCallBlocks(text || '')
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return '';

  const lines = cleaned.split('\n').filter((line) => {
    const s = line.trim();
    if (!s) return true;
    if (/^(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(?:bash|shell|sh|zsh|console|terminal|cmd|powershell|pwsh|run_terminal|read_file|grep_search|search_file|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_(?:write|search|read)|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(s)) return false;
    if (/^\[(?:工具结果|run_terminal|read_file|grep_search|search_file|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_(?:write|search|read)|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(s)) return false;
    if (/^\$\s+\S+/.test(s)) return false;
    if (/^(?:stdout|stderr|exitCode|exit code|命令输出|执行命令|终端输出)\s*[:：]/i.test(s)) return false;
    return true;
  });
  cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned || containsAgentInternalTranscript(cleaned)) return '';
  return cleaned.length > 800 ? cleaned.slice(0, 797).trimEnd() + '...' : cleaned;
}

export function agentAnnouncementKey(text: string): string {
  return normalizeAgentUserAnnouncement(text).toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}
