/**
 * LLM Agent Loop — L-1 + L-4 实现
 *
 * 实现真正的多轮 Agent 循环，对齐 Copilot _runLoop 模式：
 * - 每轮携带完整对话历史（L-4: 跨轮上下文传递）
 * - 支持最多 MAX_ROUNDS 轮自动循环
 * - 每轮完成后通过回调更新 UI 状态
 * - 支持 task_complete 工具显式退出
 *
 * 与现有 agent-loop.ts 的关系：
 * - agent-loop.ts: Phase-1 执行器（SEARCH/REPLACE 应用引擎），处理具体文件编辑
 * - llm-agent-loop.ts（本文件）: 对话历史层，管理多轮 LLM 调用
 *
 * 当前阶段（P2 渐进式）：
 * - 维护 MessageHistory，每轮 LLM 输出追加到历史
 * - 通过系统提示词让 AI 知道历史上下文
 * - 保持与现有 agent-loop.ts 兼容（不替换，而是增强）
 */

import { ChatMessage, LLMChatOptions } from './llm/types';
import { getActiveProvider } from './llm/provider-router';
import { getProjectRules, wrapRulesAsContext } from './project-rules';

export const MAX_ROUNDS = 25;

// I-3: token 预算（留足 system prompt + 当前消息 + 响应的空间）
// 大多数模型上下文 8k~32k tokens，历史预算保守取 4000 tokens
const HISTORY_MAX_TOKENS = 4000;
// 保留最近完整对话轮数（user+assistant 各算 1 条）
const KEEP_RECENT_MESSAGES = 8;

// ── 对话历史类型 ──────────────────────────────────────────────────

export interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  /** 这一轮完成了哪些任务（用于历史摘要） */
  roundSummary?: string;
}

export interface LoopCallbacks {
  /** 流式文本 delta */
  onDelta: (delta: string) => void;
  /** 每轮开始/结束时的状态通知 */
  onRoundStatus: (round: number, phase: 'start' | 'end', summary?: string) => void;
  /** 循环完成 */
  onComplete: (rounds: number, finalText: string) => void;
  /** 循环出错 */
  onError: (round: number, err: Error) => void;
  /** 取消信号 */
  signal?: AbortSignal;
}

// ── 历史管理 ──────────────────────────────────────────────────────

/**
 * I-3: 粗粒度 token 估算。
 * - ASCII 字符: ~4字符/token
 * - CJK（中文/日文/韩文）字符: ~1字符/token
 * 这是近似值，避免引入 tokenizer 依赖。
 */
function estimateTokens(text: string): number {
  let tokens = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // CJK Unified Ideographs + CJK Extension A/B + Hangul + Hiragana/Katakana
    if ((code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0x3040 && code <= 0x30FF)) {
      tokens += 1;
    } else {
      tokens += 0.25;
    }
  }
  return Math.ceil(tokens);
}

/**
 * I-3: 将历史按 token 预算压缩。
 *
 * 策略：
 * 1. 保留最近 KEEP_RECENT_MESSAGES 条（保证当前对话连贯）
 * 2. 若总 token 超过预算，进一步缩减更早的历史摘要
 * 3. 摘要使用 role:'system'（而非 role:'user'），避免破坏 user/assistant 交替结构
 */
function compressHistory(history: HistoryEntry[]): ChatMessage[] {
  if (history.length === 0) return [];

  const totalTokens = history.reduce((s, h) => s + estimateTokens(h.content), 0);

  // 未超预算 → 原样返回
  if (totalTokens <= HISTORY_MAX_TOKENS) {
    return history.map(h => ({ role: h.role, content: h.content }));
  }

  // 保留最近 N 条，其余压缩为摘要
  const recent = history.slice(-KEEP_RECENT_MESSAGES);
  const old = history.slice(0, -KEEP_RECENT_MESSAGES);

  // 检查即使只留最近 N 条是否仍超预算 → 进一步缩减
  const recentTokens = recent.reduce((s, h) => s + estimateTokens(h.content), 0);
  let finalRecent = recent;
  if (recentTokens > HISTORY_MAX_TOKENS * 0.9) {
    // 只保留最近 4 条，极端情况下保证不溢出
    finalRecent = history.slice(-4);
  }

  if (old.length === 0) {
    return finalRecent.map(h => ({ role: h.role, content: h.content }));
  }

  // 生成摘要：优先使用 roundSummary，否则截断前 80 字符
  const summaryLines = old.map((h, idx) => {
    const label = h.role === 'user' ? '用户' : 'AI';
    const preview = (h.roundSummary ?? h.content).slice(0, 80).replace(/\n/g, ' ');
    const ellipsis = (h.roundSummary ?? h.content).length > 80 ? '…' : '';
    return `[轮${idx + 1}/${label}] ${preview}${ellipsis}`;
  });

  // 使用 system role 包装摘要，不破坏 user/assistant 交替结构
  const summaryMsg: ChatMessage = {
    role: 'system',
    content: `[历史上下文摘要（${old.length} 条，已压缩以节省 token）]\n${summaryLines.join('\n')}\n[摘要结束]`,
  };

  return [summaryMsg, ...finalRecent.map(h => ({ role: h.role, content: h.content }))];
}

// ── task_complete 检测 ─────────────────────────────────────────────

/** 检测 AI 输出是否包含任务完成信号（同时支持 fake tool call 格式和文本格式） */
function detectTaskComplete(text: string): boolean {
  // fake tool call 格式: [TOOL:task_complete {...}]
  if (/\[TOOL:task_complete\s*\{/.test(text)) return true;
  // 兼容旧式文本模式
  return /\[TASK_COMPLETE\]|任务(?:全部)?完成[。！\n]|已完成所有(?:任务|修改)|所有任务(?:均)?已完成/.test(text);
}

// ── 系统提示词 ────────────────────────────────────────────────────

function buildSystemPrompt(projectRules: string | null): string {
  const rulesSection = projectRules ? `\n\n${wrapRulesAsContext(projectRules)}` : '';
  return `你是一个专业的 AI 编程助手。${rulesSection}

## 工作流程（必须严格遵守）

### 第一步—制定计划
收到用户请求后，首先调用 manage_todo_list 建立完整任务列表：
- 每项任务匹配一个具体目标（如 “修改 src/foo.ts: 补充返回类型”）
- 状态初始化为 not-started
- 第一个任务设为 in-progress

### 第二步—逐项执行
每开始一项任务前，调用 manage_todo_list 将其更新为 in-progress。
完成后调用 manage_todo_list 将其更新为 completed。
每次调用必须展示完整列表（全量替换）。

### 第三步—显式结束
所有任务完成后，输出简洁的完成摘要，然后调用 task_complete。
如果中途发现无法完成某项任务，也应将其标记为 completed（并说明原因）后调用 task_complete。

## 工具调用格式

在回复末尾以文本嵌入格式调用工具（JSON 必须完整）：

[TOOL:manage_todo_list {"todoList":[{"id":1,"title":"任务标题","status":"in-progress"},{"id":2,"title":"另一任务","status":"not-started"}]}]

[TOOL:task_complete {"summary":"完成了什么的简要说明"}]

状态枚举："not-started" | "in-progress" | "completed"

## 核心原则
- 修改代码前必须先阅读相关文件内容
- 永远不要只输出计划而不执行
- 递增式修改，每次改动后说明做了什么`;
}

// ── 主循环 ────────────────────────────────────────────────────────

/**
 * 运行多轮 LLM 对话循环（L-1 + L-4）
 * @param userPrompt 用户的初始请求
 * @param callbacks  UI/状态回调
 * @param maxRounds  最大循环轮次（默认 MAX_ROUNDS）
 * @returns 最终 AI 输出文本
 */
export async function runLLMAgentLoop(
  userPrompt: string,
  callbacks: LoopCallbacks,
  maxRounds = MAX_ROUNDS,
): Promise<string> {
  const history: HistoryEntry[] = [];
  const provider = getActiveProvider();
  const projectRules = await getProjectRules();
  const systemPrompt = buildSystemPrompt(projectRules);

  let finalText = '';
  let round = 0;

  while (round < maxRounds) {
    if (callbacks.signal?.aborted) break;

    round++;
    callbacks.onRoundStatus(round, 'start');

    // 构建本轮消息列表：系统提示 + 压缩历史 + 当前用户请求
    const compressedHistory = compressHistory(history);
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...compressedHistory,
      // 第一轮是原始问题；后续轮次如有历史则无需重复
      ...(round === 1 ? [{ role: 'user' as const, content: userPrompt }] : []),
    ];

    // 如果第一轮之后无新 user 消息（纯续跑），提示 AI 继续
    if (round > 1 && (compressedHistory.length === 0 || compressedHistory[compressedHistory.length - 1].role === 'assistant')) {
      messages.push({ role: 'user', content: '请继续完成剩余任务。' });
    }

    let roundText = '';
    const chatOpts: LLMChatOptions = {
      messages,
      stream: true,
      onDelta: (delta) => {
        roundText += delta;
        callbacks.onDelta(delta);
      },
      signal: callbacks.signal,
    };

    try {
      await provider.chat(chatOpts);
    } catch (e) {
      callbacks.onError(round, e as Error);
      break;
    }

    finalText = roundText;
    history.push({ role: 'assistant', content: roundText });

    callbacks.onRoundStatus(round, 'end', roundText.slice(0, 100));

    // 检测 AI 是否明确完成
    if (detectTaskComplete(roundText)) break;

    // AI 未输出任何内容 → 退出
    if (!roundText.trim()) break;
  }

  callbacks.onComplete(round, finalText);
  return finalText;
}

// ── 便捷工具：将单次 chat() 结果追加到历史 ────────────────────────

/** 创建一个可复用的对话历史容器，供外部代码管理会话历史 */
export class ConversationHistory {
  private entries: HistoryEntry[] = [];

  append(role: 'user' | 'assistant', content: string, summary?: string): void {
    this.entries.push({ role, content, roundSummary: summary });
  }

  toMessages(systemPrompt?: string): ChatMessage[] {
    const msgs: ChatMessage[] = [];
    if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
    msgs.push(...compressHistory(this.entries));
    return msgs;
  }

  clear(): void { this.entries = []; }

  get length(): number { return this.entries.length; }

  /** 最近一条 assistant 消息 */
  lastAssistant(): string | undefined {
    return [...this.entries].reverse().find(e => e.role === 'assistant')?.content;
  }
}
