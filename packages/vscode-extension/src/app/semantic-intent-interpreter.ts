import { getActiveProvider } from '../llm/provider-router';
import type { ExecutionMode } from '../intent/intent-types';
import {
  normalizeSemanticIntent,
  type RawSemanticIntentInterpretation,
  type SemanticIntentInterpretation,
} from '../intent/semantic-intent';

export interface SemanticIntentInterpreterInput {
  userText: string;
  files: string[];
  mode?: 'fast' | 'r1';
  signal?: AbortSignal;
  localMode: ExecutionMode;
  agentEnabled: boolean;
  forceNoAgent?: boolean;
}

const SEMANTIC_INTENT_TIMEOUT_MS = 35_000;

export async function interpretSemanticIntent(
  input: SemanticIntentInterpreterInput,
): Promise<SemanticIntentInterpretation | undefined> {
  if (!shouldAskProviderForSemanticIntent(input)) return undefined;

  const provider = getActiveProvider();
  if (provider.capabilities?.includes('web')) return undefined;

  const rawText = await provider.chat({
    messages: [
      { role: 'system', content: buildSemanticIntentSystemPrompt() },
      { role: 'user', content: buildSemanticIntentUserPrompt(input) },
    ],
    stream: false,
    mode: input.mode,
    signal: input.signal,
    newSession: true,
    timeoutMs: SEMANTIC_INTENT_TIMEOUT_MS,
  });

  return parseSemanticIntentResponse(rawText);
}

export function shouldAskProviderForSemanticIntent(input: SemanticIntentInterpreterInput): boolean {
  const text = input.userText.trim();
  if (!text) return false;
  if (!input.agentEnabled || input.forceNoAgent) return false;
  if (input.localMode === 'smalltalk') return false;
  return true;
}

export function parseSemanticIntentResponse(rawText: string): SemanticIntentInterpretation | undefined {
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) return undefined;
  try {
    return normalizeSemanticIntent(JSON.parse(jsonText) as RawSemanticIntentInterpretation, 'provider');
  } catch {
    return undefined;
  }
}

function buildSemanticIntentSystemPrompt(): string {
  return [
    '你是 DevSeek 的语义意图解释器，只做自然语言意图理解，不解决任务，不输出代码，不调用工具。',
    '你必须只输出一个严格 JSON 对象，不要 Markdown，不要解释。',
    'mode 只能是: smalltalk, qa, inspect, plan, edit, run, destructive。',
    'task_kind 只能是: smalltalk, question-answer, read-only-analysis, planning, code-review, standalone-program, file-artifact, existing-project-edit, terminal-validation, external-effect, destructive, ambiguous。',
    'mutation 只能是: none, create-file, modify-source, delete, run-only, external-effect。',
    '判定原则：优先理解用户真实目标；不要因为出现“代码/文件/测试”等词就自动判为修改；如果用户要求“不要写/不要修改/只回答/只给建议”，mutation 必须为 none，mode 通常为 inspect 或 plan。',
    '如果用户要求创建、修改、修复、重构、生成可保存文件，mode 通常为 edit；如果只要求运行/编译/测试且不修改，mode 为 run。',
    '如果用户要求 git push/pull/commit、安装依赖、发布、部署、联网或账号操作，使用 external-effect 语义，并倾向 edit 或 run；破坏性删除用 destructive。',
    'confidence 用 0 到 1；不确定但需要继续探索时用 ambiguous 或 plan，并设置 requires_clarification。',
  ].join('\n');
}

function buildSemanticIntentUserPrompt(input: SemanticIntentInterpreterInput): string {
  const files = input.files.slice(0, 12).map(file => `- ${file}`).join('\n') || '（无显式附件）';
  return [
    '请将下面用户请求解释为 DevSeek 工作流意图。',
    '',
    '用户请求：',
    input.userText,
    '',
    '本轮显式/推断上下文文件：',
    files,
    '',
    '只输出 JSON，字段如下：',
    '{"mode":"edit","task_kind":"standalone-program","confidence":0.95,"mutation":"create-file","target_paths":[],"requires_workspace":true,"requires_terminal":true,"requires_external_effect":false,"requires_clarification":false,"reason":"用户要求编写并验证一个程序"}',
  ].join('\n');
}

function extractJsonObject(text: string): string | undefined {
  const fenceRe = /```(?:json|JSON)?\s*\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;
  let lastObjectFence = '';
  while ((match = fenceRe.exec(text)) !== null) {
    const body = match[1].trim();
    if (body.startsWith('{')) lastObjectFence = body;
  }
  if (lastObjectFence) return lastObjectFence;

  let depth = 0;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === '"') {
      index += 1;
      while (index < text.length) {
        if (text[index] === '\\') index += 1;
        else if (text[index] === '"') break;
        index += 1;
      }
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}
