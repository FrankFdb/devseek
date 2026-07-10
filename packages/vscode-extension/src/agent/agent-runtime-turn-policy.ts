import {
  isReadOnlyRuntimeAction,
  settleAgentRuntimeState,
  type AgentRuntimeState,
} from './agent-runtime-state-machine';
import {
  classifyProviderOutputIntegrity,
  describeProviderOutputIntegrity,
  isProviderOutputFatal,
} from './provider-output-integrity';

const DEFAULT_MAX_NO_TOOL_RECOVERY_ATTEMPTS = 2;

export type ReadOnlyNoToolRecoveryDecision =
  | { kind: 'final-answer' }
  | { kind: 'recover'; feedback: string }
  | { kind: 'give-up'; failedReason: string };

export type AgentRuntimeTurnDecision =
  | { kind: 'tool-results'; state?: AgentRuntimeState }
  | (ReadOnlyNoToolRecoveryDecision & { state?: AgentRuntimeState });

export interface AgentRuntimeTurnInput {
  taskAction: string;
  toolCallsMade: boolean;
  aggregateRaw?: string;
  roundRaw?: string;
  taskTitle: string;
  recoveryAttempts: number;
  maxRecoveryAttempts?: number;
}

export function decideAgentRuntimeTurn(input: AgentRuntimeTurnInput): AgentRuntimeTurnDecision {
  const settlement = settleAgentRuntimeState({
    taskAction: input.taskAction,
    taskTitle: input.taskTitle,
    providerText: input.aggregateRaw,
    roundText: input.roundRaw,
    toolExecutions: input.toolCallsMade ? 1 : 0,
    evidenceRefs: input.toolCallsMade ? [{ kind: 'tool-call', label: 'tool-results' }] : [],
    recoveryAttempts: input.recoveryAttempts,
    maxRecoveryAttempts: input.maxRecoveryAttempts,
  });
  if (input.toolCallsMade) return { kind: 'tool-results', state: settlement.state };
  if (settlement.state === 'failed' && settlement.failedReason) {
    return { kind: 'give-up', failedReason: settlement.failedReason, state: 'failed' };
  }
  if (isReadOnlyRuntimeAction(input.taskAction)) {
    const decision = decideReadOnlyNoToolRecovery({
      aggregateRaw: input.aggregateRaw,
      roundRaw: input.roundRaw,
      taskTitle: input.taskTitle,
      recoveryAttempts: input.recoveryAttempts,
      maxRecoveryAttempts: input.maxRecoveryAttempts,
    });
    return { ...decision, state: decision.kind === 'final-answer' ? 'delivered' : decision.kind === 'recover' ? 'needs_context' : 'failed' };
  }
  const mutatingDecision = decideMutatingNoToolRecovery({
    aggregateRaw: input.aggregateRaw,
    roundRaw: input.roundRaw,
    taskTitle: input.taskTitle,
    recoveryAttempts: input.recoveryAttempts,
    maxRecoveryAttempts: input.maxRecoveryAttempts,
  });
  return { ...mutatingDecision, state: mutatingDecision.kind === 'final-answer' ? (settlement.state === 'delivered' ? 'delivered' : 'verified') : mutatingDecision.kind === 'recover' ? 'needs_context' : 'failed' };
}

export function decideReadOnlyNoToolRecovery(input: {
  aggregateRaw?: string;
  roundRaw?: string;
  taskTitle: string;
  recoveryAttempts: number;
  maxRecoveryAttempts?: number;
}): ReadOnlyNoToolRecoveryDecision {
  const aggregateRaw = input.aggregateRaw || input.roundRaw || '';
  const roundOutput = classifyProviderOutputIntegrity(input.roundRaw || aggregateRaw);
  const aggregateOutput = classifyProviderOutputIntegrity(aggregateRaw);
  if (roundOutput.kind === 'complete_answer' || aggregateOutput.kind === 'complete_answer') {
    return { kind: 'final-answer' };
  }
  if (isProviderOutputFatal(roundOutput.kind)) {
    return {
      kind: 'give-up',
      failedReason: describeProviderOutputIntegrity(roundOutput.kind),
    };
  }

  const maxAttempts = input.maxRecoveryAttempts ?? DEFAULT_MAX_NO_TOOL_RECOVERY_ATTEMPTS;
  if (input.recoveryAttempts < maxAttempts) {
    return {
      kind: 'recover',
      feedback: buildReadOnlyNoToolRecoveryFeedback(input.taskTitle),
    };
  }

  return {
    kind: 'give-up',
    failedReason: `模型没有输出分析结论，也没有给出可执行工具调用；已连续要求继续 ${maxAttempts} 次。`,
  };
}

export function buildReadOnlyNoToolRecoveryFeedback(taskTitle: string): string {
  return [
    '【系统反馈】上一轮没有检测到可执行工具调用，也没有产出本任务的分析结论。',
    `当前任务：${taskTitle}`,
    '请基于已经读取到的工具结果继续，并严格二选一：',
    '1. 如果还需要上下文，直接输出具体工具调用（read_file/list_dir/grep_search/只读 run_terminal），必须包含明确 path、pattern 或 command；不要只说“我再查看”。',
    '2. 如果证据已经足够，直接输出最终分析结论，至少包含：结论、依据、主要差异/风险、对策建议或任务拆解。',
    '本任务是只读分析任务，不要修改文件，也不要把工具意图当成最终答复。',
  ].join('\n');
}

export function buildMutatingNoToolRecoveryFeedback(taskTitle: string): string {
  return [
    '【系统反馈】上一轮没有检测到可执行工具调用，也没有产出可应用的代码修改。',
    `当前任务：${taskTitle}`,
    '请严格三选一：',
    '1. 如果需要上下文，调用 read_file/list_dir/grep_search/只读 run_terminal 收集证据。',
    '2. 如果要修改文件，调用 create_file/write_file，或直接输出完整 SEARCH/REPLACE 补丁/完整目标文件内容。',
    '3. 如果验证失败，先说明根因并修改相关源码，再运行验证；不要只说“继续修复”或“现在生成”。',
    '不能把短意图、过渡句或空壳总结当成编辑任务完成。',
  ].join('\n');
}

function decideMutatingNoToolRecovery(input: {
  aggregateRaw?: string;
  roundRaw?: string;
  taskTitle: string;
  recoveryAttempts: number;
  maxRecoveryAttempts?: number;
}): ReadOnlyNoToolRecoveryDecision {
  const aggregateRaw = input.aggregateRaw || input.roundRaw || '';
  const roundRaw = input.roundRaw || aggregateRaw;
  if (looksLikeInlineEditArtifact(aggregateRaw) || looksLikeInlineEditArtifact(roundRaw)) {
    return { kind: 'final-answer' };
  }
  const roundOutput = classifyProviderOutputIntegrity(roundRaw);
  if (isProviderOutputFatal(roundOutput.kind)) {
    return {
      kind: 'give-up',
      failedReason: describeProviderOutputIntegrity(roundOutput.kind),
    };
  }
  const maxAttempts = input.maxRecoveryAttempts ?? DEFAULT_MAX_NO_TOOL_RECOVERY_ATTEMPTS;
  if (roundOutput.kind === 'short_intent' || roundOutput.kind === 'incomplete_answer') {
    if (input.recoveryAttempts < maxAttempts) {
      return {
        kind: 'recover',
        feedback: buildMutatingNoToolRecoveryFeedback(input.taskTitle),
      };
    }
    return {
      kind: 'give-up',
      failedReason: `模型没有输出可应用补丁、完整文件内容或工具调用；已连续要求继续 ${maxAttempts} 次。`,
    };
  }
  return { kind: 'final-answer' };
}

function looksLikeInlineEditArtifact(text: string | undefined): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/<<<<<<< SEARCH\n[\s\S]+?\n=======\n[\s\S]*?\n>>>>>>> REPLACE/.test(raw)) return true;
  if (/```(?:[A-Za-z0-9_+#.-]+)?\s*[\s\S]{80,}?```/.test(raw)) return true;
  return /(?:^|\n)\s*(?:#include\s+[<"]|class\s+\w+|struct\s+\w+|template\s*<|export\s+(?:function|class|const)|function\s+\w+|def\s+\w+\()/m.test(raw);
}

export { isReadOnlyRuntimeAction, settleAgentRuntimeState };
