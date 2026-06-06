/**
 * Agent Loop — Phase-1 executor (Editor role)
 *
 * Architecture: Two-phase Agent Loop (Architect + Editor), matching how
 * Aider, Cursor Agent, and Copilot Edits work internally.
 *
 *   Phase-0 (Architect): decomposeTask() → structured JSON plan of AgentTask[]
 *   Phase-1 (Editor):    runAgentLoop()  → execute each task with a focused,
 *                                          single-file structured prompt
 *
 * Key improvements over the previous version:
 * ─────────────────────────────────────────────────────────────────
 * 1. FILE CONTENT INJECTION
 *    Every editor/analyze prompt now includes the CURRENT file content read
 *    directly from the local filesystem.  The LLM never has to guess what is
 *    already in the file — it always edits from ground truth.
 *
 * 2. SEARCH/REPLACE BLOCKS (Aider/Cursor style)
 *    For modify tasks the editor is asked to output targeted change blocks:
 *
 *      <<<<<<< SEARCH
 *      exact current code
 *      =======
 *      new code
 *      >>>>>>> REPLACE
 *
 *    This is far more reliable than full-file replacement: the LLM writes only
 *    the CHANGED parts, hallucination is lower, and the parser is deterministic.
 *    Full-file output is still accepted as a fallback when no blocks are found.
 *
 * 3. CONSOLIDATED ANALYSIS
 *    When all tasks are analyze/explain, a single LLM call analyzes every file
 *    together (content injected) and streams one organized markdown response.
 *    This replaces N separate streaming calls that flooded the chat bubble.
 *
 * 4. RETRY ON APPLY FAILURE
 *    If the first edit attempt produces no recognized change, one retry is made
 *    with the explicit current file content and a simplified prompt.
 *
 * 5. COMPILE VALIDATION (C/C++ only)
 *    Unchanged: runs after all modify tasks, skipped for analyze/explain.
 */

import * as nodePath from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getActiveProvider } from './llm/provider-router';
import { ChatMessage } from './llm/types';
import { AgentTask, AgentTaskAction, readFileContentSafe, readFileContentFull } from './agent-task-decomposer';
import { fenceLangForFile, roughLineDiff } from './utils';
import { findWorkspaceFolderForRelativePath } from './workspace-roots';
import {
  applyGeneratedArtifactsWithPrompt,
  AppliedChangeRecord,
  ApplyWorkflowStatus,
  ApplyWorkflowResult,
} from './workspace-applier';
import { looksLikeRawToolCallText, parseGeneratedArtifacts } from './generated-file-parser';
import { runLocalExecution, LocalExecutionPlan, planLocalExecution } from './execution-planner';
import { McpToolRef } from './mcp/client';
import { getProjectRulesSync, wrapRulesAsContext, getProjectMemorySync, wrapMemoryAsContext } from './project-rules';
import { getCommandHints } from './agent-learner';

// ----------------------------------------------------------------
// Reporter types (passed in from extension.ts)
// ----------------------------------------------------------------

// ── L-2/L-3: AI 可调用工具类型 ──────────────────────────────────────────────────

export interface TodoItem {
  id: number;
  title: string;
  /** Copilot-compatible status values */
  status: 'not-started' | 'in-progress' | 'completed' | 'failed';
}

interface FakeTool {
  name: string;
  input: Record<string, unknown>;
}

const KNOWN_FAKE_TOOL_NAMES = new Set([
  'read_file', 'grep_search', 'file_search', 'semantic_search', 'list_dir', 'get_errors',
  'run_terminal', 'memory_write', 'get_changed_files', 'create_directory', 'fetch_webpage',
  'vscode_listCodeUsages', 'run_vscode_command', 'create_file', 'write_file', 'replace_file',
  'manage_todo_list', 'task_complete',
]);

function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let j = start; j < text.length; j++) {
    const ch = text[j];
    if (inStr) {
      if (ch === '\\') j++;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return j;
      }
    }
  }
  return -1;
}

function stripCallingToolBlocks(text: string): string {
  let out = '';
  let i = 0;
  const callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
  while (i < text.length) {
    callRe.lastIndex = i;
    const m = callRe.exec(text);
    if (!m) {
      out += text.slice(i);
      break;
    }
    const name = m[1];
    if (!KNOWN_FAKE_TOOL_NAMES.has(name) && !name.startsWith('mcp__')) {
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    let jsonStart = text.indexOf('{', callRe.lastIndex);
    if (jsonStart < 0) {
      out += text.slice(i);
      break;
    }
    const jsonEnd = findJsonObjectEnd(text, jsonStart);
    if (jsonEnd < 0) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, m.index);
    let next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function jsonObjectToFakeTool(obj: Record<string, unknown>): FakeTool | null {
  const rawName = typeof obj.tool === 'string'
    ? obj.tool
    : typeof obj.name === 'string'
      ? obj.name
      : '';
  const name = rawName.trim();
  if (!name || (!KNOWN_FAKE_TOOL_NAMES.has(name) && !name.startsWith('mcp__'))) return null;
  const maybeArgs = obj.arguments ?? obj.parameters ?? obj.args;
  let input: Record<string, unknown>;
  if (maybeArgs && typeof maybeArgs === 'object' && !Array.isArray(maybeArgs)) {
    input = maybeArgs as Record<string, unknown>;
  } else {
    input = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!['tool', 'name', 'arguments', 'parameters', 'args'].includes(k)) input[k] = v;
    }
  }
  return { name, input };
}

function stripJsonToolPayloads(text: string): string {
  let result = text.replace(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g, (full, inner) => {
    const trimmed = String(inner || '').trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return full;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.some(item => item && typeof item === 'object' && jsonObjectToFakeTool(item as Record<string, unknown>)) ? '' : full;
      }
      if (parsed && typeof parsed === 'object' && jsonObjectToFakeTool(parsed as Record<string, unknown>)) return '';
    } catch { /* keep non-tool JSON */ }
    return full;
  });

  let i = 0;
  let out = '';
  while (i < result.length) {
    const start = result.indexOf('{', i);
    if (start < 0) { out += result.slice(i); break; }
    out += result.slice(i, start);
    const end = findJsonObjectEnd(result, start);
    if (end < 0) { out += result.slice(start); break; }
    const candidate = result.slice(start, end + 1);
    let stripped = false;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && jsonObjectToFakeTool(parsed as Record<string, unknown>)) {
        stripped = true;
      }
    } catch { /* keep non-tool JSON */ }
    if (!stripped) out += candidate;
    i = end + 1;
  }
  return out;
}

function normalizeAgentUserAnnouncement(text: string): string {
  const cleaned = stripToolCallBlocks(text || '').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return '';
  if (/^【系统反馈】/.test(cleaned)) return '';
  if (/^(?:还缺少|已完成部分工作|不能结束任务|不能停在检查目录|任务清单已收到)/.test(cleaned)) return '';
  if (/(?:memory_write|项目记忆|智能体记忆|写入记忆)/i.test(cleaned)) return '';
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
  return /(?:^|\n)\s*(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n)\s*\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(text)
    || /\b(?:run_terminal|manage_todo_list|task_complete|stdout|stderr|exitCode|exit code)\b/i.test(text)
    || /(?:^|\n)\s*\$\s+\S+/.test(text)
    || /(?:^|\n)\s*(?:命令输出|执行命令|终端输出)\s*[:：]/.test(text);
}

function cleanAgentFinalSummaryForUser(text: string): string {
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
    if (/^(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(s)) return false;
    if (/^\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(s)) return false;
    if (/^\$\s+\S+/.test(s)) return false;
    if (/^(?:stdout|stderr|exitCode|exit code|命令输出|执行命令|终端输出)\s*[:：]/i.test(s)) return false;
    return true;
  });
  cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned || containsAgentInternalTranscript(cleaned)) return '';
  return cleaned.length > 800 ? cleaned.slice(0, 797).trimEnd() + '...' : cleaned;
}

function agentAnnouncementKey(text: string): string {
  return normalizeAgentUserAnnouncement(text).toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
}

function findFirstToolCallStart(text: string): number {
  const indexes: number[] = [];
  const bracket = text.indexOf('[TOOL:');
  if (bracket >= 0) indexes.push(bracket);
  const callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
  let cm: RegExpExecArray | null;
  while ((cm = callRe.exec(text)) !== null) {
    const name = cm[1];
    if (KNOWN_FAKE_TOOL_NAMES.has(name) || name.startsWith('mcp__')) indexes.push(cm.index);
  }
  let searchAt = 0;
  while (searchAt < text.length) {
    const start = text.indexOf('{', searchAt);
    if (start < 0) break;
    const end = findJsonObjectEnd(text, start);
    if (end < 0) {
      const tail = text.slice(start);
      if (/"tool"\s*:\s*"[A-Za-z_]\w*"/.test(tail)) indexes.push(start);
      break;
    }
    try {
      const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && jsonObjectToFakeTool(parsed as Record<string, unknown>)) {
        indexes.push(start);
      }
    } catch { /* ignore non-tool JSON */ }
    searchAt = end + 1;
  }
  return indexes.length ? Math.min(...indexes) : -1;
}

/**
 * Parse [TOOL:name {...}] blocks from LLM output.
 * These are "fake" tool calls the AI outputs as text when native function
 * calling is unavailable (bridge provider limitation).
 *
 * Also handles fallback formats produced by some models under DeepSeek R1:
 *   1. Markdown ```json\n[{"tool":"name","param":...}]\n``` array blocks
 *   2. Bare JSON arrays [{"tool":"name",...}]
 */
function stripToolCallBlocks(text: string): string {
  let result = '';
  let i = 0;
  const len = text.length;
  while (i < len) {
    if (text[i] === '[') {
      const lookahead = text.slice(i, Math.min(i + 60, len));
      const m = lookahead.match(/^\[TOOL:(\w+)\s*\{/);
      if (m) {
        const bracePos = text.indexOf('{', i);
        if (bracePos < 0) { result += text[i]; i++; continue; }
        let depth = 1;
        let j = bracePos + 1;
        while (j < len && depth > 0) {
          if (text[j] === '{') depth++;
          else if (text[j] === '}') depth--;
          j++;
        }
        while (j < len && (text[j] === ' ' || text[j] === '\t')) j++;
        if (j < len && text[j] === ']') j++;
        i = j;
        continue;
      }
    }
    result += text[i];
    i++;
  }
  // Also strip [TOOL:name] {...} variant (closing ] before JSON)
  result = result.replace(/\[TOOL:\w+\]\s*\{[^]*?\}(?:\n|$)/gm, '');
  // Also strip DeepSeek web pseudo tool calls:
  //   Calling `manage_todo_list` / Call: run_terminal
  //   {"todoList":[...]}
  result = stripCallingToolBlocks(result);
  result = stripJsonToolPayloads(result);
  // Also strip <tool_call>...</tool_call> and <tool_calls>...</tool_calls> blocks
  const noXml = result
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, '');
  return noXml.replace(/\n{3,}/g, '\n\n').trim();
}

function parseFakeToolCalls(text: string): FakeTool[] {
  const tools: FakeTool[] = [];
  // ── Primary format: [TOOL:name {...}] or [TOOL:name] {...} ─────────────────
  const re = /\[TOOL:(\w+)\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    let jsonStart = m.index + m[0].length;
    // Skip optional closing ']' (format: [TOOL:name] {json})
    if (text[jsonStart] === ']') jsonStart++;
    // Skip whitespace
    while (jsonStart < text.length && (text[jsonStart] === ' ' || text[jsonStart] === '\t' || text[jsonStart] === '\n' || text[jsonStart] === '\r')) jsonStart++;
    if (text[jsonStart] !== '{') continue;
    let depth = 0; let inStr = false; let j = jsonStart;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (ch === '\\') { j++; }      // skip escaped char
        else if (ch === '"') { inStr = false; }
      } else {
        if (ch === '"') { inStr = true; }
        else if (ch === '{') { depth++; }
        else if (ch === '}') { depth--; if (depth === 0) break; }
      }
    }
    if (depth !== 0) continue; // malformed — unclosed brace
    const jsonStr = text.slice(jsonStart, j + 1);
    try {
      tools.push({ name, input: JSON.parse(jsonStr) });
    } catch { /* ignore malformed JSON */ }
  }

  // ── Fallback 1b: DeepSeek web pseudo-call format ─────────────────────────
  // Production traces sometimes stream:
  //   Calling `manage_todo_list`
  //   {"todoList":[...]}
  // or the JSON is wrapped in a ```json fence. Treat it as a tool call instead
  // of letting the raw "Calling" transcript leak into the chat bubble.
  if (tools.length === 0) {
    const callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
    let cm: RegExpExecArray | null;
    while ((cm = callRe.exec(text)) !== null) {
      const name = cm[1];
      if (!KNOWN_FAKE_TOOL_NAMES.has(name) && !name.startsWith('mcp__')) continue;
      let jsonStart = text.indexOf('{', callRe.lastIndex);
      if (jsonStart < 0) continue;
      const fenceEnd = text.indexOf('```', callRe.lastIndex);
      if (fenceEnd >= 0 && fenceEnd < jsonStart) {
        const afterFenceNewline = text.indexOf('\n', fenceEnd);
        const fencedJsonStart = afterFenceNewline >= 0 ? text.indexOf('{', afterFenceNewline) : -1;
        if (fencedJsonStart >= 0) jsonStart = fencedJsonStart;
      }
      const jsonEnd = findJsonObjectEnd(text, jsonStart);
      if (jsonEnd < 0) continue;
      try {
        tools.push({ name, input: JSON.parse(text.slice(jsonStart, jsonEnd + 1)) });
        callRe.lastIndex = jsonEnd + 1;
      } catch { /* ignore malformed */ }
    }
  }

  // ── Fallback 1c: bare JSON object with tool payload ──────────────────────
  // DeepSeek web may output only { "todoList": [...] } without [TOOL:...] or
  // "Calling". Treat this as manage_todo_list so planning does not fall through
  // into generic generated-file parsing.
  if (tools.length === 0) {
    const start = text.indexOf('{');
    if (start >= 0) {
      const end = findJsonObjectEnd(text, start);
      if (end >= 0) {
        try {
          const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
          const toolObj = jsonObjectToFakeTool(obj);
          if (toolObj) {
            tools.push(toolObj);
          } else if (Array.isArray(obj.todoList)) {
            tools.push({ name: 'manage_todo_list', input: { todoList: obj.todoList } });
          } else if (typeof obj.summary === 'string' && /(?:完成|结束|complete|done)/i.test(text)) {
            tools.push({ name: 'task_complete', input: { summary: obj.summary } });
          }
        } catch { /* ignore non-tool JSON */ }
      }
    }
  }

  // ── Fallback format: ```json\n[{...}]\n``` or bare [{...}] arrays ──────────
  // Some models (DeepSeek R1 under certain prompts) use JSON code blocks instead
  // of the [TOOL:...] format.  Each array element may use either:
  //   {"tool":"name","param":...}   — flat key "tool"
  //   [{"tool":"run_terminal","command":"..."}] — as seen in production traces
  if (tools.length === 0) {
    // Match ```json ... ``` blocks AND bare JSON arrays in the same pass
    const jsonBlockRe = /(?:```json\s*)(\[[\s\S]*?\])(?:\s*```)|(?<![A-Za-z\[])(\[[\s\S]{2,3000}?\])/g;
    let bm: RegExpExecArray | null;
    while ((bm = jsonBlockRe.exec(text)) !== null) {
      const jsonCandidate = (bm[1] || bm[2] || '').trim();
      if (!jsonCandidate.startsWith('[')) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(jsonCandidate); } catch { continue; }
      if (!Array.isArray(parsed)) continue;
      for (const item of parsed as unknown[]) {
        if (typeof item !== 'object' || item === null) continue;
        const obj = item as Record<string, unknown>;
        const converted = jsonObjectToFakeTool(obj);
        if (converted) {
          tools.push(converted);
          continue;
        }
        // Support both {"tool":"name",...} and {"id":1,"title":...,"status":...}
        // Only extract actual tool calls (must have "tool" key with known tool name)
        const toolName = typeof obj['tool'] === 'string' ? (obj['tool'] as string) : null;
        if (!toolName) continue;
        // Build input: everything except the "tool" key itself
        const input: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (k !== 'tool') input[k] = v;
        }
      tools.push({ name: toolName, input });
      }
    }
  }

  // ── Fallback 3: <tool_call> XML format (DeepSeek native) ─────────────────
  // Format A:  <tool_call>\ntool_name\n{...}\n</tool_call>
  // Format B:  <tool_call>\n{"name":"tool_name","arguments":{...}}\n</tool_call>
  if (tools.length === 0) {
    const xmlRe = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let xm: RegExpExecArray | null;
    while ((xm = xmlRe.exec(text)) !== null) {
      const inner = xm[1].trim();
      // Format B: JSON object with "name" key
      if (inner.startsWith('{')) {
        try {
          const obj = JSON.parse(inner) as Record<string, unknown>;
          const tName = typeof obj['name'] === 'string' ? obj['name'] as string : null;
          if (tName) {
            const inp = (obj['arguments'] ?? obj['parameters'] ?? obj['args'] ?? {}) as Record<string, unknown>;
            tools.push({ name: tName, input: inp });
            continue;
          }
        } catch { /* fall through to Format A */ }
      }
      // Format A: first line is tool name, rest is JSON
      const nl = inner.indexOf('\n');
      if (nl < 0) continue;
      const tName = inner.slice(0, nl).trim();
      const jsonPart = inner.slice(nl + 1).trim();
      if (!tName || !jsonPart.startsWith('{')) continue;
      try {
        tools.push({ name: tName, input: JSON.parse(jsonPart) });
      } catch { /* ignore malformed */ }
    }
  }

  // ── Fallback 4: <tool_calls><invoke name="..."><parameter .../></invoke></tool_calls>
  // DeepSeek web output format when model uses its own tool-calling syntax.
  // <parameter> can appear as:
  //   <parameter name="foo" value="..."/>           (self-closing with value attr)
  //   <parameter name="foo">some content</parameter> (text content)
  if (tools.length === 0) {
    const invokeRe = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/gi;
    let im: RegExpExecArray | null;
    while ((im = invokeRe.exec(text)) !== null) {
      const tName = im[1].trim();
      const body = im[2];
      const input: Record<string, unknown> = {};
      // Match self-closing: <parameter name="x" value="..."/>
      const selfRe = /<parameter\s+name="([^"]+)"\s+value="([\s\S]*?)"\s*\/>/gi;
      let pm: RegExpExecArray | null;
      while ((pm = selfRe.exec(body)) !== null) {
        const pName = pm[1];
        const pVal = pm[2];
        try { input[pName] = JSON.parse(pVal); } catch { input[pName] = pVal; }
      }
      // Match block: <parameter name="x">...</parameter>
      const blockRe = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/gi;
      while ((pm = blockRe.exec(body)) !== null) {
        const pName = pm[1];
        const pVal = pm[2].trim();
        try { input[pName] = JSON.parse(pVal); } catch { input[pName] = pVal; }
      }
      tools.push({ name: tName, input });
    }
  }

  return tools;
}

function extractPlanningTodoItems(text: string): TodoItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) => /(规划任务|任务规划|任务清单|待办清单|计划任务|规划如下|计划如下|todos?|tasks?)(：|:)?$/i.test(line));
  if (startIndex < 0) return [];
  const sourceLines = lines.slice(startIndex + 1);

  const items: string[] = [];
  for (const rawLine of sourceLines) {
    if (!/^\s*(?:[-*•]|\d+[.)、])\s+/.test(rawLine)) {
      if (items.length > 0) break;
      continue;
    }
    const line = rawLine
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[.)、]\s*/, '')
      .trim();

    if (!line) continue;
    if (/^(<tool_call>|\[TOOL:|```|\{|\}|我来|让我|下面是|以下是|请开始|开始执行|让我开始)/i.test(line)) break;
    if (/^(规划任务|任务规划|任务清单|待办清单|计划任务|规划如下|计划如下)$/i.test(line)) continue;
    if (/^[，。,。.；;：:]+$/.test(line)) continue;
    items.push(line);
  }

  const uniqueItems: string[] = [];
  for (const item of items) {
    if (!uniqueItems.includes(item)) uniqueItems.push(item);
  }

  if (uniqueItems.length === 0) return [];
  return uniqueItems.slice(0, 8).map((title, index) => ({
    id: index + 1,
    title,
    status: index === 0 ? 'in-progress' : 'not-started',
  }));
}

/**
 * I-2: 系统提示词工程 — 生成上下文感知的工具调用指导。
 *
 * G8 (simplified): workflow hints describe capabilities, not rigid orchestration steps.
 * The AI decides when it has completed its task. For multi-task plans, each Editor
 * call is scoped to ONE task — external loop in runAgentLoop handles sequencing.
 */
function buildToolsSuffix(taskIndex: number, taskTotal: number, mcpTools?: McpToolRef[], taskWorkdir?: string): string {
  const isFirst = taskIndex === 1;
  const isLast  = taskIndex === taskTotal;
  const isSingle = taskTotal === 1;

  // For multi-task plans each Editor call covers exactly ONE task; the outer loop in
  // runAgentLoop advances to the next task automatically.  task_complete is therefore
  // only meaningful (and advertised) for the very last task — intermediate tasks must
  // NOT call it, otherwise the loop breaks prematurely and later tasks never run.
  const workflowHint = isSingle || isLast
    ? `
【完成信号】
完成本文件修改后，调用 task_complete 工具，附上完成报告（包含：1)修改了哪些文件及关键改动；2)为什么这样改；3)需注意的副作用或潜在问题）。
过程中可用 manage_todo_list 跟踪进度（只将当前任务标为 in-progress，未完成任务保持 not-started）。
`
    : isFirst
    ? `
【当前任务】第 ${taskIndex}/${taskTotal} 个任务（序列计划第一步）
完成本文件内容输出后停止，系统会自动推进到下一个任务。
`
    : `
【当前任务】第 ${taskIndex}/${taskTotal} 个任务
完成本文件内容输出后停止，系统会自动推进到下一个任务。
`;

  // P3-5: Append MCP tools section if any servers are connected
  let mcpSection = '';
  if (mcpTools && mcpTools.length > 0) {
    const toolLines = mcpTools.map((ref) => {
      const schema = JSON.stringify(ref.tool.inputSchema ?? {});
      return `  [TOOL:${ref.fakeName} ${schema}]  — ${ref.tool.description || ref.tool.name}`;
    }).join('\n');
    mcpSection = `

## MCP 外部工具（通过相同格式调用）

以下工具由外部 MCP server 提供。调用格式与上方相同：
[TOOL:mcp__<server>__<tool> {"param":"value"}]

可用工具：
${toolLines}

调用 MCP 工具后，结果将作为下一轮输入附上。`;
  }

  return `
## 可用工具（通过文本格式调用）

格式严格如下（JSON 必须完整，不省略花括号）：
${isSingle || isLast ? `
更新任务列表（全量替换，每次必须包含所有任务）：
[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"任务标题","status":"in-progress"},{"id":2,"title":"另一任务","status":"not-started"}]}]

标记全部完成（仅最后一个任务才可调用）：
[TOOL:task_complete {"summary":"完成报告：1)修改内容（文件名+关键改动）；2)修改原因；3)注意事项或潜在影响（如有）"}]
` : ''}
执行终端命令（输出将在下轮可见，可用于编译验证、运行测试等）：
[TOOL:run_terminal {"command":"npm run build","workdir":"${taskWorkdir ?? '/可选/绝对/路径'}"}]

读取工作区文件内容（路径相对于工作区根，或绝对路径）：
[TOOL:read_file {"path":"src/foo.ts"}]

搜索工作区文件内容（支持正则，可指定目录路径）：
[TOOL:grep_search {"pattern":"className|funcName","path":"src/","isRegexp":true}]

按 glob 模式查找文件名（不读取内容）：
[TOOL:file_search {"glob":"src/**/*.ts"}]

语义化搜索工作区代码（按意图/概念，自动提取关键词）：
[TOOL:semantic_search {"query":"用户登录验证处理函数"}]

列出目录内容（相对于工作区根目录）：
[TOOL:list_dir {"path":"src/utils/"}]

获取当前 VS Code 编译/诊断错误（类型错误、语法错误等）：
[TOOL:get_errors {}]

将重要发现写入项目记忆（.devseek/memory.md，供未来 session 使用）。
触发时机：发现架构规律、非显而易见的约定、反复出现的错误原因时主动写入：
[TOOL:memory_write {"content":"关键记录内容（100字以内）"}]

查看当前工作区 git 变更摘要（已修改/新增/已删除文件列表及 diff）：
[TOOL:get_changed_files {}]

创建目录（含父级目录，相对于工作区根或绝对路径）：
[TOOL:create_directory {"path":"src/utils/helpers"}]

获取网页内容（用于查阅文档、API 参考、错误信息等；仅支持 http/https）：
[TOOL:fetch_webpage {"url":"https://example.com/docs"}]

查找某个符号（函数/类/变量/接口）在整个代码库中的所有引用位置（使用语言服务器语义分析，比 grep 更精确；可跳过注释和字符串误匹配）：
[TOOL:vscode_listCodeUsages {"symbol":"FunctionName","filePath":"src/foo.ts"}]

执行 VS Code 编辑器命令（格式化文档、整理 import、运行任务、重启类型检查等；非白名单命令需用户确认）：
[TOOL:run_vscode_command {"command":"editor.action.formatDocument"}]
[TOOL:run_vscode_command {"command":"workbench.action.tasks.runTask","args":["Build"]}]
${isSingle || isLast ? `\n状态枚举："not-started" | "in-progress" | "completed"` : ''}
${workflowHint}${mcpSection}`;
}
// ── Multi-round tool executor ─────────────────────────────────────────────────
// Handles all fake-tool dispatch: emits results via onDelta and returns
// structured result data so the agentic mini-loop can feed tool outputs back
// to the AI in the next LLM round (Copilot/Cursor style).
// Used by both single-shot analysis paths and the full agentic loop.

interface ToolLoopResult {
  taskComplete: boolean;
  /** Whether any data-fetching tool was called (triggers next AI round). */
  toolCallsMade: boolean;
  /** Combined tool outputs to inject as context for the next AI round. */
  feedbackForAI: string;
  /** task_complete.summary value, if the AI called task_complete (may be empty). */
  completeSummary?: string;
  /** True when manage_todo_list was called and ALL items have status 'completed'.
   *  Used in runAgenticLoop to break early without requiring an explicit task_complete call.
   *  Common for DeepSeek web mode where the AI delivers all tools in one response. */
  allTodosCompleted?: boolean;
  /** Last todo state supplied by manage_todo_list in this loop iteration. */
  todoItems?: TodoItem[];
  /** Whether task_complete.summary was already routed to the final assistant bubble. */
  summaryEmitted?: boolean;
  /** Terminal commands that actually ran during this tool loop iteration. */
  terminalCommands?: string[];
  /** Successful compile/run/test evidence from terminal commands. */
  terminalEvidence?: TerminalEvidence[];
  /** Files written (created or overwritten) during this tool loop iteration. */
  writtenFiles?: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}>;
}

type WrittenFileEvidence = {path: string; basename: string; linesAdded: number; linesRemoved: number; action: string};
type TerminalEvidenceKind = 'compile' | 'run' | 'test' | 'compile-run' | 'other';
type TerminalEvidence = {
  command: string;
  kind: TerminalEvidenceKind;
  ok: boolean;
  exitCode: number | null;
  outputPath?: string;
  detail?: string;
};

const CODE_FILE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.go', '.rs', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.scala',
  '.html', '.css', '.scss', '.sass', '.vue', '.svelte', '.sh', '.bash', '.zsh',
]);

function isCodeArtifactPath(filePath: string): boolean {
  return CODE_FILE_EXTENSIONS.has(nodePath.extname(filePath).toLowerCase());
}

function isInternalMemoryTodo(item: TodoItem): boolean {
  return /(?:项目记忆|智能体记忆|记忆体|memory|memory_write|写入记忆|记录.*记忆)/i.test(item.title || '');
}

function normalizeVisibleTodos(items: unknown): TodoItem[] {
  if (!Array.isArray(items)) return [];
  return (items as TodoItem[])
    .filter(item => item && typeof item.title === 'string' && item.title.trim() && !isInternalMemoryTodo(item))
    .map((item, index) => ({ ...item, id: index + 1, title: item.title.trim() }));
}

function buildEvidenceText(userPrompt: string, todos: TodoItem[]): string {
  return `${userPrompt}\n${todos.map(t => t.title).join('\n')}`.toLowerCase();
}

function requiresCodeArtifactForEvidence(text: string): boolean {
  return /(?:代码|源码|程序|脚本|实现|动画|功能实现|编写.*(?:程序|代码)|开发|component|class|function|algorithm|app|web|c\+\+|cpp|c语言|python|javascript|typescript|java|golang|rust)/i.test(text);
}

function requiresCommandEvidence(text: string): boolean {
  return /(?:编译|运行|执行|测试|验证|调试|compile|build|test|run|execute|verify)/i.test(text);
}

function requiresRunEvidence(text: string): boolean {
  return /(?:运行|执行|run|execute)/i.test(text);
}

function getMissingCompletionEvidence(
  userPrompt: string,
  todos: TodoItem[],
  writtenFiles: WrittenFileEvidence[],
  terminalEvidence: TerminalEvidence[],
): string[] {
  const text = buildEvidenceText(userPrompt, todos);
  const existingWrittenFiles = writtenFiles.filter(f => {
    try { return fs.existsSync(f.path); } catch { return false; }
  });
  const successfulEvidence = terminalEvidence.filter(e => e.ok);
  const missing: string[] = [];
  if (requiresCodeArtifactForEvidence(text) && !existingWrittenFiles.some(f => isCodeArtifactPath(f.path))) {
    missing.push('程序/代码文件');
  }
  if (requiresRunEvidence(text)) {
    const hasRunEvidence = successfulEvidence.some(e => e.kind === 'run' || e.kind === 'test' || e.kind === 'compile-run');
    if (!hasRunEvidence) missing.push('成功的程序运行结果');
  } else if (requiresCommandEvidence(text) && successfulEvidence.length === 0) {
    missing.push('成功的编译/运行/测试命令结果');
  }
  return missing;
}

function parseFormattedTerminalExitCode(output: string): number | null {
  const match = /(?:\[退出码\]|\[exitCode=)\s*(-?\d+)/i.exec(output || '');
  return match ? Number(match[1]) : null;
}

function shellTokenizeSimple(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | '' = '';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = '';
      } else if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        current += command[++i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function classifyTerminalEvidenceCommand(command: string): TerminalEvidenceKind {
  const c = command.trim();
  const lower = c.toLowerCase();
  const compileLike = /\b(?:g\+\+|gcc|clang\+\+|clang|cmake|make|ninja)\b/.test(lower)
    || /\b(?:npm|pnpm|yarn|bun)\s+run\s+(?:build|compile)\b/.test(lower)
    || /\bcargo\s+build\b|\bgo\s+build\b|\bdotnet\s+build\b/.test(lower);
  const testLike = /\b(?:npm|pnpm|yarn|bun)\s+(?:test|run\s+test)\b/.test(lower)
    || /\b(?:pytest|go\s+test|cargo\s+test|dotnet\s+test|ctest)\b/.test(lower);
  const runLike = /(?:^|[;&|]\s*)(?:\.\/|\/)[^\s;&|]+/.test(c)
    || /\b(?:python3?|node|java|cargo\s+run|go\s+run|dotnet\s+run)\b/.test(lower);
  if (compileLike && runLike) return 'compile-run';
  if (testLike) return 'test';
  if (runLike) return 'run';
  if (compileLike) return 'compile';
  return 'other';
}

function resolveCompilerOutputPath(command: string, workdir: string): string | undefined {
  const tokens = shellTokenizeSimple(command);
  const compilerIndex = tokens.findIndex(t => /^(?:g\+\+|gcc|clang\+\+|clang)(?:-\d+)?$/.test(nodePath.basename(t)));
  if (compilerIndex < 0) return undefined;
  const compilerArgs = tokens.slice(compilerIndex + 1);
  if (compilerArgs.some(t => t === '-c' || t === '-S' || t === '-E' || t === '-fsyntax-only')) return undefined;

  let output = '';
  for (let i = 0; i < compilerArgs.length; i++) {
    const token = compilerArgs[i];
    if (token === '-o' && compilerArgs[i + 1]) {
      output = compilerArgs[i + 1];
      break;
    }
    if (token.startsWith('-o') && token.length > 2) {
      output = token.slice(2);
      break;
    }
  }
  if (!output) output = 'a.out';
  if (!output || output.startsWith('-')) return undefined;
  return nodePath.isAbsolute(output) ? output : nodePath.resolve(workdir || process.cwd(), output);
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function analyzeTerminalEvidence(command: string, formattedOutput: string, workdir: string): { ran: boolean; evidence: TerminalEvidence } {
  const exitCode = parseFormattedTerminalExitCode(formattedOutput);
  const kind = classifyTerminalEvidenceCommand(command);
  const notExecuted = /(?:命令未执行|用户拒绝|未确认|not executed|declined|denied|timeout)/i.test(formattedOutput || '');
  let ok = !notExecuted && exitCode === 0;
  let detail = notExecuted ? '命令没有实际执行' : exitCode === null ? '终端结果缺少退出码' : undefined;
  const outputPath = resolveCompilerOutputPath(command, workdir);
  if (ok && outputPath && !isExecutableFile(outputPath)) {
    ok = false;
    detail = `编译命令退出码为 0，但未找到可执行产物：${outputPath}`;
  }
  return {
    ran: !notExecuted && exitCode !== null,
    evidence: {
      command,
      kind,
      ok,
      exitCode,
      ...(outputPath ? { outputPath } : {}),
      ...(detail ? { detail } : {}),
    },
  };
}

function markMissingEvidenceTodosIncomplete(todos: TodoItem[], missing: string[]): TodoItem[] {
  if (!todos.length || !missing.length) return todos;
  const needsCode = missing.some(m => m.includes('代码') || m.includes('程序'));
  const needsCommand = missing.some(m => m.includes('编译') || m.includes('运行') || m.includes('测试') || m.includes('成功'));
  let firstMissing = true;
  return todos.map(item => {
    const title = item.title.toLowerCase();
    const matchesCode = needsCode && /(?:代码|源码|程序|脚本|实现|动画|开发)/i.test(title);
    const matchesCommand = needsCommand && /(?:编译|运行|执行|测试|验证|调试|compile|build|test|run)/i.test(title);
    if (!matchesCode && !matchesCommand) return item;
    const status = firstMissing ? 'in-progress' as const : 'not-started' as const;
    firstMissing = false;
    return { ...item, status };
  });
}

function inferInitialAgenticTodos(userPrompt: string): TodoItem[] {
  const items: TodoItem[] = [];
  const needsCode = requiresCodeArtifactForEvidence(userPrompt);
  const needsCommand = requiresCommandEvidence(userPrompt) || /(?:程序|代码|动画|运行效果|效果)/i.test(userPrompt);
  if (needsCode) {
    items.push({ id: items.length + 1, title: '创建/更新代码文件', status: 'in-progress' });
  }
  if (needsCommand) {
    items.push({ id: items.length + 1, title: '编译/运行并验证结果', status: needsCode ? 'not-started' : 'in-progress' });
  }
  if (!items.length && /(?:查找|定位|分析|确认|排查|检查)/i.test(userPrompt)) {
    items.push({ id: 1, title: '分析并定位问题', status: 'in-progress' });
  }
  return items;
}

function normalizeGeneratedArtifactPathForAgent(rawPath: string, userPrompt: string): string {
  const p = (rawPath || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || nodePath.isAbsolute(p)) return p;
  if (promptRequestsCodeDirectory(userPrompt) && isCodeArtifactPath(p)) {
    const base = nodePath.posix.basename(p);
    if (p.startsWith('code/')) return p;
    if (base && base !== '.' && base !== '..') return `code/${base}`;
  }
  return p;
}

function promptRequestsCodeDirectory(userPrompt: string): boolean {
  return /(?:code\s*目录|code目录|code\/|code\s+dir|code\s+folder)/i.test(userPrompt);
}

function promptLooksLikeCppProgram(userPrompt: string): boolean {
  return /(?:c\+\+|cpp|\.cpp\b|\.cc\b|\.cxx\b|C\+\+)/i.test(userPrompt);
}

function promptLooksLikeCProgram(userPrompt: string): boolean {
  return /(?:\bC\b|C语言|c程序|\.c\b)/i.test(userPrompt) && !promptLooksLikeCppProgram(userPrompt);
}

function contentLooksLikeCProgram(content: string): boolean {
  return /#include\s*</.test(content) && /\bmain\s*\(/.test(content) && !contentLooksLikeCppProgram(content);
}

function contentLooksLikeCppProgram(content: string): boolean {
  return /#include\s*<(?:iostream|vector|string|map|memory|algorithm|GL\/glut|GLFW|SFML)|\bstd::|using\s+namespace\s+std|class\s+\w+/i.test(content);
}

function defaultCodeArtifactBasename(userPrompt: string): string {
  return /(?:三维|3d|3D|OpenGL|GLUT|动画世界)/i.test(userPrompt) ? '3d_world' : 'main';
}

function normalizeExplicitFileWritePathForAgent(rawPath: string, userPrompt: string, content: string): { path: string; note?: string } {
  let p = (rawPath || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) return { path: p };
  const original = p;
  if (promptRequestsCodeDirectory(userPrompt) && (isCodeArtifactPath(p) || p.endsWith('/') || p === 'code' || !nodePath.posix.extname(p))) {
    const wantsCpp = promptLooksLikeCppProgram(userPrompt) || contentLooksLikeCppProgram(content);
    const wantsC = !wantsCpp && (promptLooksLikeCProgram(userPrompt) || contentLooksLikeCProgram(content));
    const ext = wantsCpp ? '.cpp' : wantsC ? '.c' : (nodePath.posix.extname(p) || '.txt');
    if (p.endsWith('/') || p === 'code') {
      p = `code/${defaultCodeArtifactBasename(userPrompt)}${ext}`;
    } else if (!nodePath.posix.extname(p)) {
      p = p.includes('/') ? `code/${nodePath.posix.basename(p)}${ext}` : `code/${p}${ext}`;
    } else if (isCodeArtifactPath(p) && !p.startsWith('code/')) {
      p = `code/${nodePath.posix.basename(p)}`;
    } else if (wantsCpp && !/\.(?:cpp|cc|cxx|hpp|h)$/i.test(p)) {
      p = `code/${nodePath.posix.basename(p).replace(/\.[^/.]+$/, '')}.cpp`;
    } else if (wantsC && !/\.(?:c|h)$/i.test(p)) {
      p = `code/${nodePath.posix.basename(p).replace(/\.[^/.]+$/, '')}.c`;
    }
  } else {
    p = normalizeGeneratedArtifactPathForAgent(p, userPrompt);
  }
  return p === original ? { path: p } : { path: p, note: `路径“${original}”不满足当前任务的源码文件要求，已纠正为“${p}”` };
}

function isInsideWorkspace(absPath: string, workspaceRoot: string): boolean {
  const rel = nodePath.relative(workspaceRoot, absPath);
  return rel === '' || (!!rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isLikelyWritableFilePathForAgent(filePath: string): boolean {
  const normalized = (filePath || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return false;
  const base = nodePath.posix.basename(normalized);
  if (['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base)) return true;
  return /\.[A-Za-z0-9]+$/.test(base);
}

function inferCArtifactFromMarkdown(text: string, userPrompt: string): Array<{path: string; content: string}> {
  const wantsCpp = promptLooksLikeCppProgram(userPrompt);
  const wantsC = !wantsCpp && promptLooksLikeCProgram(userPrompt);
  if (!wantsCpp && !wantsC) return [];
  const blockRe = /```(?:c|cpp|cxx|cc|c\+\+)\s*\n([\s\S]*?)```/gi;
  const results: Array<{path: string; content: string}> = [];
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const content = (m[1] || '').trim();
    if (!/#include\s*</.test(content) || !/\bmain\s*\(/.test(content)) continue;
    if (wantsCpp && !contentLooksLikeCppProgram(content) && !/(?:c\+\+|cpp|cxx|cc)/i.test(m[0].slice(0, 24))) continue;
    const before = text.slice(Math.max(0, m.index - 400), m.index);
    const pathMatch = before.match(/([A-Za-z0-9_./-]+\.(?:c|cc|cpp|cxx))\b/g);
    const ext = wantsCpp ? '.cpp' : '.c';
    const path = pathMatch?.[pathMatch.length - 1] || `code/${defaultCodeArtifactBasename(userPrompt)}${ext}`;
    results.push({ path: normalizeGeneratedArtifactPathForAgent(path, userPrompt), content });
  }
  return results;
}

/** Normalizes a terminal command to a stable dedup key for stuck-loop detection. */
function makeTerminalCmdSignature(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ').slice(0, 120);
}

/** Returns targeted guidance when the AI repeats the same terminal command. */
function getLoopBreakFeedback(cmd: string): string {
  const c = cmd.trimStart();
  if (/^ls[\s-]|^ls$/.test(c)) {
    return '停止反复用 ls 检查文件。文件不存在 → 直接调用 create_file 写入完整内容；文件存在 → 直接读取或编译，不要再 ls 了。';
  }
  if (/^cat\s/.test(c)) {
    return '停止反复 cat 读文件。内容不对 → 直接调用 create_file 重写；内容正确 → 直接进行下一步，不要再 cat 了。';
  }
  if (/\bg\+\+\b|\bgcc\b/.test(cmd)) {
    return '编译命令多次失败。请先用 read_file 确认源文件内容，内容有误则先用 create_file 修正，再尝试编译。';
  }
  return '相同命令已重复多次没有进展，请改变策略：直接调用 create_file 写入目标文件的完整内容。';
}

function getStringInput(input: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string') return value.trim();
  }
  return '';
}

function getFileContentInput(input: Record<string, unknown>): string {
  for (const key of ['content', 'contents', 'text', 'body']) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function cleanShellTarget(raw: string): string {
  return raw.trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/^\$?{?workspaceRoot}?\//, '')
    .replace(/^\$?{?workspaceFolder}?\//, '');
}

function isSourceLikeShellTarget(target: string): boolean {
  const base = nodePath.posix.basename(target.replace(/\\/g, '/'));
  if (!base) return false;
  if (['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base)) return true;
  return /\.(?:c|cc|cpp|cxx|h|hpp|ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|sh|bash|zsh|sql|vue|svelte|html|css|scss|json|md|txt)$/i.test(base);
}

function detectShellFileWriteCommand(cmd: string): string | undefined {
  const patterns: RegExp[] = [
    /\bcat\s*>\s*([^\s;&|]+)/i,
    /\b(?:printf|echo)\b[\s\S]*?(?<!\d)>{1,2}\s*([^\s;&|]+)/i,
    /\btee\s+(?:-a\s+)?([^\s;&|]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(cmd);
    if (!match) continue;
    const target = cleanShellTarget(match[1] || '');
    if (target && isSourceLikeShellTarget(target)) return target;
  }
  return undefined;
}

function getTerminalRecoveryProtocol(cmd: string, attempt: number): string {
  const sig = makeTerminalCmdSignature(cmd);
  return [
    `【循环检测 / Copilot式恢复】终端命令 "${sig.slice(0, 90)}" 已在没有文件改动进展的情况下第 ${attempt} 次出现，系统已跳过本次重复执行。`,
    getLoopBreakFeedback(cmd),
    `下一轮必须按以下顺序处理，禁止再次执行同一命令直到完成根因修复：`,
    `1. 根因分析：基于上一轮终端输出指出真正失败原因，不要只说“重试”。`,
    `2. 证据收集：使用 read_file / grep_search / get_errors 查看相关源码、配置或诊断。`,
    `3. 修复动作：使用 create_file / write_file 或 SEARCH/REPLACE 实际修改错误位置；如果根因是命令参数错误，则改用正确命令。`,
    `4. 验证：只有在完成修复动作或换成正确命令后，才允许 run_terminal 编译/运行/测试。`,
    `完成报告必须说明根因、修复文件/命令、验证结果。`,
  ].join('\n');
}

/** Maps a FakeTool to {kind, label} for early streaming activity display (shown before execution). */
function toolCallToEarlyActivity(tool: FakeTool): { kind: string; label: string } | null {
  const inp = tool.input as Record<string, unknown>;
  switch (tool.name) {
    case 'run_terminal': {
      const cmd = String(inp.command ?? inp.cmd ?? '').trim().slice(0, 60);
      return { kind: 'terminal', label: cmd };
    }
    case 'create_file':
    case 'write_file':
    case 'replace_file': {
      const p = String(inp.path ?? inp.filePath ?? '').trim();
      return { kind: 'write', label: p };
    }
    case 'read_file': {
      const p = String(inp.path ?? inp.filePath ?? '').trim();
      return { kind: 'read', label: p };
    }
    case 'list_dir': {
      const p = String(inp.path ?? inp.dirPath ?? '').trim();
      return { kind: 'list', label: p || '.' };
    }
    case 'grep_search': {
      const q = String(inp.query ?? inp.pattern ?? inp.includePattern ?? '').trim().slice(0, 50);
      return { kind: 'search', label: q };
    }
    case 'manage_todo_list':
    case 'task_complete':
      return null;
    default:
      return { kind: 'terminal', label: tool.name };
  }
}

async function applyMarkdownFileArtifactsForLoop(
  text: string,
  userPrompt: string,
  workspaceRoot: string,
  callbacks: AgentLoopCallbacks,
): Promise<{ feedbackForAI: string; writtenFiles: WrittenFileEvidence[] }> {
  const parsed = parseGeneratedArtifacts(text)
    .filter((artifact): artifact is Extract<ReturnType<typeof parseGeneratedArtifacts>[number], { type: 'file' }> => artifact.type === 'file')
    .map(artifact => ({ path: normalizeGeneratedArtifactPathForAgent(artifact.path, userPrompt), content: artifact.content }));
  const inferred = parsed.length > 0 ? [] : inferCArtifactFromMarkdown(text, userPrompt);
  const candidates = parsed.length > 0 ? parsed : inferred;
  const feedback: string[] = [];
  const writtenFiles: WrittenFileEvidence[] = [];
  const seen = new Set<string>();

  for (const artifact of candidates) {
    if (!artifact.path || !artifact.content.trim()) continue;
    if (!isLikelyWritableFilePathForAgent(artifact.path)) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（目标是目录或缺少文件名）`);
      continue;
    }
    const absPath = nodePath.isAbsolute(artifact.path)
      ? artifact.path
      : nodePath.join(workspaceRoot, artifact.path);
    const resolvedRoot = nodePath.resolve(workspaceRoot);
    const resolvedAbs = nodePath.resolve(absPath);
    if (!resolvedAbs.startsWith(resolvedRoot + nodePath.sep) && resolvedAbs !== resolvedRoot) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（路径在工作区外）`);
      continue;
    }
    if (seen.has(resolvedAbs)) continue;
    seen.add(resolvedAbs);
    try {
      if (fs.existsSync(resolvedAbs) && fs.statSync(resolvedAbs).isDirectory()) {
        feedback.push(`[generated_file: ${artifact.path}] 跳过（目标是目录）`);
        continue;
      }
    } catch { /* allow normal write path to report errors */ }
    if (callbacks.onBeforeFileWrite) {
      const allowed = await callbacks.onBeforeFileWrite(resolvedAbs);
      if (!allowed) {
        feedback.push(`[generated_file: ${artifact.path}] 跳过（敏感文件保护）`);
        continue;
      }
    }
    callbacks.onToolActivity?.('write', artifact.path);
    const existed = fs.existsSync(resolvedAbs);
    const oldContent = existed ? fs.readFileSync(resolvedAbs, 'utf8') : '';
    const dir = nodePath.dirname(resolvedAbs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(resolvedAbs, artifact.content, 'utf8');
    await callbacks.onAppliedChange({ path: resolvedAbs, existed, oldContent, newContent: artifact.content });
    const newLines = artifact.content.split('\n').length;
    const oldLines = oldContent ? oldContent.split('\n').length : 0;
    writtenFiles.push({
      path: resolvedAbs,
      basename: nodePath.basename(resolvedAbs),
      linesAdded: newLines,
      linesRemoved: oldLines,
      action: existed ? 'modify' : 'create',
    });
    feedback.push(`[generated_file: ${artifact.path}] 已写入 (${newLines} 行)`);
  }

  return { feedbackForAI: feedback.join('\n'), writtenFiles };
}

async function executeFakeToolsForLoop(
  tools: FakeTool[],
  callbacks: AgentLoopCallbacks,
  defaultWorkdir?: string,
  taskContext?: { currentTaskIndex: number; taskTotal: number; deferDoneStatus?: boolean; requireWorkBeforeComplete?: boolean; userPrompt?: string },
): Promise<ToolLoopResult> {
  let taskComplete = false;
  let toolCallsMade = false;
  let completeSummary: string | undefined;
  let allTodosCompleted = false;
  const parts: string[] = [];
  const writtenFiles: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}> = [];
  const terminalCommands: string[] = [];
  const terminalEvidence: TerminalEvidence[] = [];
  let deferredCompletedTodoItems: TodoItem[] | undefined;
  let lastTodoItems: TodoItem[] | undefined;
  let summaryEmitted = false;
  // Track consecutive file-write failures per path so feedback can stay specific
  // without steering the model into shell redirection as a write fallback.
  const createFileFailCounts = new Map<string, number>();

  // isLastTask: only the final task should emit phase:done and onTaskComplete.
  // For intermediate tasks the orchestrator (runAgentLoop) drives sequencing; side-
  // effects are suppressed here to prevent premature "done" state in the UI.
  // This is the Copilot/Claude Code pattern: orchestrator owns task-sequence state,
  // not the model.
  const isLastTask = !taskContext || taskContext.currentTaskIndex >= taskContext.taskTotal;

  for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
    const tool = tools[toolIndex];
    if (tool.name === 'manage_todo_list' && callbacks.onTodoUpdate) {
      let items = normalizeVisibleTodos((tool.input.todoList ?? []) as TodoItem[]);
      if (Array.isArray(items)) {
        // Treat todo updates as a real tool action so the loop continues.
        // Some models emit planning-only manage_todo_list in round-1, then
        // emit create/edit tools in round-2 after receiving tool feedback.
        toolCallsMade = true;
        // ARCHITECTURAL GUARD (mirrors Copilot/Claude Code API-level enforcement):
        // The orchestrator owns task-sequence state. AI may never pre-emptively mark
        // future tasks as completed — clamp any such items back to 'not-started'.
        if (taskContext) {
          items = items.map((item) =>
            typeof item.id === 'number' && item.id > taskContext.currentTaskIndex && item.status === 'completed'
              ? { ...item, status: 'not-started' as const }
              : item,
          );
        }
        // Detect implicit completion: all items are 'completed' → AI is done.
        const todoUpdateIsAllCompleted = items.length > 0 && items.every(it => it.status === 'completed');
        const hasLaterWorkTools = tools.slice(toolIndex + 1).some(t => !['manage_todo_list', 'task_complete', 'memory_write'].includes(t.name));
        callbacks.onToolActivity?.('todo', items.map(i => i.title).filter(Boolean).slice(0, 3).join('、') || '更新任务清单');
        if (todoUpdateIsAllCompleted && (hasLaterWorkTools || taskContext?.requireWorkBeforeComplete)) {
          deferredCompletedTodoItems = items;
        } else {
          await callbacks.onTodoUpdate(items);
        }
        if (todoUpdateIsAllCompleted) {
          allTodosCompleted = true;
        }
        lastTodoItems = items;
        // Re-inject todo state into next round's context (mirrors Copilot's
        // getCurrentTodoContext() — explicit state beats relying on AI memory alone,
        // especially after context-window truncation strips early manage_todo_list messages).
        parts.push(`[manage_todo_list] 任务清单已更新：\n${items.map(i => `${i.id}. [${i.status}] ${i.title}`).join('\n')}`);
      }
    } else if (tool.name === 'task_complete') {
      const summary = typeof tool.input.summary === 'string' ? tool.input.summary : '';
      completeSummary = summary;
      const visibleSummary = cleanAgentFinalSummaryForUser(summary);
      // G-analy-feedback: Stream substantial summaries via ASUM prefix so analysis
      // conclusions are visible even when AI puts all analysis in task_complete rather
      // than inline streaming prose. Webview routes ASUM to currentRaw → prose bubble.
      if (visibleSummary.length > 20 && !taskContext?.requireWorkBeforeComplete) {
        callbacks.onDelta('\x00ASUM\x00' + visibleSummary);
        summaryEmitted = true;
      }
      // Only fire done-phase UI + onTaskComplete for the final task. For intermediate
      // tasks the outer runAgentLoop manages progression — no premature phase:done.
      if (isLastTask && !taskContext?.deferDoneStatus) {
        if (callbacks.onTaskComplete) { await callbacks.onTaskComplete(summary); }
        await callbacks.onAgentStatus({
          type: 'agentStatus', phase: 'done', state: 'completed',
          title: visibleSummary || '任务已完成',
          ...(writtenFiles.length > 0 ? { editedFiles: writtenFiles } : {}),
        });
      }
      taskComplete = true;
    } else if (tool.name === 'run_terminal' && callbacks.onTerminalCommand) {
      const command = typeof tool.input.command === 'string' ? tool.input.command.trim() : '';
      // Use AI-specified workdir first; fall back to task directory so binaries land
      // in the correct subdirectory (code/) rather than the workspace root.
      const workdir = typeof tool.input.workdir === 'string' ? tool.input.workdir : defaultWorkdir;
      if (command) {
        toolCallsMade = true;
        const shellWriteTarget = detectShellFileWriteCommand(command);
        if (shellWriteTarget) {
          const msg = [
            `[run_terminal: ${command}] 已阻止`,
            `检测到通过 shell 重定向/tee 写入源码文件：${shellWriteTarget}`,
            `请改用 create_file 或 write_file，并把完整文件内容放入 content 字段。run_terminal 仅用于编译、运行、测试、查询。`,
          ].join('\n');
          callbacks.onToolActivity?.('terminal', `阻止 shell 写文件: ${nodePath.basename(shellWriteTarget)}`);
          parts.push(msg);
          continue;
        }
        callbacks.onToolActivity?.('terminal', command);
        try {
          const output = await callbacks.onTerminalCommand(command, workdir);
          const evidenceResult = analyzeTerminalEvidence(command, output, workdir ?? defaultWorkdir ?? workspaceRoot);
          if (evidenceResult.ran) {
            terminalCommands.push(command);
          }
          if (evidenceResult.evidence.kind !== 'other') {
            terminalEvidence.push(evidenceResult.evidence);
          }
          // Silent: output goes to AI context only (shown in Working box via terminalRanNotice)
          parts.push(`[run_terminal: ${command}]\n${output}`);
          if (evidenceResult.evidence.kind !== 'other' && !evidenceResult.evidence.ok) {
            parts.push(
              `[terminal_evidence]\n` +
              `验证命令未通过，不能把编译/运行/测试标记为完成。\n` +
              `kind=${evidenceResult.evidence.kind} exitCode=${evidenceResult.evidence.exitCode ?? 'unknown'}\n` +
              `${evidenceResult.evidence.detail ?? '请根据终端输出修复后重新验证。'}`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[run_terminal: ${command}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'read_file' && callbacks.onReadFile) {
      const filePath = typeof tool.input.path === 'string' ? tool.input.path.trim() : '';
      if (filePath) {
        toolCallsMade = true;
        try {
          // Pass defaultWorkdir so bare filenames like "main.cpp" resolve relative to
          // the current task's directory first (Copilot/Claude Code: tool calls inherit
          // task working directory context, not just workspace root).
          const content = await callbacks.onReadFile(filePath, defaultWorkdir);
          callbacks.onToolActivity?.('read', filePath);
          // Silent: file content goes to AI context only (shown as chip in Working box)
          parts.push(`[read_file: ${filePath}]\n${content}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[read_file: ${filePath}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'grep_search' && callbacks.onGrepSearch) {
      const pattern = typeof tool.input.pattern === 'string' ? tool.input.pattern : '';
      const searchPath = typeof tool.input.path === 'string' ? tool.input.path : undefined;
      const isRegexp = tool.input.isRegexp !== false;
      if (pattern) {
        toolCallsMade = true;
        try {
          const results = await callbacks.onGrepSearch(pattern, searchPath, isRegexp, defaultWorkdir);
          callbacks.onToolActivity?.('search', searchPath ? `"${pattern}" in ${searchPath}` : `"${pattern}"`);
          // Silent: search results go to AI context only
          parts.push(`[grep_search: "${pattern}"${searchPath ? ` in ${searchPath}` : ''}]\n${results}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[grep_search: "${pattern}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'list_dir' && callbacks.onListDir) {
      const p = typeof tool.input.path === 'string' ? tool.input.path : '.';
      toolCallsMade = true;
      try {
        const listing = await callbacks.onListDir(p);
        callbacks.onToolActivity?.('list', p);
        // Silent: directory listing goes to AI context only
        parts.push(`[list_dir: ${p}]\n${listing}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts.push(`[list_dir: ${p}] 错误: ${msg}`);
      }
    } else if (tool.name === 'get_errors' && callbacks.onGetErrors) {
      toolCallsMade = true;
      try {
        const errors = await callbacks.onGetErrors();
        // Silent: errors go to AI context only
        parts.push(`[get_errors]\n${errors}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts.push(`[get_errors] 错误: ${msg}`);
      }
    } else if (tool.name === 'file_search' && callbacks.onFileSearch) {
      const glob = typeof (tool.input as Record<string, unknown>)?.glob === 'string'
        ? (tool.input as Record<string, string>).glob.trim()
        : typeof (tool.input as Record<string, unknown>)?.pattern === 'string'
          ? (tool.input as Record<string, string>).pattern.trim()
          : '';
      if (glob) {
        toolCallsMade = true;
        try {
          const results = await callbacks.onFileSearch(glob);
          callbacks.onToolActivity?.('search', `glob:${glob}`);
          // Silent: file list goes to AI context only
          parts.push(`[file_search: "${glob}"]\n${results}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[file_search: "${glob}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'semantic_search' && callbacks.onGrepSearch) {
      // Semantic search: no embeddings available, fall back to keyword OR-grep across workspace.
      // Extract significant tokens from the query (skip short stop words).
      const query = typeof (tool.input as Record<string, unknown>)?.query === 'string'
        ? (tool.input as Record<string, string>).query.trim()
        : '';
      if (query) {
        toolCallsMade = true;
        try {
          // Build an OR-pattern from significant words (>3 chars) to cast a wide net.
          const words = query
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 3)
            .slice(0, 6);
          const pattern = words.length > 0 ? words.join('|') : query.slice(0, 100);
          const results = await callbacks.onGrepSearch(pattern, undefined, true, defaultWorkdir);
          callbacks.onToolActivity?.('search', `semantic:"${query.slice(0, 50)}"`);
          // Silent: search results go to AI context only
          parts.push(`[semantic_search: "${query}"]\n${results}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[semantic_search: "${query}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'memory_write' && callbacks.onMemoryWrite) {
      const content = typeof (tool.input as Record<string, unknown>)?.content === 'string'
        ? (tool.input as Record<string, string>).content.slice(0, 500)
        : '';
      if (content) {
        try {
          await callbacks.onMemoryWrite(content);
          parts.push(`[memory_write] 已写入记忆：${content.slice(0, 80)}`);
          // Route to tool-activity (Working box), NOT to chat text
          callbacks.onToolActivity?.('memory', `记忆已保存: ${content.slice(0, 60)}`);
        } catch (err) {
          parts.push(`[memory_write] 失败：${(err as Error).message}`);
        }
      }
    } else if ((tool.name === 'create_file' || tool.name === 'write_file' || tool.name === 'replace_file') && callbacks.onAppliedChange) {
      // Unified file create/overwrite — works for new files AND full rewrites.
      // Matching Copilot's #edit/editFiles for the agentic free-explore loop.
      const rawPath = getStringInput(tool.input, ['path', 'filePath', 'filepath', 'filename', 'targetPath']);
      const content = getFileContentInput(tool.input);
      toolCallsMade = true;
      if (!rawPath) {
        parts.push(`[${tool.name}] 错误: 缺少 path/filePath，未写入任何文件。请提供目标文件路径和完整 content。`);
        continue;
      }
      if (rawPath) {
        callbacks.onToolActivity?.('write', rawPath);
        try {
          const taskPrompt = taskContext?.userPrompt ?? '';
          const normalized = normalizeExplicitFileWritePathForAgent(rawPath, taskPrompt, content);
          if (normalized.note) parts.push(`[${tool.name}: ${rawPath}] 诊断: ${normalized.note}`);
          if (!content && requiresCodeArtifactForEvidence(taskPrompt)) {
            parts.push(`[${tool.name}: ${rawPath}] 错误: content 为空，不能创建空源码文件。请提供完整文件内容。`);
            continue;
          }
          if (looksLikeRawToolCallText(content)) {
            parts.push(`[${tool.name}: ${rawPath}] 错误: content 是工具调用文本，不是文件内容，已阻止写入。请只把目标文件源码放入 content。`);
            continue;
          }
          const targetPath = normalized.path;
          const absPath = nodePath.isAbsolute(targetPath)
            ? targetPath
            : nodePath.join(defaultWorkdir ?? '', targetPath);
          if (defaultWorkdir && !isInsideWorkspace(absPath, defaultWorkdir)) {
            parts.push(`[${tool.name}: ${rawPath}] 错误: 目标路径不在工作区内，已阻止写入：${absPath}`);
            continue;
          }
          if (callbacks.onBeforeFileWrite) {
            const allowed = await callbacks.onBeforeFileWrite(absPath);
            if (!allowed) {
              parts.push(`[${tool.name}: ${rawPath}] 跳过（敏感文件保护）`);
              continue;
            }
          }
          const existed = fs.existsSync(absPath);
          if (existed && fs.statSync(absPath).isDirectory()) {
            parts.push(`[${tool.name}: ${rawPath}] 错误: 目标是目录，不是文件：${absPath}`);
            continue;
          }
          const oldContent = existed ? fs.readFileSync(absPath, 'utf8') : '';
          const dir = nodePath.dirname(absPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(absPath, content, 'utf8');
          const stat = fs.statSync(absPath);
          if (!stat.isFile() || stat.size === 0) {
            const failN = (createFileFailCounts.get(rawPath) || 0) + 1;
            createFileFailCounts.set(rawPath, failN);
            let errMsg = `[${tool.name}: ${rawPath}] 错误: 写入后校验失败（不是有效文件或文件为空）：${absPath}`;
            if (failN >= 2) errMsg += `\n请不要改用 run_terminal 写文件；继续使用 create_file/write_file，并检查 path 与 content 是否正确。`;
            parts.push(errMsg);
            continue;
          }
          await callbacks.onAppliedChange({ path: absPath, existed, oldContent, newContent: content });
          const newLines = content.split('\n').length;
          const oldLines = oldContent ? oldContent.split('\n').length : 0;
          writtenFiles.push({
            path: absPath,
            basename: nodePath.basename(absPath),
            linesAdded: newLines,
            linesRemoved: oldLines,
            action: existed ? 'modify' : 'create',
          });
          parts.push(`[${tool.name}: ${rawPath}] 已写入 ${nodePath.relative(defaultWorkdir ?? nodePath.dirname(absPath), absPath).replace(/\\/g, '/')} (${newLines} 行)`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const code = typeof err === 'object' && err && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
          if ((code === 'EACCES' || code === 'EPERM') && callbacks.onTerminalCommand) {
            const normalized = normalizeExplicitFileWritePathForAgent(rawPath, taskContext?.userPrompt ?? '', content);
            const absPath = nodePath.isAbsolute(normalized.path) ? normalized.path : nodePath.join(defaultWorkdir ?? '', normalized.path);
            const dir = nodePath.dirname(absPath);
            callbacks.onToolActivity?.('terminal', `请求修复写入权限: ${nodePath.basename(dir)}`);
            const repair = await callbacks.onTerminalCommand(`chmod u+w ${shellQuote(dir)}`, defaultWorkdir);
            parts.push(`[${tool.name}: ${rawPath}] 权限不足: ${msg}\n[permission_repair]\n${repair}`);
          } else {
            const failN = (createFileFailCounts.get(rawPath) || 0) + 1;
            createFileFailCounts.set(rawPath, failN);
            let errMsg = `[${tool.name}: ${rawPath}] 错误: ${msg}`;
            if (failN >= 2) errMsg += `\n请不要改用 run_terminal 写文件；继续使用 create_file/write_file，并检查 path/filePath、content 和目标目录。`;
            parts.push(errMsg);
          }
        }
      }
    } else if (tool.name === 'get_changed_files' && callbacks.onGetChangedFiles) {
      toolCallsMade = true;
      try {
        const result = await callbacks.onGetChangedFiles();
        callbacks.onToolActivity?.('search', 'git changes');
        parts.push(`[get_changed_files]\n${result}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts.push(`[get_changed_files] 错误: ${msg}`);
      }
    } else if (tool.name === 'create_directory' && callbacks.onCreateDirectory) {
      const dirPath = typeof (tool.input as Record<string, unknown>).path === 'string'
        ? (tool.input as Record<string, string>).path.trim()
        : '';
      if (dirPath) {
        toolCallsMade = true;
        callbacks.onToolActivity?.('write', `mkdir ${dirPath}`);
        try {
          const result = await callbacks.onCreateDirectory(dirPath);
          parts.push(`[create_directory: ${dirPath}] ${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[create_directory: ${dirPath}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'fetch_webpage' && callbacks.onFetchWebpage) {
      const url = typeof (tool.input as Record<string, unknown>).url === 'string'
        ? (tool.input as Record<string, string>).url.trim()
        : '';
      if (url) {
        toolCallsMade = true;
        callbacks.onToolActivity?.('web', url.replace(/^https?:\/\//, '').slice(0, 60));
        try {
          const result = await callbacks.onFetchWebpage(url);
          parts.push(`[fetch_webpage: ${url}]\n${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[fetch_webpage: ${url}] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'vscode_listCodeUsages' && callbacks.onListCodeUsages) {
      const symbol = typeof (tool.input as Record<string, unknown>).symbol === 'string'
        ? (tool.input as Record<string, string>).symbol.trim()
        : '';
      const filePath = typeof (tool.input as Record<string, unknown>).filePath === 'string'
        ? (tool.input as Record<string, string>).filePath.trim()
        : undefined;
      if (symbol) {
        toolCallsMade = true;
        callbacks.onToolActivity?.('search', `refs:${symbol}`);
        try {
          const result = await callbacks.onListCodeUsages(symbol, filePath);
          parts.push(`[vscode_listCodeUsages: "${symbol}"]\n${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[vscode_listCodeUsages: "${symbol}"] 错误: ${msg}`);
        }
      }
    } else if (tool.name === 'run_vscode_command' && callbacks.onRunVscodeCommand) {
      const command = typeof (tool.input as Record<string, unknown>).command === 'string'
        ? (tool.input as Record<string, string>).command.trim()
        : '';
      const args = Array.isArray((tool.input as Record<string, unknown>).args)
        ? (tool.input as Record<string, unknown[]>).args
        : undefined;
      if (command) {
        toolCallsMade = true;
        callbacks.onToolActivity?.('terminal', `⚡ ${command}`);
        try {
          const result = await callbacks.onRunVscodeCommand(command, args);
          parts.push(`[run_vscode_command: ${command}]\n${result}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          parts.push(`[run_vscode_command: ${command}] 错误: ${msg}`);
        }
      }
    } else if (tool.name.startsWith('mcp__') && callbacks.onMcpToolCall) {
      toolCallsMade = true;
      try {
        const result = await callbacks.onMcpToolCall(tool.name, tool.input as Record<string, unknown>);
        // Silent: MCP result goes to AI context only
        parts.push(`[${tool.name}]\n${result}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parts.push(`[${tool.name}] 错误: ${msg}`);
        callbacks.onToolActivity?.('terminal', `❌ ${tool.name}: ${msg.slice(0, 50)}`);
      }
    }
  }

  if (deferredCompletedTodoItems && callbacks.onTodoUpdate && !taskContext?.requireWorkBeforeComplete) {
    await callbacks.onTodoUpdate(deferredCompletedTodoItems);
  }
  return {
    taskComplete,
    toolCallsMade,
    feedbackForAI: parts.join('\n\n'),
    completeSummary,
    allTodosCompleted,
    todoItems: lastTodoItems,
    summaryEmitted,
    terminalCommands: terminalCommands.length > 0 ? terminalCommands : undefined,
    terminalEvidence: terminalEvidence.length > 0 ? terminalEvidence : undefined,
    writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
  };
}

export interface AgentLoopCallbacks {
  /** Stream delta text to chat bubble */
  onDelta: (delta: string) => void;
  /** Post a workflowStatus message to the webview */
  onWorkflowStatus: (status: ApplyWorkflowStatus) => void | Promise<void>;
  /** Post an agentStatus message (new type for Working area Agent mode) */
  onAgentStatus: (status: AgentStatusMessage) => void | Promise<void>;
  /** A file was applied — register for Keep/Undo */
  onAppliedChange: (change: AppliedChangeRecord) => void | Promise<void>;
  /** Post a responseMeta message after all tasks done */
  onResponseMeta: (text: string) => void | Promise<void>;
  /**
   * L-2: AI called manage_todo_list — update the todo widget in the webview.
   * Called once per [TOOL:manage_todo_list {...}] block found in AI output.
   */
  onTodoUpdate?: (items: TodoItem[]) => void | Promise<void>;
  /** Show real model-generated bridge/progress prose in the webview. */
  onAgentAnnouncement?: (text: string) => void | Promise<void>;
  /**
   * Session checkpoint callback — called after each task completes (success or fail).
   * Extension saves the next-pending-task index to workspaceState for resume-on-reconnect.
   * Called with null for completedUpToIndex when the full loop finishes (clears checkpoint).
   */
  onTaskCheckpoint?: (completedUpToIndex: number | null, remainingTasks: AgentTask[]) => void;
  /**
   * L-3: AI called task_complete — terminate the agent loop.
   * Returns true to signal the loop should stop.
   */
  onTaskComplete?: (summary: string) => void | Promise<void>;
  /**
   * P3: AI called memory_write — append content to .devseek/memory.md.
   * Implements Claude Code’s “memory_write” tool (AI-writable persistent knowledge).
   */
  onMemoryWrite?: (content: string) => Promise<void>;
  /**
   * P3-5: AI called an MCP tool (mcp__server__tool) — route to McpManager.
   * Return the tool's text output so it can be injected back into the conversation.
   */
  onMcpToolCall?: (fakeName: string, args: Record<string, unknown>) => Promise<string>;
  /**
   * P3-5: Available MCP tools to advertise in the system prompt.
   * Populated from McpManager.toolRefs on activation.
   */
  mcpToolRefs?: McpToolRef[];
  /**
   * P4-1: AI called run_terminal — execute a shell command and return output.
   * Extension must show user confirmation if not in autopilot mode.
   * Returns the formatted terminal output string.
   */
  onTerminalCommand?: (command: string, workdir?: string) => Promise<string>;
  /**
   * P-SEC: About to write a file — return false to block the write (e.g., sensitive files).
   * Only called for SEARCH/REPLACE-path writes; full-file writes go via onAppliedChange.
   */
  onBeforeFileWrite?: (absPath: string) => Promise<boolean>;
  /**
   * P5-3: AI called read_file — return file contents (up to 8KB).
   * Path may be relative to workspace root or absolute.
   * workDir (optional): absolute path of the current task's directory — used to
   * resolve bare filenames (e.g. "main.cpp") to the correct subdirectory rather
   * than workspace root (Copilot/Claude Code: tool calls inherit task working dir).
   */
  onReadFile?: (path: string, workDir?: string) => Promise<string>;
  /**
   * AI called grep_search — search workspace files for a regex/text pattern.
   * Returns matching lines in file:line: content format.
   * workDir (optional): absolute path of the current task's directory — when the AI
   * does not pass an explicit path, search is scoped to this directory rather than
   * the entire workspace root (prevents grep_search returning noise from unrelated projects).
   */
  onGrepSearch?: (pattern: string, path?: string, isRegexp?: boolean, workDir?: string) => Promise<string>;
  /**
   * AI called list_dir — list directory contents.
   * Returns entries prefixed with [dir] or [file].
   */
  onListDir?: (path: string) => Promise<string>;
  /**
   * AI called get_errors — return current VS Code diagnostic errors.
   */
  onGetErrors?: () => Promise<string>;
  /**
   * AI called file_search — find files matching a glob pattern.
   * Returns a newline-separated list of relative file paths.
   * Corresponds to Copilot's #search/fileSearch tool.
   */
  onFileSearch?: (glob: string) => Promise<string>;
  /**
   * AI called a file/search/list/terminal tool during agent loop.
   * Shown as a compact activity chip in the working area ("Read N files ▾").
   */
  onToolActivity?: (kind: 'read' | 'search' | 'list' | 'terminal' | 'memory' | 'write' | 'web' | 'todo', label: string) => void;
  /**
   * AI called get_changed_files — return git status/diff of current workspace.
   * Corresponds to Copilot's #search/changes tool.
   */
  onGetChangedFiles?: () => Promise<string>;
  /**
   * AI called create_directory — create a directory (and parents) in workspace.
   * Corresponds to Copilot's #edit/createDirectory tool.
   */
  onCreateDirectory?: (path: string) => Promise<string>;
  /**
   * AI called fetch_webpage — fetch a URL and return text content (truncated).
   * Corresponds to Copilot's #web/fetch tool. Only http/https allowed.
   */
  onFetchWebpage?: (url: string) => Promise<string>;
  /**
   * AI called vscode_listCodeUsages — find all references to a symbol using the
   * VS Code language server (executeReferenceProvider). Falls back to grep if LSP
   * is unavailable. Corresponds to Copilot's #search/usages tool.
   */
  onListCodeUsages?: (symbol: string, filePath?: string) => Promise<string>;
  /**
   * AI called run_vscode_command — execute a VS Code command by ID.
   * Safe-listed commands execute immediately; others require user confirmation
   * unless autopilot mode is enabled. Corresponds to Copilot's #vscode/runCommand.
   */
  onRunVscodeCommand?: (command: string, args?: unknown[]) => Promise<string>;
  /**
   * User steering entered while the current agent run is active.
   * Consumed at round boundaries so the next model call treats it as an
   * incremental correction/supplement, not as a brand-new task.
   */
  onUserSteer?: () => string[];
  /**
   * AbortSignal — set from the stop button to cancel in-progress LLM calls.
   */
  signal?: AbortSignal;
  /**
   * Whether the user has autopilot mode enabled.
   * Used to scale tool-call round limits: 25 (normal) → 200 (autopilot),
   * matching Copilot's toolCallLimit behaviour.
   */
  autopilot?: boolean;
}

function consumeUserSteerMessages(callbacks: AgentLoopCallbacks): ChatMessage[] {
  const items = callbacks.onUserSteer?.() ?? [];
  return items
    .map(text => String(text || '').trim())
    .filter(Boolean)
    .map(text => ({
      role: 'user' as const,
      content: [
        '【用户实时补充/纠偏】',
        text,
        '',
        '请将以上内容作为当前任务的最新约束继续执行；如它与旧计划冲突，以这条补充为准。不要从头开启新任务，先调整 todo/后续步骤再继续。',
      ].join('\n'),
    }));
}

export interface AgentStatusMessage {
  type: 'agentStatus';
  /** Overall agent phase */
  phase: 'plan' | 'execute' | 'validate' | 'done' | 'error' | 'analyzeFile' | 'analyzeSummary';
  /** Current task being executed (undefined during plan phase) */
  taskId?: string;
  taskFile?: string;
  taskAction?: AgentTaskAction;
  taskDesc?: string;
  /** 1-based index of current task */
  taskIndex?: number;
  /** Total number of tasks */
  taskTotal?: number;
  state: 'started' | 'completed' | 'failed' | 'skipped';
  title: string;
  detail?: string;
  /** Rough count of lines added/removed — for diff badge display only */
  linesAdded?: number;
  linesRemoved?: number;
  /** G-1: planning reasoning bullet text — shown above task rows in the thinking box */
  planningText?: string;
  /** G-1: planning reasoning detail (multi-line prose) — shown in collapsible card below header */
  planningDetail?: string;
  /** Files edited during this agent run — populated in the done phase for the File Changes widget */
  editedFiles?: Array<{
    path: string;
    basename: string;
    linesAdded?: number;
    linesRemoved?: number;
    action: string;
  }>;
}

export interface AgentLoopResult {
  tasksTotal: number;
  tasksApplied: number;
  tasksFailed: number;
  changedPaths: string[];
  /** Full text of analysis output, populated when all tasks were analyze/explain.
   *  Callers can pass this to extractAnalysisFindings() and feed into next decomposeTask. */
  analysisText?: string;
}

// ----------------------------------------------------------------
// Per-task prompt builder (Editor role)
// ----------------------------------------------------------------

// ── L-1/L-4: Provider-aware chat wrapper ─────────────────────────────────────
// Replaces the old `chat()` import from bridge-client.
// Optionally prepends cross-round history to give the LLM context of what
// was already done earlier in this agent session.
// Returns { text, tools } where tools are parsed fake tool calls.

/** Multi-round agentic helper — takes a pre-built messages array instead of prompt+history. */
async function chatWithMessages(
  messages: ChatMessage[],
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  signal?: AbortSignal,
  newSession = false,
): Promise<{ text: string; tools: FakeTool[] }> {
  const provider = getActiveProvider();
  const text = await provider.chat({ messages, stream: true, onDelta, mode, signal, newSession });
  return { text, tools: parseFakeToolCalls(text) };
}

async function chatViaProvider(
  prompt: string,
  mode: 'fast' | 'r1' | undefined,
  onDelta?: (delta: string) => void,
  history?: ChatMessage[],
  signal?: AbortSignal,
  newSession = false,
): Promise<{ text: string; tools: FakeTool[] }> {
  const provider = getActiveProvider();
  const messages: ChatMessage[] = [
    ...(history ?? []),
    { role: 'user', content: prompt },
  ];
  const text = await provider.chat({ messages, stream: true, onDelta, mode, signal, newSession });
  const tools = parseFakeToolCalls(text);
  return { text, tools };
}

/** Only C/C++ files need compile validation */
function isCompilableFile(filename: string): boolean {
  return ['.cpp', '.c', '.h', '.hpp', '.cc', '.cxx'].includes(
    nodePath.extname(filename).toLowerCase(),
  );
}

/**
 * Returns true if the error is a transient network / connectivity failure
 * that can be resolved by reconnecting, rather than a permanent logic error.
 * Used to distinguish "网络断了，可以续传" from "代码有 bug，不能续传".
 */
function isNetworkError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  // fetch-level failures
  if (msg.includes('failed to fetch') || msg.includes('fetch failed')) return true;
  // Node.js / OS connection errors
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset')) return true;
  if (msg.includes('etimedout') || msg.includes('socket hang up')) return true;
  // Browser / VS Code webview network errors
  if (msg.includes('networkerror') || msg.includes('network error')) return true;
  // AbortError caused by our AbortSignal.timeout() (upstream bridge disconnect)
  // Note: user-initiated abort (stop button) has name === 'AbortError' but we
  // should NOT treat that as a network error — it was intentional. We distinguish
  // by checking if the message mentions timeout or connection.
  if (e instanceof Error && e.name === 'AbortError' && (msg.includes('timeout') || msg.includes('timed out'))) return true;
  // DeepSeek bridge-specific error strings
  if (msg.includes('login_required')) return false; // auth failure, not network
  if (msg.includes('http 502') || msg.includes('http 503') || msg.includes('http 504')) return true;
  return false;
}

// ----------------------------------------------------------------
// SEARCH/REPLACE block parser (Aider/Cursor style targeted edits)
// ----------------------------------------------------------------

interface SearchReplaceBlock {
  search: string;
  replace: string;
}

/**
 * Parse SEARCH/REPLACE blocks from LLM output.
 *
 * Expected format (one or more per response):
 *   <<<<<<< SEARCH
 *   exact code to find
 *   =======
 *   new code to replace with
 *   >>>>>>> REPLACE
 */
function parseSearchReplaceBlocks(raw: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const re = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    blocks.push({ search: match[1], replace: match[2] });
  }
  return blocks;
}

interface ApplyBlocksResult {
  result: string;
  applied: number;
  failed: number;
  errors: string[];
}

/**
 * Apply SEARCH/REPLACE blocks to file content.
 * Tries exact match first, then normalized line-endings as fallback.
 */
function applySearchReplaceBlocks(
  content: string,
  blocks: SearchReplaceBlock[],
): ApplyBlocksResult {
  let result = content;
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const block of blocks) {
    if (result.includes(block.search)) {
      // Use indexOf+slice rather than String.replace to avoid regex special chars
      const idx = result.indexOf(block.search);
      result = result.slice(0, idx) + block.replace + result.slice(idx + block.search.length);
      applied++;
    } else {
      // Normalize line endings and retry
      const norm = (s: string) => s.replace(/\r\n/g, '\n');
      const normContent = norm(result);
      const normSearch = norm(block.search);
      if (normContent.includes(normSearch)) {
        const idx2 = normContent.indexOf(normSearch);
        result = normContent.slice(0, idx2) + block.replace + normContent.slice(idx2 + normSearch.length);
        applied++;
      } else {
        failed++;
        errors.push(`未找到匹配文本: "${block.search.slice(0, 80).trim()}"`);
      }
    }
  }

  return { result, applied, failed, errors };
}

// ----------------------------------------------------------------
// Prompt builders — all include current file content
// ----------------------------------------------------------------

/**
 * Detects required compiler/linker flags from C/C++ source content.
 * Used to automatically add -lGL -lGLU -lglut etc. when the AI compiles OpenGL programs.
 */
function scanLibFlagsFromContent(content: string): string {
  const flags = new Set<string>();
  if (/^\s*#include\s+[<"][^>"]*\bGL\/(gl|glu)\.h[>"]/im.test(content))       { flags.add('-lGL'); flags.add('-lGLU'); }
  if (/^\s*#include\s+[<"][^>"]*\bGL\/(glut|freeglut)\.h[>"]/im.test(content)) { flags.add('-lglut'); flags.add('-lGL'); flags.add('-lGLU'); }
  if (/^\s*#include\s+[<"][^>"]*\bGLFW\/glfw3\.h[>"]/im.test(content))        { flags.add('-lglfw'); }
  if (/^\s*#include\s+[<"][^>"]*\bglew\.h[>"]/im.test(content))               { flags.add('-lGLEW'); }
  if (/^\s*#include\s+<(math\.h|cmath)>/im.test(content))                     { flags.add('-lm'); }
  if (/^\s*#include\s+<pthread\.h>/im.test(content))                          { flags.add('-lpthread'); }
  return [...flags].join(' ');
}

/**
 * Prompt for analyze/explain tasks: asks for text analysis, no code output.
 * Current file content is included so the LLM analyses the actual code.
 */
// G3: added taskIndex/taskTotal/mcpTools so all analyze tasks receive tool definitions
// G4: callers now always use multi-round loop regardless of exec intent
function buildAnalyzePrompt(
  userPrompt: string,
  task: AgentTask,
  currentContent: string,
  workdirOverride?: string,
  taskIndex: number = 1,
  taskTotal: number = 1,
  mcpTools?: McpToolRef[],
): string {
  const basename = nodePath.basename(task.file);
  const ext = (basename.split('.').pop() ?? '').toLowerCase();
  const langMap: Record<string, string> = {
    cpp: 'cpp', cc: 'cpp', h: 'c', c: 'c', hpp: 'cpp',
    ts: 'typescript', js: 'javascript', py: 'python', md: 'markdown',
  };
  const lang = langMap[ext] ?? ext;

  const contentSection = currentContent
    ? [`【当前文件内容】`, '```' + lang, currentContent, '```', ''].join('\n')
    : '';

  // Inject project rules + AI memory if present
  const _analyzeRules = getProjectRulesSync();
  const _analyzeMemory = getProjectMemorySync();
  const _analyzeContext = [
    _analyzeRules ? wrapRulesAsContext(_analyzeRules) : '',
    _analyzeMemory ? wrapMemoryAsContext(_analyzeMemory) : '',
  ].filter(Boolean).join('\n\n');

  // Provide a focused hint for compile/run tasks (AI still has run_terminal via buildToolsSuffix)
  const isExecTask = /编译|运行|执行|compile|build|run\b|execute/i.test(task.desc + userPrompt);
  const taskDir = workdirOverride ?? (task.absPath ? nodePath.dirname(task.absPath) : '');
  const workdirHint = taskDir ? `, "workdir":"${taskDir}"` : '';
  const noExt = basename.replace(/\.[^.]+$/, '');
  // Use absolute source/output paths — command is correct even if AI omits workdir
  const srcArg = task.absPath ? `'${task.absPath.replace(/'/g, "'\\''")}'` : basename;
  const exeArg = taskDir ? `'${nodePath.join(taskDir, noExt).replace(/'/g, "'\\''")}'` : noExt;
  // Auto-detect required library flags from #include directives (e.g. -lGL -lGLU -lglut)
  const libFlags = isExecTask ? scanLibFlagsFromContent(currentContent) : '';
  const libFlagsSuffix = libFlags ? ` ${libFlags}` : '';
  let defaultCmd = `gcc ${srcArg} -o ${exeArg}${libFlagsSuffix} && ${exeArg}`;
  if (/\.cpp$|\.cc$/i.test(basename)) defaultCmd = `g++ -std=c++17 ${srcArg} -o ${exeArg}${libFlagsSuffix} && ${exeArg}`;
  else if (/\.py$/i.test(basename)) defaultCmd = `python3 ${srcArg}`;
  else if (/\.js$/i.test(basename)) defaultCmd = `node ${srcArg}`;
  const learnedCmds = isExecTask ? getCommandHints('compile') : '';
  const learnedCmdsSection = learnedCmds
    ? `\n【已知成功命令（优先使用）】\n${learnedCmds}\n`
    : '';
  const execSection = isExecTask
    ? `\n【编译/运行提示】如需执行，可直接使用 run_terminal 工具（命令中必须使用绝对路径，严禁使用相对路径，以确保不同工作目录下路径正确）：\n[TOOL:run_terminal {"command":"${defaultCmd}"${workdirHint}}]\n（命令可按需修改，必须通过工具调用执行，不要只描述步骤）\n${learnedCmdsSection}`
    : '';

  return [
    `你是代码分析智能体，请分析文件 ${basename}。你有完整工具访问权限，可以主动读取相关文件、搜索代码、执行命令。`,
    ``,
    _analyzeContext,
    `【用户需求背景】`,
    userPrompt,
    ``,
    `【本次任务】`,
    `文件: ${basename}`,
    `目标: ${task.desc}`,
    ``,
    contentSection,
    execSection,
    `【分析要求】`,
    `- 若需要查看相关文件、搜索代码引用，请主动调用工具`,
    `- 给出有具体证据的分析（文件路径/行号/函数名）`,
    `- 如有具体问题，明确指出问题位置和改进建议`,
    `- 使用简体中文回复`,
    buildToolsSuffix(taskIndex, taskTotal, mcpTools, taskDir),
  ].join('\n');
}

/**
 * Editor prompt for modify/create tasks.
 *
 * CRITICAL: currentContent is injected directly so the LLM knows the exact
 * current state of the file.  The preferred output format is SEARCH/REPLACE
 * blocks (targeted, reliable).  Full-file output is accepted as fallback.
 */
function buildEditorPrompt(
  userPrompt: string,
  task: AgentTask,
  allTasks: AgentTask[],
  currentContent: string,
  taskIndex: number = 1,
  taskTotal: number = 1,
  mcpTools?: McpToolRef[],
  analysisContext?: string,
  workdirOverride?: string,
  wsRootPath?: string,
): string {
  const basename = nodePath.basename(task.file);
  // Use workspace-relative path (e.g. 'code/3d_sphere.cpp') so the LLM knows the real
  // directory and won't guess a wrong one (e.g. 'src/') in the output file header.
  const displayPath = (wsRootPath && task.absPath && task.absPath.startsWith(wsRootPath))
    ? task.absPath.slice(wsRootPath.length).replace(/^\/|^\\/, '').replace(/\\/g, '/')
    : basename;
  const lang = fenceLangForFile(basename);
  const otherModify = allTasks
    .filter(t => t.id !== task.id && (t.action === 'modify' || t.action === 'create'))
    .map(t => `  - ${nodePath.basename(t.file)}`)
    .join('\n');

  const contentSection = currentContent
    ? [
        `【当前文件完整内容】`,
        '```' + lang,
        currentContent,
        '```',
        '',
      ].join('\n')
    : '';

  // For create action there's no existing content
  const isCreate = task.action === 'create';

  // Prior-round analysis context — injected when user issues a follow-up like
  // "按照建议优化代码". Without this the Editor AI has no idea what "建议" refers to.
  const analysisSection = analysisContext
    ? [`【上轮分析建议 — 实现时必须严格参考以下建议】`, analysisContext.slice(0, 3000), ``].join('\n')
    : '';

  // Project rules from .devseek/rules.md — injected if present
  const projectRules = getProjectRulesSync();
  const projectRulesSection = projectRules ? [wrapRulesAsContext(projectRules), ``].join('\n') : '';
  const projectMemory = getProjectMemorySync();
  const projectMemorySection = projectMemory ? [wrapMemoryAsContext(projectMemory), ``].join('\n') : '';

  return [
    `你是一个专业的编程智能体（Editor 角色），正在执行多文件任务中的一个子任务。`,
    ``,
    projectRulesSection,
    projectMemorySection,
    `【原始用户需求】`,
    userPrompt,
    ``,
    analysisSection,
    `【本次子任务】`,
    `文件: ${displayPath}`,
    `操作: ${task.action}`,
    `任务: ${task.desc}`,
    ``,
    otherModify ? `【本轮其他修改文件（仅供参考，本次不包含）】\n${otherModify}\n` : '',
    isCreate ? '' : contentSection,
    `【输出格式要求（严格遵守）】`,
    isCreate
      ? [
          `请输出新文件 ${displayPath} 的完整内容：`,
          ``,
          `${displayPath}`,
          '```' + lang,
          `// 完整新文件内容`,
          '```',
        ].join('\n')
      : [
          `优先使用 SEARCH/REPLACE 格式输出改动（每个改动一个块）：`,
          ``,
          `<<<<<<< SEARCH`,
          `// 需要替换的原始代码（必须与上方文件内容完全一致）`,
          `=======`,
          `// 替换后的新代码`,
          `>>>>>>> REPLACE`,
          ``,
          `若改动量超过文件 50%，改用完整文件输出：`,
          ``,
          `${displayPath}`,
          '```' + lang,
          `// 完整最终内容（不可省略任何行）`,
          '```',
          ``,
          `规则：`,
          `- SEARCH 块必须与文件中的代码完全一致（包括空格和缩进）`,
          `- 只修改任务要求的部分，保留其余代码不变`,
          `- 禁止在格式块外添加解释性文字`,
        ].join('\n'),
    buildToolsSuffix(taskIndex, taskTotal, mcpTools, workdirOverride ?? (task.absPath ? nodePath.dirname(task.absPath) : undefined)),
  ].filter(Boolean).join('\n');
}

// ----------------------------------------------------------------
// Consolidated analysis: one call for all analyze/explain tasks
// ----------------------------------------------------------------

/**
 * Execute ALL analyze/explain tasks in a single LLM call.
 *
 * Instead of N separate streaming calls that flood the chat bubble, this
 * function embeds all file contents into one prompt and streams a single
 * organized markdown response.  Much faster and cleaner.
 */
async function executeAnalysisConsolidated(
  tasks: AgentTask[],
  userPrompt: string,
  mode: 'fast' | 'r1' | undefined,
  callbacks: AgentLoopCallbacks,
  history?: ChatMessage[],
  newSession = false,
): Promise<string> {  // returns full analysis text for findings extraction
  const total = tasks.length;
  // Per-file content limit — prevents context overflow; generous since each call only has ONE file.
  const MAX_FILE_CHARS = 14000; // ~400 lines of code
  // Per-file analysis result buffer (for summary prompt)
  const fileAnalyses: { file: string; text: string }[] = [];
  const langMap: Record<string, string> = {
    cpp: 'cpp', cc: 'cpp', h: 'c', c: 'c', hpp: 'cpp',
    ts: 'typescript', js: 'javascript', py: 'python', md: 'markdown',
  };

  // ── Sequential per-file analysis (Copilot/Claude Code pattern) ───────────
  // Each file gets its own LLM call: no cross-file context overflow, per-file
  // collapsible cards stream in the webview as results arrive.
  for (let i = 0; i < total; i++) {
    const t = tasks[i];
    const basename = nodePath.basename(t.file);
    const lang = langMap[(basename.split('.').pop() ?? '').toLowerCase()] ?? '';

    // Emit analyzeFile:started — webview creates a collapsible streaming card
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'analyzeFile',
      taskId: t.id, taskFile: basename,
      taskAction: t.action, taskDesc: t.desc,
      taskIndex: i + 1, taskTotal: total,
      state: 'started',
      title: t.desc || `分析 ${basename}`,
      detail: basename,
    });
    // Also emit execute:started for Working-box progress row
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'execute',
      taskId: t.id, taskFile: basename,
      taskAction: t.action, taskDesc: t.desc,
      taskIndex: i + 1, taskTotal: total,
      state: 'started',
      title: t.desc || `分析 ${basename}`,
      detail: basename,
    });

    // Read file content with truncation safeguard
    let rawContent = t.absPath ? readFileContentFull(t.absPath) : '';
    const wasTruncated = rawContent.length > MAX_FILE_CHARS;
    if (wasTruncated) rawContent = rawContent.slice(0, MAX_FILE_CHARS);
    const truncNote = wasTruncated
      ? `\n\n⚠️ 文件内容较长，已截取前 ${MAX_FILE_CHARS} 字符（约 400 行）进行分析。`
      : '';

    const filePrompt = [
      `你是代码分析智能体，请分析以下文件（第 ${i + 1} / ${total} 个）。`,
      ``,
      `【用户需求】`,
      userPrompt,
      ``,
      `【文件】${basename}${truncNote}`,
      rawContent
        ? ['```' + lang, rawContent, '```'].join('\n')
        : `（无法读取 ${basename} 的内容）`,
      ``,
      `【任务说明】${t.desc}`,
      ``,
      `【输出格式】（必须按此格式输出，不要重复文件名作为标题）`,
      `**概述**：（2-4 句描述文件功能和结构）`,
      `**分析**：（针对用户需求，列出关键发现，可用 bullet points，指出关键函数/行号）`,
      `**建议**：（具体改进点，如无则省略）`,
      ``,
      `用简体中文回复，分析要具体，不要空泛。`,
    ].join('\n');

    let fileText = '';
    try {
      const { tools: fTools } = await chatViaProvider(
        filePrompt, mode,
        (delta) => {
          if (delta.startsWith('\x00RESET\x00')) {
            fileText = delta.slice(7); // reset accumulated text
            callbacks.onDelta('\x00AFILE:' + basename + '\x00\x00RESET\x00' + delta.slice(7));
          } else {
            fileText += delta;
            callbacks.onDelta('\x00AFILE:' + basename + '\x00' + delta);
          }
        },
        history,
        callbacks.signal,
        i === 0 ? newSession : false, // only the first file uses newSession
      );
      await executeFakeToolsForLoop(fTools, callbacks);
      fileAnalyses.push({ file: basename, text: fileText });

      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'analyzeFile',
        taskId: t.id, taskFile: basename,
        taskAction: t.action, taskDesc: t.desc,
        taskIndex: i + 1, taskTotal: total,
        state: 'completed',
        title: t.desc || basename,
        detail: basename,
      });
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: t.id, taskFile: basename,
        taskAction: t.action, taskDesc: t.desc,
        taskIndex: i + 1, taskTotal: total,
        state: 'completed',
        title: t.desc || basename,
        detail: basename,
      });
    } catch (e) {
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'analyzeFile',
        taskId: t.id, taskFile: basename,
        taskAction: t.action, taskDesc: t.desc,
        taskIndex: i + 1, taskTotal: total,
        state: 'failed',
        title: t.desc || basename,
        detail: (e as Error).message,
      });
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: t.id, taskFile: basename,
        taskAction: t.action, taskDesc: t.desc,
        taskIndex: i + 1, taskTotal: total,
        state: 'failed',
        title: t.desc || basename,
        detail: (e as Error).message,
      });
      if (callbacks.signal?.aborted) break;
    }
  }

  if (fileAnalyses.length === 0) return '';

  // ── Final summary call ────────────────────────────────────────────────────
  // Emit analyzeSummary:started — webview creates the summary card
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'analyzeSummary',
    taskId: 'summary',
    taskFile: '',
    taskIndex: total,
    taskTotal: total,
    state: 'started',
    title: '综合总结',
  });

  // Build summary prompt — truncate each file's analysis to keep total context small
  const MAX_ANALYSIS_CHARS_PER_FILE = 600;
  const analysisList = fileAnalyses
    .map((fa, i) => {
      const snippet = fa.text.length > MAX_ANALYSIS_CHARS_PER_FILE
        ? fa.text.slice(0, MAX_ANALYSIS_CHARS_PER_FILE) + '…'
        : fa.text;
      return `${i + 1}. **${fa.file}**\n${snippet}`;
    })
    .join('\n\n');

  const summaryPrompt = [
    `以下是对 ${total} 个文件的逐一分析摘要：`,
    ``,
    analysisList,
    ``,
    `【用户需求】`,
    userPrompt,
    ``,
    `请给出 3-5 句整体评价，指出最重要的改进方向或共性问题。`,
    `用简体中文，直接输出总结文字，不加标题，不重复文件名。`,
  ].join('\n');

  let summaryText = '';
  try {
    await chatViaProvider(
      summaryPrompt, mode,
      (delta) => {
        if (delta.startsWith('\x00RESET\x00')) {
          summaryText = delta.slice(7);
          callbacks.onDelta('\x00ASUM\x00\x00RESET\x00' + delta.slice(7));
        } else {
          summaryText += delta;
          callbacks.onDelta('\x00ASUM\x00' + delta);
        }
      },
      undefined, // no history for summary — avoid polluting context
      callbacks.signal,
      false,
    );
  } catch (_e) { /* summary failure is non-fatal */ }

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'analyzeSummary',
    taskId: 'summary',
    taskFile: '',
    taskIndex: total,
    taskTotal: total,
    state: 'completed',
    title: '综合总结',
  });

  const fullAnalysisText = fileAnalyses.map(fa => `## ${fa.file}\n${fa.text}`).join('\n\n')
    + (summaryText ? '\n\n## 综合总结\n' + summaryText : '');
  return fullAnalysisText;
}

// ----------------------------------------------------------------
// Execute a single task
// ----------------------------------------------------------------

async function executeTask(
  task: AgentTask,
  taskIndex: number,
  allTasks: AgentTask[],
  userPrompt: string,
  mode: 'fast' | 'r1' | undefined,
  workspaceRoot: vscode.Uri,
  callbacks: AgentLoopCallbacks,
  contentCache: Map<string, string>,
  history?: ChatMessage[],
  analysisContext?: string,
  newSession = false,
): Promise<{ applied: boolean; path?: string; raw?: string; taskComplete?: boolean; linesAdded?: number; linesRemoved?: number; networkError?: boolean }> {
  const basename = nodePath.basename(task.file);
  // Only the very first LLM call for this task uses newSession; subsequent
  // rounds (retries, tool-feedback loops) continue in the same session.
  let firstCall = true;
  const consumeNewSession = () => { const ns = firstCall && newSession; firstCall = false; return ns; };

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: task.id,
    taskFile: basename,
    taskAction: task.action,
    taskDesc: task.desc,
    taskIndex,
    taskTotal: allTasks.length,
    state: 'started',
    title: task.desc || `执行 ${basename}`,
    detail: basename,
  });

  // Read current file content — prefer contentCache (updated by prior tasks in this
  // same loop) over disk read, so multi-task edits on the same file properly chain.
  // Use readFileContentFull: Editor needs the COMPLETE file for exact SEARCH matching.
  const currentContent = (task.absPath && contentCache.has(task.absPath))
    ? (contentCache.get(task.absPath) ?? '')
    : (task.absPath ? readFileContentFull(task.absPath) : '');

  // Pre-compute effectiveAbsPath early — needed by both analyze and editor paths.
  let earlyEffectiveAbsPath = task.absPath;
  if (!earlyEffectiveAbsPath && task.file) {
    const relNorm = task.file.replace(/\\/g, '/').replace(/^\.\//, '');
    // For modify/create: try to locate file in all workspace folders before falling back.
    // This handles multi-root workspaces where workspaceRoot may point to the wrong folder.
    if (!nodePath.isAbsolute(relNorm)) {
      for (const wf of (vscode.workspace.workspaceFolders ?? [])) {
        const candidate = nodePath.join(wf.uri.fsPath, ...relNorm.split('/'));
        if (fs.existsSync(candidate)) { earlyEffectiveAbsPath = candidate; break; }
      }
    }
    if (!earlyEffectiveAbsPath && task.action === 'create') {
      // For new files: prefer the directory of sibling tasks so the new file lands in
      // the same project folder, not at the workspace root.
      // Apply to both bare filenames and paths with subdirectories (e.g. "test/run_tests.sh"):
      //   sibling in code/3d_demo/ + relNorm "test/run_tests.sh" → code/3d_demo/test/run_tests.sh
      const siblingDirs = allTasks
        .filter(t => t !== task && t.absPath)
        .map(t => nodePath.dirname(t.absPath!));
      if (siblingDirs.length > 0) {
        const dirCounts = new Map<string, number>();
        siblingDirs.forEach(d => dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1));
        const contextDir = [...dirCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        earlyEffectiveAbsPath = nodePath.join(contextDir, relNorm);
      }
      if (!earlyEffectiveAbsPath) {
        const folder = findWorkspaceFolderForRelativePath(relNorm);
        earlyEffectiveAbsPath = nodePath.join(
          (folder ?? { uri: workspaceRoot }).uri.fsPath,
          ...relNorm.split('/'),
        );
      }
    }
  }

  // ──── analyze / explain ────────────────────────────────────────
  // These run individually when called from runAgentLoop in mixed-action mode.
  // (All-analyze batches previously had a consolidated shortcut — G6 removed it
  //  so all analyze tasks now get the full multi-round tool loop.)
  if (task.action === 'analyze' || task.action === 'explain' || task.action === 'explore') {
    const analyzeWorkdir = earlyEffectiveAbsPath ? nodePath.dirname(earlyEffectiveAbsPath) : undefined;
    // G3: pass taskIndex/taskTotal/mcpTools so the prompt includes full tool definitions
    const analyzePrompt = buildAnalyzePrompt(userPrompt, task, currentContent, analyzeWorkdir, taskIndex, allTasks.length, callbacks.mcpToolRefs);
    let analyzeRaw = '';

    // G4+G5: unified multi-round tool loop for ALL analyze/explain/explore tasks.
    // Removed keyword-gated isExecTask branch — AI now autonomously decides when to use tools.
    // MAX_ANALYZE_ROUNDS=8 gives enough depth for investigative tasks without runaway loops.
    const MAX_ANALYZE_ROUNDS = 8;
    const execMessages: ChatMessage[] = [
      ...(history ?? []),
      { role: 'user', content: analyzePrompt },
    ];
    // G-analy-display: Route streaming text into the Working box analysis body (Copilot
    // inline style). Using \x00AFILE:basename\x00 prefix ensures content appears per-task
    // directly inside each Working box, regardless of whether the AI produces streaming
    // prose or puts all analysis in task_complete.summary.
    const AFX = '\x00AFILE:' + basename + '\x00';
    try {
      for (let r = 0; r < MAX_ANALYZE_ROUNDS; r++) {
        if (callbacks.signal?.aborted) break;
        execMessages.push(...consumeUserSteerMessages(callbacks));
        const { text, tools } = await chatWithMessages(
          execMessages, mode,
          (delta) => {
            if (delta.startsWith('\x00RESET\x00')) {
              // Preserve RESET semantic inside AFILE prefix so analysis body resets cleanly
              callbacks.onDelta(AFX + '\x00RESET\x00' + delta.slice(7));
            } else {
              analyzeRaw += delta;
              callbacks.onDelta(AFX + delta);
            }
          },
          callbacks.signal,
          consumeNewSession(),
        );
        execMessages.push({ role: 'assistant', content: text });
        // Pass analyzeWorkdir so run_terminal defaults to task directory when AI omits workdir.
        const loopRes = await executeFakeToolsForLoop(tools, callbacks, analyzeWorkdir, { currentTaskIndex: taskIndex, taskTotal: allTasks.length, deferDoneStatus: true });
        if (loopRes.taskComplete) { return { applied: false, raw: analyzeRaw, taskComplete: true }; }
        if (!loopRes.toolCallsMade) break;
        execMessages.push({
          role: 'user',
          content: `[工具执行结果]\n${loopRes.feedbackForAI}\n\n请继续。`,
        });
      }
    } catch (e) {
      const netErr = isNetworkError(e);
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: task.desc || basename,
        detail: (e as Error).message,
      });
      return { applied: false, raw: analyzeRaw, networkError: netErr };
    }

    await callbacks.onAgentStatus({
      type: 'agentStatus', phase: 'execute',
      taskId: task.id, taskFile: basename, taskAction: task.action,
      taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
      state: 'completed', title: task.desc || basename,
    });
    return { applied: false, raw: analyzeRaw };
  }

  // ──── modify / create / delete ────────────────────────────────
  // P9: Early-fail when the task is 'modify' but the target file can't be read.
  // Proceeding without content forces the LLM to hallucinate the full file from
  // scratch, which almost always produces a garbled or wrong result.
  if (task.action === 'modify' && task.absPath && !currentContent) {
    await callbacks.onAgentStatus({
      type: 'agentStatus', phase: 'execute',
      taskId: task.id, taskFile: basename, taskAction: task.action,
      taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
      state: 'failed',
      title: `${basename} — 读取文件失败，跳过修改`,
      detail: `路径 ${task.absPath} 不存在或无法读取。请确认文件路径正确后重试。`,
    });
    return { applied: false };
  }

  // Build editor prompt with current file content injected.
  const editorWorkdir = earlyEffectiveAbsPath ? nodePath.dirname(earlyEffectiveAbsPath) : undefined;
  const editorPrompt = buildEditorPrompt(
    userPrompt, task, allTasks, currentContent, taskIndex, allTasks.length,
    callbacks.mcpToolRefs, analysisContext, editorWorkdir, workspaceRoot.fsPath,
  );

  // ── Multi-round mini-loop (Copilot/Cursor style) ──────────────
  // The AI can call tools (read_file, grep_search, list_dir, get_errors,
  // run_terminal) to explore the codebase, then output SEARCH/REPLACE edits.
  // Each tool call result is fed back as the next user message, allowing the
  // AI to reason with the data before deciding what to change.
  // Autopilot: 20 rounds/task (matches Copilot's higher per-task budget).
  const MAX_TASK_ROUNDS = callbacks.autopilot ? 20 : 5;
  const taskMessages: ChatMessage[] = [
    ...(history ?? []),
    { role: 'user', content: editorPrompt },
  ];
  let raw = '';
  // True when the AI called task_complete alongside file content in a create/modify task.
  // The break path falls through to write the file but must still propagate taskComplete.
  let taskCompleteByAI = false;

  for (let taskRound = 0; taskRound < MAX_TASK_ROUNDS; taskRound++) {
    if (callbacks.signal?.aborted) { return { applied: false, raw }; }
    try {
      taskMessages.push(...consumeUserSteerMessages(callbacks));
      const { text, tools } = await chatWithMessages(taskMessages, mode, undefined, callbacks.signal, consumeNewSession());
      taskMessages.push({ role: 'assistant', content: text });
      raw = text;

      const loopRes = await executeFakeToolsForLoop(tools, callbacks, editorWorkdir, { currentTaskIndex: taskIndex, taskTotal: allTasks.length, deferDoneStatus: true });
      if (loopRes.taskComplete) {
        // For create/modify tasks: if the AI emitted file content + task_complete
        // in the same response, fall through to the file-writing path instead of
        // returning early (otherwise the file never gets written to disk).
        if ((task.action === 'create' || task.action === 'modify') && raw) { taskCompleteByAI = true; break; }
        return { applied: false, raw, taskComplete: true };
      }

      // AI output SEARCH/REPLACE blocks → exit mini-loop and apply
      if (parseSearchReplaceBlocks(text).length > 0) { break; }

      // No data-fetching tool called → AI gave final answer (full-file or plain text)
      if (!loopRes.toolCallsMade) { break; }

      // Feed tool results back for the next AI round
      taskMessages.push({
        role: 'user',
        content: `[工具执行结果]
${loopRes.feedbackForAI}

请根据以上结果继续完成修改。`,
      });
    } catch (e) {
      const netErr = isNetworkError(e);
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'execute',
        taskId: task.id, taskFile: basename, taskAction: task.action,
        taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
        state: 'failed', title: task.desc || basename,
        detail: (e as Error).message,
      });
      return { applied: false, raw, networkError: netErr };
    }
  }

  // ── Try SEARCH/REPLACE blocks first ───────────────────────────
  const srBlocks = parseSearchReplaceBlocks(raw);
  if (srBlocks.length > 0 && currentContent && task.absPath) {
    const srResult = applySearchReplaceBlocks(currentContent, srBlocks);
    if (srResult.applied > 0 && srResult.failed === 0) {
      // P-SEC: check with extension before writing (sensitive file protection)
      if (callbacks.onBeforeFileWrite) {
        const allowed = await callbacks.onBeforeFileWrite(task.absPath);
        if (!allowed) {
          await callbacks.onAgentStatus({
            type: 'agentStatus',
            phase: 'execute',
            taskId: task.id, taskFile: basename, taskAction: task.action,
            taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
            state: 'failed',
            title: `跳过 ${basename}（用户拒绝写入敏感文件）`,
          });
          return { applied: false, raw, ...(taskCompleteByAI ? { taskComplete: true } : {}) };
        }
      }
      // Write the modified content directly to disk
      try {
        const targetUri = vscode.Uri.file(task.absPath);
        await vscode.workspace.fs.writeFile(targetUri, Buffer.from(srResult.result, 'utf8'));
        // Update cache so subsequent tasks on the same file see this result
        contentCache.set(task.absPath, srResult.result);
        await callbacks.onAppliedChange({
          // Use absPath-relative path for display; fall back to task.file which was
          // already sanitized in parseTaskPlan.
          path: task.absPath
            ? nodePath.relative(workspaceRoot.fsPath, task.absPath).replace(/\\/g, '/')
            : task.file,
          existed: true,
          oldContent: currentContent,
          newContent: srResult.result,
        });
        const srDiff = roughLineDiff(currentContent, srResult.result);
        await callbacks.onAgentStatus({
          type: 'agentStatus',
          phase: 'execute',
          taskId: task.id, taskFile: basename, taskAction: task.action,
          taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
          state: 'completed',
          title: task.desc || basename,
          detail: `${basename} · ${srResult.applied} 处改动`,
          linesAdded: srDiff.added,
          linesRemoved: srDiff.removed,
        });
        return { applied: true, path: task.absPath, raw, ...(taskCompleteByAI ? { taskComplete: true } : {}) };
      } catch (writeErr) {
        // Fall through to full-file parser
      }
    } else if (srResult.failed > 0) {
      // SEARCH blocks didn't match — fall through to full-file parser with a log
      void srResult.errors; // consumed below in retry
    }
  }

  // ── Fall back to full-file parser ─────────────────────────────
  // For modify/create tasks where task.absPath is not yet known, resolve the correct
  // workspace folder before passing absFiles to workspace-applier. Without this, the
  // applier falls back to the first workspace folder which may be wrong in multi-root setups.
  let effectiveAbsPath = task.absPath;
  if (!effectiveAbsPath && task.file) {
    const relNorm = task.file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!nodePath.isAbsolute(relNorm)) {
      // Try to find an existing file across all workspace folders first
      for (const wf of (vscode.workspace.workspaceFolders ?? [])) {
        const candidate = nodePath.join(wf.uri.fsPath, ...relNorm.split('/'));
        if (fs.existsSync(candidate)) { effectiveAbsPath = candidate; break; }
      }
      // If still not found (e.g. create action), prefer the directory of sibling tasks
      // so the new file lands in the same project folder, not at the workspace root.
      // Apply to both bare filenames and paths with subdirectories.
      if (!effectiveAbsPath) {
        const siblingDirsEff = allTasks
          .filter(t => t !== task && t.absPath)
          .map(t => nodePath.dirname(t.absPath!));
        if (siblingDirsEff.length > 0) {
          const dirCountsEff = new Map<string, number>();
          siblingDirsEff.forEach(d => dirCountsEff.set(d, (dirCountsEff.get(d) ?? 0) + 1));
          const contextDirEff = [...dirCountsEff.entries()].sort((a, b) => b[1] - a[1])[0][0];
          effectiveAbsPath = nodePath.join(contextDirEff, relNorm);
        }
        if (!effectiveAbsPath) {
          const folder = findWorkspaceFolderForRelativePath(relNorm);
          effectiveAbsPath = nodePath.join(
            (folder ?? { uri: workspaceRoot }).uri.fsPath,
            ...relNorm.split('/'),
          );
        }
      }
    }
  }
  const absFiles = effectiveAbsPath ? [effectiveAbsPath] : [];
  let applyResult = await applyGeneratedArtifactsWithPrompt(
    raw,
    editorPrompt,
    async (status) => { await callbacks.onWorkflowStatus(status); },
    true,
    async (change) => { await callbacks.onAppliedChange(change); },
    absFiles,
  );

  // ── Retry once if nothing was applied ─────────────────────────
  if (!applyResult.applied || applyResult.changedPaths.length === 0) {
    const lang = fenceLangForFile(basename);
    const retryPrompt = [
      `你是编程智能体。任务：${task.desc}`,
      ``,
      `文件 ${basename} 当前内容：`,
      '```' + lang,
      currentContent || '（空文件）',
      '```',
      ``,
      `请输出修改后的完整文件内容，格式如下（不要省略任何行）：`,
      ``,
      `${basename}`,
      '```' + lang,
      `// 完整内容`,
      '```',
    ].join('\n');

    let retryRaw = '';
    try {
      const { text: rText, tools: rTools } = await chatViaProvider(retryPrompt, mode, undefined, history, callbacks.signal, false);
      retryRaw = rText;
      await executeFakeToolsForLoop(rTools, callbacks);
    } catch { /* retry failed, fall through */ }

    if (retryRaw) {
      applyResult = await applyGeneratedArtifactsWithPrompt(
        retryRaw,
        retryPrompt,
        async (status) => { await callbacks.onWorkflowStatus(status); },
        true,
        async (change) => { await callbacks.onAppliedChange(change); },
        absFiles,
      );
      if (applyResult.applied) raw = retryRaw;
    }
  }

  const applied = applyResult.applied && applyResult.changedPaths.length > 0;

  // Update cache if full-file write succeeded, so next task on same file chains correctly
  let fullFileDiff: { added: number; removed: number } | undefined;
  if (applied && task.absPath) {
    const freshContent = readFileContentFull(task.absPath);
    if (freshContent) {
      contentCache.set(task.absPath, freshContent);
      if (currentContent) fullFileDiff = roughLineDiff(currentContent, freshContent);
    }
  }

  // P18: full-file fallback path never sent a terminal task status.
  // SEARCH/REPLACE path returns early after sending its own 'completed'/'failed';
  // only this code path reaches here, so we emit terminal status unconditionally.
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: task.id, taskFile: basename, taskAction: task.action,
    taskDesc: task.desc, taskIndex, taskTotal: allTasks.length,
    state: applied ? 'completed' : 'failed',
    title: task.desc || (applied ? `${basename} — 已修改` : `${basename} — 未能应用`),
    ...(fullFileDiff ? { linesAdded: fullFileDiff.added, linesRemoved: fullFileDiff.removed } : {}),
  });

  return {
    applied,
    path: applied ? applyResult.changedPaths[0] : undefined,
    raw,
    linesAdded: fullFileDiff?.added,
    linesRemoved: fullFileDiff?.removed,
    ...(taskCompleteByAI ? { taskComplete: true } : {}),
  };
}

// ----------------------------------------------------------------
// Analysis findings extractor (P14 fix: Analyze → Plan fusion)
// ----------------------------------------------------------------

/**
 * Extract actionable bug/issue descriptions from a prior analysis response.
 * Looks for bullet-point lines that contain keywords indicating problems.
 * Returns an AnalysisFindings object suitable for injecting into decomposeTask().
 */
export function extractAnalysisFindings(analysisText: string): import('./agent-task-decomposer').AnalysisFindings {
  const ISSUE_KEYWORDS = /\b(笔误|错误|bug|问题|缺陷|越界|typo|wrong|issue|改进|建议|修复|不一致|漏掉|遗漏|溢出|补全|增加|考虑|优化|重构|改为|改用|避免|确认|验证)\b/i;
  const issues: string[] = [];

  for (const line of analysisText.split('\n')) {
    const trimmed = line.replace(/^[-*•\d.)\s]+/, '').trim();
    if (trimmed.length > 10 && trimmed.length < 200 && ISSUE_KEYWORDS.test(trimmed)) {
      issues.push(trimmed);
    }
  }

  // Deduplicate and limit
  const seen = new Set<string>();
  const unique = issues.filter(i => {
    if (seen.has(i)) return false;
    seen.add(i);
    return true;
  }).slice(0, 20);

  return { issues: unique };
}

// ----------------------------------------------------------------
// Compile validation helper
// ----------------------------------------------------------------

interface ValidationOutcome {
  ran: boolean;
  ok: boolean;
  command?: string;
  detail?: string;
  reason?: string;
}

async function runValidation(
  changedPaths: string[],
  workspaceRoot: vscode.Uri,
  callbacks: AgentLoopCallbacks,
  /**
   * Whether to also run the program after successful compilation.
   * Derived from decomposed task actions (any analyze task with run_terminal in desc),
   * NOT from keyword-matching the raw user prompt.
   */
  wantRun = false,
  sessionHistory?: ChatMessage[],
): Promise<ValidationOutcome> {
  // Only C/C++ files need compile validation; Python, MD, etc. are skipped
  const compilable = changedPaths.filter(p => isCompilableFile(p));
  if (compilable.length === 0) return { ran: false, ok: true, reason: 'no-compilable-files' };

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: 'started',
    title: wantRun ? '正在编译并运行' : '正在执行编译验证',
    detail: `验证 ${compilable.length} 个 C/C++ 文件`,
  });

  // Always compile-only for validation first; if run requested we run separately
  const compilePlan = planLocalExecution('编译', compilable, workspaceRoot.fsPath) as LocalExecutionPlan | null;
  if (!compilePlan) {
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'skipped',
      title: '未找到构建命令，跳过编译验证',
      detail: '未识别到 CMakeLists.txt 或 C++ 源文件。',
    });
    return { ran: false, ok: false, reason: 'no-build-plan' };
  }

  const compileResult = await runLocalExecution(compilePlan);

  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'validate',
    state: compileResult.ok ? 'completed' : 'failed',
    title: compileResult.ok ? '编译验证通过 ✓' : '编译验证失败',
    detail: compileResult.ok
      ? `命令: ${compilePlan.command}  exitCode: 0`
      : compileResult.output.slice(0, 400),
  });
  if (!compileResult.ok) {
    return {
      ran: true,
      ok: false,
      command: compilePlan.command,
      detail: compileResult.output.slice(0, 1200),
      reason: 'compile-failed',
    };
  }

  // If compilation succeeded and user wants to run — execute in terminal
  if (wantRun && callbacks.onTerminalCommand) {
    // Build a run-only command from the compile plan's output binary.
    // Pass '运行' to planLocalExecution so it enables the run step (compile-run mode).
    const runPlan = planLocalExecution('运行', compilable, workspaceRoot.fsPath) as LocalExecutionPlan | null;
    const runCmd = runPlan?.mode === 'compile-run'
      ? runPlan.command       // planner already includes run step
      : compilePlan.command;  // fallback: reuse compile command
    try {
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'started',
        title: '正在执行程序',
        detail: `终端运行: ${runCmd}`,
      });
      const output = await callbacks.onTerminalCommand(runCmd, compilePlan.cwd);
      // G-4: truncate and feed output back into sessionHistory so LLM sees actual results
      const truncated = output.length > 2000
        ? output.slice(0, 2000) + `\n[输出已截断，共 ${output.length} 字符]`
        : output;
      if (sessionHistory) {
        sessionHistory.push({
          role: 'assistant',
          content: `程序执行输出：\n\`\`\`\n${truncated}\n\`\`\``,
        });
      }
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'completed',
        title: '执行完成 ✓',
        detail: truncated.slice(0, 400),
      });
    } catch (e) {
      const detail = (e as Error).message;
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: 'failed',
        title: '执行失败',
        detail,
      });
      return {
        ran: true,
        ok: false,
        command: runCmd,
        detail,
        reason: 'run-failed',
      };
    }
  }

  return {
    ran: true,
    ok: true,
    command: compilePlan.command,
    reason: wantRun ? 'compile-and-run-passed' : 'compile-passed',
  };
}

// ----------------------------------------------------------------
// Main entry: run the full Agent Loop
// ----------------------------------------------------------------

export async function runAgentLoop(
  tasks: AgentTask[],
  userPrompt: string,
  mode: 'fast' | 'r1' | undefined,
  workspaceRoot: vscode.Uri,
  callbacks: AgentLoopCallbacks,
  analysisContext?: string,
  startFromIndex = 0,
): Promise<AgentLoopResult> {
  const changedPaths: string[] = [];
  const editedFileRecords: Array<{ path: string; basename: string; linesAdded?: number; linesRemoved?: number; action: string }> = [];
  let tasksApplied = 0;
  let tasksFailed = 0;

  // Announce execution start
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    state: 'started',
    title: `开始执行 ${tasks.length} 个任务`,
    detail: tasks.map((t, i) => `${i + 1}. [${t.action}] ${nodePath.basename(t.file)} — ${t.desc}`).join('\n'),
    taskTotal: tasks.length,
  });

  // Copilot 规划阶段对齐：执行开始前先展示全部任务（全部 not-started）
  // Copilot 的 AI 在第一轮就调用 manage_todo_list 这样做；这里用框架自动初始化以确保可见性。
  if (callbacks.onTodoUpdate && tasks.length > 0 && startFromIndex === 0) {
    await callbacks.onTodoUpdate(tasks.map((t, j) => ({
      id: j + 1,
      title: t.desc,
      status: 'not-started' as const,
    })));
  }

  // ── Consolidated analysis shortcut ───────────────────────────────────────
  // G6: Removed the allReadOnly early-return shortcut that bypassed the tool loop.
  // All tasks — including pure analyze/explain batches — now go through executeTask
  // which runs a multi-round tool loop (G3+G4). This allows AI to actively grep,
  // read related files, and run commands instead of being limited to a single LLM call.
  const isReadOnlyAction = (a: AgentTaskAction) => a === 'analyze' || a === 'explain' || a === 'explore';

  // ── Execute every task individually ───────────────────────────────────────
  // contentCache: tracks the latest written content per absPath so that each
  // subsequent task on the same file sees the result of the previous task.
  // sessionHistory (L-1/L-4): accumulates task summaries so each LLM call
  // knows what was already done in this agent session (cross-round context).
  const contentCache = new Map<string, string>();
  const sessionHistory: ChatMessage[] = [];
  // Accumulate analysis text from read-only tasks to return as analysisText (for findings injection)
  const analysisTexts: string[] = [];
  // Internal execute tasks should NOT create new DeepSeek web conversations.
  // The user controls session switching via the '新对话' button.
  let needsNewSession = false;
  // Track whether the AI called task_complete (to suppress duplicate phase:done).
  let hadTaskComplete = false;

  for (let i = startFromIndex; i < tasks.length; i++) {
    const task = tasks[i];

    // Reset todo states to ground-truth at the start of each task so any premature
    // "all completed" marking by earlier AI calls doesn't mislead the UI.
    if (callbacks.onTodoUpdate && tasks.length > 1) {
      await callbacks.onTodoUpdate(tasks.map((t, j) => ({
        id: j + 1,
        title: t.desc,
        status: (j < i ? 'completed' : j === i ? 'in-progress' : 'not-started') as 'completed' | 'in-progress' | 'not-started',
      })));
    }

    sessionHistory.push(...consumeUserSteerMessages(callbacks));

    const result = await executeTask(
      task,
      i + 1,
      tasks,
      userPrompt,
      mode,
      workspaceRoot,
      callbacks,
      contentCache,
      sessionHistory.length > 0 ? [...sessionHistory] : undefined,
      analysisContext,
      needsNewSession,
    );
    needsNewSession = false; // Only first task starts a new session

    // ── Network-error detection: save checkpoint and abort loop ──────────
    // If the task failed due to a network error (fetch failed, ECONNREFUSED,
    // AbortError from upstream timeout, etc.) there is no point executing the
    // remaining tasks — they will all fail for the same reason.
    // Save a checkpoint so the user can resume from this task after reconnecting.
    if (result.networkError) {
      callbacks.onTaskCheckpoint?.(i, tasks.slice(i));
      await callbacks.onAgentStatus({
        type: 'agentStatus', phase: 'done', state: 'failed',
        title: `网络中断，已在第 ${i + 1}/${tasks.length} 个任务暂停`,
        detail: `已完成 ${tasksApplied} 个任务，剩余 ${tasks.length - i} 个等待续传。重连后可继续。`,
        taskTotal: tasks.length,
      });
      return { tasksTotal: tasks.length, tasksApplied, tasksFailed: tasksFailed + 1, changedPaths };
    }

    // L-4 / I-3: Append brief task result to session history.
    // G7: Cap based on total char count rather than entry count — avoids both under-
    // trimming (20 short entries) and over-trimming (20 long entries).
    const sessionChars = sessionHistory.reduce((s, m) => s + (m.content?.length ?? 0), 0);
    if (sessionChars > 40000 && sessionHistory.length >= 6) {
      // Preserve index 0-1 (initial-request anchor); drop oldest non-anchor pair.
      sessionHistory.splice(2, 2);
    }
    if (result.applied && result.path) {
      changedPaths.push(result.path);
      tasksApplied += 1;
      editedFileRecords.push({
        path: result.path,
        basename: nodePath.basename(result.path),
        linesAdded: result.linesAdded,
        linesRemoved: result.linesRemoved,
        action: task.action,
      });
      sessionHistory.push({
        role: 'assistant',
        content: `已完成任务 ${i + 1}/${tasks.length}：修改 ${nodePath.basename(result.path)}（${task.desc}）`,
      });
    } else if (isReadOnlyAction(task.action) && result.raw) {
      // Collect analysis text for findings injection into next round
      analysisTexts.push(`## ${nodePath.basename(task.file)}\n${result.raw}`);
      // Keep analysis context but limit its size to avoid token overflow
      sessionHistory.push({
        role: 'assistant',
        content: `已分析 ${nodePath.basename(task.file)}：${result.raw.slice(0, 1200)}${result.raw.length > 1200 ? '…' : ''}`,
      });
    } else if (!isReadOnlyAction(task.action)) {
      tasksFailed += 1;
      sessionHistory.push({
        role: 'assistant',
        content: `任务 ${i + 1}/${tasks.length} 失败：${nodePath.basename(task.file)}（${task.desc}）`,
      });
    }

    if (callbacks.onTodoUpdate && tasks.length > 0) {
      const currentCompleted = result.applied
        || result.taskComplete
        || (isReadOnlyAction(task.action) && !!result.raw);
      const currentFailed = !currentCompleted && !isReadOnlyAction(task.action);
      await callbacks.onTodoUpdate(tasks.map((t, j) => ({
        id: j + 1,
        title: t.desc,
        status: (j < i
          ? 'completed'
          : j === i
          ? (currentFailed ? 'failed' : currentCompleted ? 'completed' : 'in-progress')
          : 'not-started') as 'completed' | 'in-progress' | 'not-started' | 'failed',
      })));
    }

    // Only emit responseMeta for generation tasks (modify/create/delete).
    if (result.raw && !isReadOnlyAction(task.action)) {
      await callbacks.onResponseMeta(result.raw);
    }

    // Update checkpoint after each successful task so a future network error
    // only re-runs from the NEXT task, not from the beginning.
    callbacks.onTaskCheckpoint?.(i + 1, tasks.slice(i + 1));

    // task_complete from the AI means "I finished this task".
    // Record the task result first, then stop only when it was the final task.
    // Otherwise the final file edit can bypass editedFiles/validation summaries.
    if (result.taskComplete) {
      if (i === tasks.length - 1) {
        hadTaskComplete = true;
        break;
      }
      // Intermediate task: advance to the next task automatically.
    }
  }

  // All tasks completed — clear the checkpoint (null signals "done, nothing to resume").
  callbacks.onTaskCheckpoint?.(null, []);

  // Compile validation — C/C++ modify tasks only
  const modifiedPaths = tasks
    .filter(t => !isReadOnlyAction(t.action) && t.absPath && isCompilableFile(t.file))
    .map(t => t.absPath!);
  let validationOutcome: ValidationOutcome | undefined;
  if (modifiedPaths.length > 0) {
    // Derive wantRun from task plan (LLM-decided), not from raw prompt keywords.
    // An analyze task whose desc mentions run_terminal means the LLM planned execution.
    const wantRun = tasks.some(
      t => t.action === 'analyze' && /run_terminal|运行程序|执行程序|compile.*run|build.*run/i.test(t.desc)
    );
    validationOutcome = await runValidation(modifiedPaths, workspaceRoot, callbacks, wantRun, sessionHistory);
  }
  const validationFailed = validationOutcome ? !validationOutcome.ok : false;
  if (validationFailed && callbacks.onTodoUpdate && tasks.length > 0) {
    const validationIndex = tasks.findIndex(
      t => /编译|构建|运行|测试|compile|build|run|test/i.test(t.desc || t.file),
    );
    const failedIndex = validationIndex >= 0 ? validationIndex : tasks.length - 1;
    await callbacks.onTodoUpdate(tasks.map((t, j) => ({
      id: j + 1,
      title: t.desc,
      status: (j === failedIndex ? 'failed' : j < tasks.length ? 'completed' : 'not-started') as 'completed' | 'in-progress' | 'not-started' | 'failed',
    })));
  }

  void hadTaskComplete;
  const finalFailed = tasksFailed + (validationFailed ? 1 : 0);
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: finalFailed === 0 ? 'completed' : 'failed',
    title: finalFailed === 0
      ? `全部 ${tasksApplied} 个修改任务已完成`
      : validationFailed
        ? `完成 ${tasksApplied}，验证失败`
        : `完成 ${tasksApplied}，失败 ${tasksFailed}`,
    detail: changedPaths.length > 0
      ? `已写入：${changedPaths.join('、')}${validationFailed ? `\n验证失败：${validationOutcome?.reason || 'validation-failed'}${validationOutcome?.detail ? `\n${validationOutcome.detail.slice(0, 400)}` : ''}` : ''}`
      : undefined,
    taskTotal: tasks.length,
    ...(editedFileRecords.length > 0 ? { editedFiles: editedFileRecords } : {}),
  });

  return {
    tasksTotal: tasks.length,
    tasksApplied,
    tasksFailed: finalFailed,
    changedPaths,
    // G6: return collected analysis text so extension.ts can use it for findings injection
    ...(analysisTexts.length > 0 ? { analysisText: analysisTexts.join('\n\n') } : {}),
  };
}

// ----------------------------------------------------------------
// Agentic free-explore loop (Claude Code style)
// Used when user has no code file attachments — skips Architect+Editor
// two-phase pipeline and lets the LLM drive exploration directly.
// ----------------------------------------------------------------

/** Normal mode ≈ Copilot's toolCallLimit ~25; autopilot mode ≈ Copilot's ~200. */
const AGENTIC_ROUNDS_NORMAL   = 25;
const AGENTIC_ROUNDS_AUTOPILOT = 200;

function buildAgenticSystemPrompt(
  workspaceRoot: string,
  dataFiles: string[],
  mcpTools?: McpToolRef[],
  projectRulesText?: string,
  projectMemoryText?: string,
): string {
  const rulesSection = projectRulesText ? `\n${wrapRulesAsContext(projectRulesText)}\n` : '';
  const memSection  = projectMemoryText ? `\n${wrapMemoryAsContext(projectMemoryText)}\n` : '';
  const filesSection = dataFiles.length > 0
    ? `\n【已附加文件】\n${dataFiles.map(f => `- ${f}`).join('\n')}\n`
    : '';

  let mcpSection = '';
  if (mcpTools && mcpTools.length > 0) {
    const toolLines = mcpTools.map(ref => {
      const schema = JSON.stringify(ref.tool.inputSchema ?? {});
      return `  [TOOL:${ref.fakeName} ${schema}]  — ${ref.tool.description || ref.tool.name}`;
    }).join('\n');
    mcpSection = `\n【MCP 外部工具】\n${toolLines}\n`;
  }

  return `你是一个拥有完整工具访问权限的编程智能体，运行在 VS Code 中。

【工作区根目录】${workspaceRoot}
${rulesSection}${memSection}${filesSection}
【可用工具】

读取文件（代码文件、日志文件、配置文件，支持绝对路径）：
[TOOL:read_file {"path":"/absolute/path/to/file"}]

搜索文件内容（支持正则表达式，支持绝对路径）：
[TOOL:grep_search {"pattern":"关键词","path":"src/","isRegexp":true}]

按 glob 模式查找文件路径（不读取内容）：
[TOOL:file_search {"glob":"src/**/*.ts"}]

语义化搜索（按意图/概念，自动扩展为关键词搜索）：
[TOOL:semantic_search {"query":"用户登录验证处理函数"}]

列出目录内容：
[TOOL:list_dir {"path":"src/utils/"}]

执行 shell 命令（最强大：grep/awk/find/cat/head/wc/编译/运行等）：
[TOOL:run_terminal {"command":"grep -n 'error' /path/file.log | tail -30"}]

将重要发现写入项目记忆（.devseek/memory.md）：
[TOOL:memory_write {"content":"关键记录内容（100字以内）"}]

创建或完整覆写文件（提供绝对路径或相对 workspaceRoot 的路径）：
[TOOL:create_file {"path":"code/hello.cpp","content":"文件全部内容"}]

记录并追踪任务进度（第一轮先用此工具列出子任务；每步开始标 in-progress，完成标 completed）：
[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"任务描述","status":"in-progress"},{"id":2,"title":"另一任务","status":"not-started"}]}]

标记完成并给出结论（每次对话仅调用一次）：
[TOOL:task_complete {"summary":"结论摘要（包含证据：文件路径/行号/具体数值）"}]
${mcpSection}
	【行为准则】
	- 第一轮必须先输出 1-2 句面向用户的自然语言：说明你理解了什么、将如何处理；不要使用固定模板，不要只输出工具调用
	- 开始前先用 manage_todo_list 列出所有子任务（Copilot 规划阶段）
	- 每个子任务开始时标为 in-progress，完成时标为 completed
	- memory_write / 项目记忆属于智能体内部能力，不要放进 manage_todo_list，也不要作为用户可见任务展示
	- 创建/修改文件必须调用 create_file 工具并提供完整 content；“我正在创建/将创建/现在创建”这类自然语言不算执行
	- 用户指定“code 目录/code目录”时，必须把源码写到 ${workspaceRoot}/code/ 下；不要只描述创建，也不要把文件写到扩展目录或临时目录
	- 只有实际写入源码文件后，才能把“代码/程序/实现”类子任务标为 completed；只有实际调用 run_terminal 得到编译/运行/测试结果后，才能把“编译/运行/测试/验证”类子任务标为 completed
- 先思考"需要哪些信息"，再决定调用哪些工具
- 一轮内可输出多个 [TOOL:...] 块（并行调用）
- 工具结果会在下一轮作为上下文提供给你
- 信息足够时，停止工具调用，直接给出结论
- 结论需包含：证据（文件路径/行号/具体数值）
- 使用简体中文`.trim();
}

/**
 * Agentic free-explore loop — Claude Code style single-phase ReAct cycle.
 *
 * Routing decision (extension.ts):
 *   - hasCodeFiles → run Architect+Editor two-phase pipeline (runAgentLoop)
 *   - !hasCodeFiles → run this function (free exploration / investigation)
 *
 * Key design differences vs runAgentLoop:
 *   - No Architect phase: LLM drives tool use directly
 *   - Tool results are fed back into messages history (NOT streamed to chat)
 *   - AI reasoning text (non-tool-call deltas) flows into Working box
 *   - Loop continues until AI calls task_complete or MAX_AGENTIC_ROUNDS
 */
export async function runAgenticLoop(
  userPrompt: string,
  dataFiles: string[],          // non-code files attached by user (.log/.csv/etc.)
  workspaceRoot: string,
  mode: 'fast' | 'r1' | undefined,
  callbacks: AgentLoopCallbacks,
): Promise<AgentLoopResult> {
  const rules  = getProjectRulesSync();
  const memory = getProjectMemorySync();

  const systemPrompt = buildAgenticSystemPrompt(
    workspaceRoot,
    dataFiles,
    callbacks.mcpToolRefs,
    rules ?? undefined,
    memory ?? undefined,
  );

  const promptRequiresTools = /(?:编写|创建|新建|修改|生成|实现|运行|修复|添加|删除|更新|改造|重构|build|compile|test|run|create|write|modify|fix|implement)/i.test(userPrompt);
  const isWorkTool = (name: string) => !['manage_todo_list', 'task_complete', 'memory_write'].includes(name);

  // Full conversation history (Claude Code pattern: accumulate all rounds)
  const messages: ChatMessage[] = [
    { role: 'user', content: systemPrompt + '\n\n' + userPrompt },
  ];

  let roundCount = 0;
  let totalChars = systemPrompt.length + userPrompt.length;
  let hadTaskComplete = false;
  let completeSummary = '';
  let failedReason = '';
  let noToolRounds = 0;
  let sawWorkTool = false;
  const allTerminalEvidence: TerminalEvidence[] = [];
  let currentTodos: TodoItem[] = [];
  let lastMissingEvidence: string[] = [];
  const announcedProseKeys = new Set<string>();
  // Whether the AI has called manage_todo_list yet.
  let todoEverSet = false;
  let fallbackTodosVisible = false;
  // Accumulate files written across all rounds for the phase:done editedFiles payload.
  const allWrittenFiles: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}> = [];

  // Announce Working box to webview — neutral action (not 'analyze') so the
  // container doesn't get data-analyze and won't auto-collapse, regardless of
  // whether the agent ends up analyzing or creating files.
  const _shortPrompt = userPrompt.trim().replace(/\n+/g, ' ');
  const _agentLabel = _shortPrompt.length > 38 ? _shortPrompt.slice(0, 36) + '…' : _shortPrompt;
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'execute',
    taskId: 'agentic',
    taskFile: '',
    taskAction: 'explore',  // triggers "Exploring " prefix in webview for clear intent
    taskIndex: 1,
    taskTotal: 1,
    state: 'started',
    title: _agentLabel,
    detail: '',
  });

  // Infer fallback todos for internal evidence tracking. Do not show them before
  // work begins; if DeepSeek starts real tools without calling manage_todo_list,
  // the first work-tool round below reveals these fallback todos at the point
  // where a task list is actually needed.
  if (promptRequiresTools) {
    const initialTodos = inferInitialAgenticTodos(userPrompt);
    if (initialTodos.length > 0) {
      currentTodos = initialTodos;
    }
  }

  const maxAgenticRounds = callbacks.autopilot ? AGENTIC_ROUNDS_AUTOPILOT : AGENTIC_ROUNDS_NORMAL;
  // Track terminal command signatures across rounds to detect and break stuck loops
  const seenTerminalCmdSignatures = new Map<string, { count: number; lastProgressEpoch: number }>();
  let progressEpoch = 0;
  while (roundCount < maxAgenticRounds) {
    if (callbacks.signal?.aborted) break;
    roundCount++;

    // Context window management: keep first message (system+prompt) + recent 6
    if (totalChars > 80000 && messages.length > 8) {
      const head = messages.slice(0, 1);
      const tail = messages.slice(-6);
      messages.splice(0, messages.length, ...head, ...tail);
    }

    // ── Streaming delta: early manage_todo_list detection ───────────────────
    // As DeepSeek streams its response, detect the first completed manage_todo_list
    // block and fire onTodoUpdate immediately so todos appear in real-time rather
    // than waiting for the full response. Threshold-based to avoid calling
    // parseFakeToolCalls on every single character delta.
    let sAccum = '';
    let sNextCheck = 80;
    let sEarlyFired = false;
    let sNextSpinnerUpdate = 200; // update spinner label every ~200 chars to show progress
    let sLastEarlyToolCheck = 0;
    const sEarlyToolsEmitted = new Set<string>();
    const roundStreamDelta = (delta: string) => {
      // Bridge may send \x00RESET\x00 + fullText to replace accumulated content.
      // Reset sAccum to the new full text instead of appending the corrupt prefix.
      if (delta.startsWith('\x00RESET\x00')) {
        sAccum = delta.slice(7);
        if (!sEarlyFired) sNextCheck = Math.min(sNextCheck, sAccum.length + 1);
      } else {
        sAccum += delta;
      }
      // Show thinking progress in Working box spinner label so user sees DeepSeek is active.
      // This prevents the "no activity" perception while waiting for the full response.
      if (callbacks.onToolActivity && sAccum.length >= sNextSpinnerUpdate) {
        sNextSpinnerUpdate = sAccum.length + 300;
        callbacks.onToolActivity('label' as Parameters<typeof callbacks.onToolActivity>[0], `思考中 (${sAccum.length} 字符)…`);
      }
      if (!sEarlyFired && callbacks.onTodoUpdate && sAccum.length >= sNextCheck) {
        sNextCheck = sAccum.length + 150; // check again in 150 chars
        const earlyTools = parseFakeToolCalls(sAccum);
        const firstTodo = earlyTools.find(t => t.name === 'manage_todo_list');
        if (firstTodo) {
          const earlyItems = normalizeVisibleTodos((firstTodo.input.todoList ?? []) as TodoItem[]);
          if (Array.isArray(earlyItems) && earlyItems.length > 0) {
            if (earlyItems.every(item => item.status === 'completed')) return;
            sEarlyFired = true; // stop checking — already fired
            todoEverSet = true;
            currentTodos = earlyItems;
            void callbacks.onTodoUpdate(earlyItems);
          }
        }
      }
      // Early tool activity: emit activity rows as soon as complete tool blocks are detected
      // in the streaming accumulation — before tools are actually executed.
      // The webview deduplicates by actKind:label, so re-emitting at execution time is safe.
      if (callbacks.onToolActivity && sAccum.length > sLastEarlyToolCheck + 100 && sAccum.includes('[TOOL:')) {
        sLastEarlyToolCheck = sAccum.length;
        const earlyTools = parseFakeToolCalls(sAccum);
        for (const t of earlyTools) {
          if (t.name === 'manage_todo_list') continue; // handled by the todo-detection block above
          const actKey = t.name + ':' + JSON.stringify(t.input ?? {}).slice(0, 50);
          if (!sEarlyToolsEmitted.has(actKey)) {
            sEarlyToolsEmitted.add(actKey);
            const earlyAct = toolCallToEarlyActivity(t);
            if (earlyAct) {
              callbacks.onToolActivity(earlyAct.kind as Parameters<typeof callbacks.onToolActivity>[0], earlyAct.label);
            }
          }
        }
      }
    };

    // Copilot/Claude Code ReAct pattern:
    // - Intermediate rounds (AI calls tools): suppress LLM prose — tool activity
    //   chips in the Working box are enough. Prose reasoning is internal scaffolding.
    // - Final round (no tools called): route AI answer to prose bubble via ASUM.
    // This avoids showing the same content in both working box AND bubble.
    messages.push(...consumeUserSteerMessages(callbacks));
    const { text, tools } = await chatWithMessages(
      messages,
      mode,
      roundStreamDelta,  // stream delta for early todo detection
      callbacks.signal,
      roundCount === 1,
    );

    messages.push({ role: 'assistant', content: text });
    totalChars += text.length;

    const firstToolIndex = findFirstToolCallStart(text);
    const preToolProse = firstToolIndex >= 0 ? stripToolCallBlocks(text.slice(0, firstToolIndex)).trim() : '';
    const userAnnouncement = normalizeAgentUserAnnouncement(preToolProse);
    const userAnnouncementKey = agentAnnouncementKey(userAnnouncement);

    if (userAnnouncement && userAnnouncementKey && !announcedProseKeys.has(userAnnouncementKey)) {
      announcedProseKeys.add(userAnnouncementKey);
      // Route AI's pre-tool intent to the Working box label (Copilot style: no chat bubble).
      // The first sentence of the reasoning becomes "Working: <intent>" in the header.
      const firstSentence = userAnnouncement.split(/[。！\n]/)[0].slice(0, 60).trim();
      if (firstSentence && callbacks.onToolActivity) {
        callbacks.onToolActivity?.('label' as Parameters<typeof callbacks.onToolActivity>[0], firstSentence);
      }
      // Do NOT call onAgentAnnouncement — no chat bubble for pre-tool rounds.
    }

    if (!tools.length) {
      const artifactApply = promptRequiresTools
        ? await applyMarkdownFileArtifactsForLoop(text, userPrompt, workspaceRoot, callbacks)
        : { feedbackForAI: '', writtenFiles: [] as WrittenFileEvidence[] };
      if (artifactApply.writtenFiles.length > 0) {
        sawWorkTool = true;
        noToolRounds = 0;
        allWrittenFiles.push(...artifactApply.writtenFiles);
        progressEpoch++;
        const missingAfterArtifact = getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence);
        const continueMessage = missingAfterArtifact.length > 0
          ? `【系统反馈】已从你输出的文件代码块落地文件，但仍缺少${missingAfterArtifact.join('、')}。请继续调用 run_terminal 编译/运行/测试，完成后再 task_complete。\n${artifactApply.feedbackForAI}`
          : `【系统反馈】已从你输出的文件代码块落地文件。请根据工具结果更新 todo，并在必要时调用 task_complete。\n${artifactApply.feedbackForAI}`;
        messages.push({ role: 'user', content: continueMessage });
        totalChars += continueMessage.length;
        continue;
      }
      const fallbackTodos = normalizeVisibleTodos(extractPlanningTodoItems(text));
      if (fallbackTodos.length > 0) {
        todoEverSet = true;
        currentTodos = fallbackTodos;
        if (callbacks.onTodoUpdate) {
          await callbacks.onTodoUpdate(fallbackTodos);
        }
        const continueMessage = '【系统反馈】任务清单已收到，请立即开始执行第一个任务，不要只停留在规划。';
        messages.push({
          role: 'user',
          content: continueMessage,
        });
        totalChars += continueMessage.length;
        continue;
      }
      const stripped = stripToolCallBlocks(text).trim();
      if (!callbacks.signal?.aborted && promptRequiresTools && !sawWorkTool && noToolRounds < 2) {
        noToolRounds++;
        const userAnnouncement = normalizeAgentUserAnnouncement(stripped);
        const userAnnouncementKey = agentAnnouncementKey(userAnnouncement);
        if (userAnnouncement && userAnnouncementKey && !announcedProseKeys.has(userAnnouncementKey)) {
          announcedProseKeys.add(userAnnouncementKey);
          // No-tool round: route to Working box label (not a bubble) — AI said something but used no tools.
          // This keeps the chat clean; user sees the intent in the Working box header.
          const firstSentence = userAnnouncement.split(/[。！\n]/)[0].slice(0, 60).trim();
          if (firstSentence && callbacks.onToolActivity) {
            callbacks.onToolActivity('label', firstSentence);
          }
        }
        const retryMessage = '【系统反馈】本轮没有检测到任何工具调用，不能把需要创建/修改/运行的任务标记为完成。请继续执行：先更新 manage_todo_list，然后调用 read_file/list_dir/create_file/run_terminal 等实际工具；完成前必须提供可验证的文件或命令结果。';
        messages.push({ role: 'user', content: retryMessage });
        totalChars += retryMessage.length;
        continue;
      }
      const missingWithoutTools = promptRequiresTools
        ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence)
        : [];
      if (!callbacks.signal?.aborted && missingWithoutTools.length > 0 && noToolRounds < 4) {
        noToolRounds++;
        const retryMessage = `【系统反馈】不能停在检查目录或说明阶段。当前缺少${missingWithoutTools.join('、')}。请立即调用 create_file 写入完整源码文件；随后调用 run_terminal 编译并运行验证。不要把 memory_write/项目记忆列为用户 todo。`;
        messages.push({ role: 'user', content: retryMessage });
        totalChars += retryMessage.length;
        continue;
      }
      if (promptRequiresTools && !sawWorkTool) {
        failedReason = stripped || '模型没有执行任何工具调用，任务未实际完成。';
      }
      // Final answer — no more tool calls. Route prose to bubble via ASUM.
      if (!hadTaskComplete && !completeSummary) {
        const visibleStripped = cleanAgentFinalSummaryForUser(stripped);
        if (visibleStripped) completeSummary = visibleStripped;
      }
      break;
    }

    const roundHasWorkTools = tools.some(t => isWorkTool(t.name));
    if (roundHasWorkTools) {
      sawWorkTool = true;
      noToolRounds = 0;
    }

    // Track whether the AI proactively supplied a usable todo list. Merely
    // mentioning manage_todo_list is not enough; malformed/empty payloads should
    // not suppress the fallback todos when real work starts.
    const roundHasVisibleTodoUpdate = tools.some(t =>
      t.name === 'manage_todo_list'
      && normalizeVisibleTodos((t.input.todoList ?? []) as TodoItem[]).length > 0
    );
    if (roundHasVisibleTodoUpdate) todoEverSet = true;
    if (roundHasWorkTools && !todoEverSet && !fallbackTodosVisible && currentTodos.length > 0 && callbacks.onTodoUpdate) {
      await callbacks.onTodoUpdate(currentTodos);
      fallbackTodosVisible = true;
    }

    const missingBeforeTools = promptRequiresTools
      ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence)
      : [];

    const hasExplicitFileWriteTool = tools.some(t => t.name === 'create_file' || t.name === 'write_file');
    const artifactApply = !hasExplicitFileWriteTool
      ? await applyMarkdownFileArtifactsForLoop(text, userPrompt, workspaceRoot, callbacks)
      : { feedbackForAI: '', writtenFiles: [] as WrittenFileEvidence[] };
    if (artifactApply.writtenFiles.length > 0) {
      allWrittenFiles.push(...artifactApply.writtenFiles);
      progressEpoch++;
    }

    const blockedRepeatedTerminalToolIndexes = new Set<number>();
    const loopWarnings: string[] = [];
    const hasFileWriteIntentThisRound = hasExplicitFileWriteTool || artifactApply.writtenFiles.length > 0;
    tools.forEach((tool, toolIndex) => {
      if (tool.name !== 'run_terminal') return;
      const command = typeof tool.input.command === 'string' ? tool.input.command.trim() : '';
      if (!command) return;
      const sig = makeTerminalCmdSignature(command);
      const seen = seenTerminalCmdSignatures.get(sig);
      if (seen && seen.lastProgressEpoch === progressEpoch && !hasFileWriteIntentThisRound) {
        blockedRepeatedTerminalToolIndexes.add(toolIndex);
        loopWarnings.push(getTerminalRecoveryProtocol(command, seen.count + 1));
        callbacks.onToolActivity?.('terminal', `跳过重复命令: ${sig.slice(0, 50)}`);
      }
    });
    const toolsToExecute = blockedRepeatedTerminalToolIndexes.size > 0
      ? tools.filter((_, toolIndex) => !blockedRepeatedTerminalToolIndexes.has(toolIndex))
      : tools;

    // Execute tools — full callbacks so file creation/edits register as pending edits
    const loopRes = await executeFakeToolsForLoop(
      toolsToExecute,
      callbacks,
      workspaceRoot,
      { currentTaskIndex: Number.MAX_SAFE_INTEGER, taskTotal: 1, deferDoneStatus: true, requireWorkBeforeComplete: missingBeforeTools.length > 0, userPrompt },
    );

    if (loopRes.todoItems?.length) {
      currentTodos = loopRes.todoItems;
    }
    if (loopRes.writtenFiles?.length) {
      allWrittenFiles.push(...loopRes.writtenFiles);
      progressEpoch++;
    }
    if (loopRes.terminalEvidence?.length) {
      allTerminalEvidence.push(...loopRes.terminalEvidence);
    }

    // Loop detection: track terminal command signatures across rounds.
    // If the same command is executed 2+ times without making progress, inject
    // a targeted override so the AI is forced to change strategy.
    for (const cmd of loopRes.terminalCommands ?? []) {
      const sig = makeTerminalCmdSignature(cmd);
      const prev = seenTerminalCmdSignatures.get(sig);
      const nextCount = (prev?.count ?? 0) + 1;
      seenTerminalCmdSignatures.set(sig, { count: nextCount, lastProgressEpoch: progressEpoch });
      if (prev && prev.lastProgressEpoch === progressEpoch && nextCount >= 2) {
        loopWarnings.push(getTerminalRecoveryProtocol(cmd, nextCount));
      }
    }
    // Clear any ASUM delta that task_complete may have emitted during this round.
    // Each round's summary is intermediate — only the definitive post-loop ASUM
    // should appear in the prose bubble (Copilot/Claude Code pattern).
    if (roundHasWorkTools) {
      callbacks.onDelta('\x00PROSE_CLEAR\x00');
    }

    const missingAfterTools = promptRequiresTools
      ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence)
      : [];
    lastMissingEvidence = missingAfterTools;

    if ((loopRes.taskComplete || loopRes.allTodosCompleted) && missingAfterTools.length > 0 && !callbacks.signal?.aborted) {
      noToolRounds++;
      if (callbacks.onTodoUpdate && currentTodos.length > 0) {
        currentTodos = markMissingEvidenceTodosIncomplete(currentTodos, missingAfterTools);
        await callbacks.onTodoUpdate(currentTodos);
      }
      const retryMessage = `【系统反馈】不能结束任务。当前仍缺少可验证的${missingAfterTools.join('、')}。请继续调用实际工具完成缺失项：需要代码时用 create_file/write_file 写入源码；需要验证时用 run_terminal 编译/运行/测试；完成后再调用 task_complete，summary 必须只基于真实工具结果。`;
      messages.push({ role: 'user', content: retryMessage });
      totalChars += retryMessage.length;
      continue;
    }

    if (loopRes.taskComplete) {
      if (promptRequiresTools && !sawWorkTool && noToolRounds < 2 && !callbacks.signal?.aborted) {
        noToolRounds++;
        const retryMessage = '【系统反馈】你调用了 task_complete，但还没有执行任何实际工具。请继续完成任务：更新 todo 状态，并调用必要的文件/终端工具后再完成。';
        messages.push({ role: 'user', content: retryMessage });
        totalChars += retryMessage.length;
        continue;
      }
      if (promptRequiresTools && !sawWorkTool) {
        failedReason = cleanAgentFinalSummaryForUser(loopRes.completeSummary || '') || '模型未执行任何实际工具就结束，任务未完成。';
      }
      hadTaskComplete = true;
      completeSummary = loopRes.completeSummary ?? '';
      break;
    }

    // ── Implicit completion: AI marked all todos as completed ────────────────
    // Common in DeepSeek web mode where the AI delivers the full workflow
    // (plan + execute + verify) in a single response without calling task_complete.
    // Treat all-todos-completed as an equivalent signal to avoid a redundant
    // round-2 request that often causes DeepSeek to repeat all tools again.
    if (loopRes.allTodosCompleted && (!promptRequiresTools || sawWorkTool)) {
      break;
    }
    if (loopRes.allTodosCompleted && promptRequiresTools && !sawWorkTool && noToolRounds < 2 && !callbacks.signal?.aborted) {
      noToolRounds++;
      const retryMessage = '【系统反馈】todo 被标记为完成，但还没有任何实际文件/命令工具执行记录。请继续执行真实工作，不要只更新 todo。';
      messages.push({ role: 'user', content: retryMessage });
      totalChars += retryMessage.length;
      continue;
    }

    if (!loopRes.toolCallsMade && loopWarnings.length === 0) break;

    // Inject tool results into next round
    const combinedFeedback = [artifactApply.feedbackForAI, loopRes.feedbackForAI, ...loopWarnings].filter(Boolean).join('\n\n');
    const feedback = `[工具结果 Round ${roundCount}]\n${combinedFeedback}`;
    messages.push({ role: 'user', content: feedback });
    totalChars += feedback.length;
  }

  const finalMissingEvidence = promptRequiresTools
    ? getMissingCompletionEvidence(userPrompt, currentTodos, allWrittenFiles, allTerminalEvidence)
    : [];
  if (!failedReason && finalMissingEvidence.length > 0) {
    failedReason = `实际执行证据不足：缺少${finalMissingEvidence.join('、')}。`;
    if (callbacks.onTodoUpdate && currentTodos.length > 0) {
      currentTodos = markMissingEvidenceTodosIncomplete(currentTodos, finalMissingEvidence);
      await callbacks.onTodoUpdate(currentTodos);
    }
  } else if (!failedReason && lastMissingEvidence.length > 0) {
    failedReason = `实际执行证据不足：缺少${lastMissingEvidence.join('、')}。`;
  }
  if (!failedReason && !callbacks.signal?.aborted && callbacks.onTodoUpdate && currentTodos.length > 0) {
    currentTodos = currentTodos.map(item => ({ ...item, status: 'completed' as const }));
    await callbacks.onTodoUpdate(currentTodos);
  }

  // Emit done phase from runAgenticLoop itself so editedFiles includes files
  // accumulated across all rounds and task_complete cannot race endResponse.
  // Use 'failed' state when aborted cleanly (signal fired between iterations rather than
  // during an LLM call) so the Working box shows ✗ instead of misleading green ✓.
  const cleanAbort = callbacks.signal?.aborted ?? false;
  const visibleCompleteSummary = cleanAgentFinalSummaryForUser(completeSummary);
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'done',
    state: cleanAbort || failedReason ? 'failed' : 'completed',
    title: cleanAbort ? `已中断（${roundCount} 轮）` : (failedReason || visibleCompleteSummary || `完成（${roundCount} 轮）`),
    taskTotal: 1,
    ...(allWrittenFiles.length > 0 ? { editedFiles: allWrittenFiles } : {}),
  });

  // Route final answer to prose bubble.
  // Always emit — PROSE_CLEAR may have cleared any intermediate task_complete summary
  // so we must always send the definitive post-loop ASUM. If no summary exists,
  // emit a minimal completion notice so the user sees the agent finished.
  {
    const fileSummary = allWrittenFiles.length > 0
      ? `已完成，修改 ${allWrittenFiles.length} 个文件：${allWrittenFiles.map(f => `${f.basename} (+${f.linesAdded} -${f.linesRemoved})`).join('、')}。`
      : '';
    const finalMsg = failedReason
      ? `任务没有完成：${failedReason}`
      : (visibleCompleteSummary || fileSummary || '任务已完成。');
    callbacks.onDelta('\x00ASUM\x00' + finalMsg);
  }

  callbacks.onTaskCheckpoint?.(null, []);

  return {
    tasksTotal: 1,
    tasksApplied: 0,
    tasksFailed: 0,
    changedPaths: [],
  };
}
