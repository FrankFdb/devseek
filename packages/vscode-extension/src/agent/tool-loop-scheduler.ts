import type { CodingToolCall } from '@devseek-netai/shared';
import type { FakeTool } from './fake-tool-parser';
import type { ToolLoopResult } from './tool-loop-result';

type SchedulableTool = FakeTool | CodingToolCall;
type ToolBatchExecutor = (tools: SchedulableTool[]) => Promise<ToolLoopResult>;

const MAX_PARALLEL_OBSERVATIONS = 4;
const PARALLEL_LOCAL_OBSERVATION_TOOLS = new Set([
  'read_file',
  'grep_search',
  'file_search',
  'search_file',
  'semantic_search',
  'list_dir',
  'get_errors',
  'get_changed_files',
  'vscode_listCodeUsages',
]);

/**
 * Mirrors Codex's capability-gated parallel tool execution for the narrow set
 * whose handlers are locally read-only. Mixed/effectful batches retain the
 * established serial ToolLoop so read-before-write and completion state stay
 * under one owner.
 */
export async function executeScheduledToolLoop(
  tools: SchedulableTool[],
  executeBatch: ToolBatchExecutor,
): Promise<ToolLoopResult> {
  if (tools.length < 2 || !tools.every(isParallelLocalObservation)) {
    return executeBatch(tools);
  }

  const results: ToolLoopResult[] = [];
  for (let offset = 0; offset < tools.length; offset += MAX_PARALLEL_OBSERVATIONS) {
    const wave = tools.slice(offset, offset + MAX_PARALLEL_OBSERVATIONS);
    results.push(...await Promise.all(wave.map(tool => executeBatch([tool]))));
  }
  return mergeToolLoopResults(results);
}

export function isParallelLocalObservation(tool: SchedulableTool): boolean {
  if (!PARALLEL_LOCAL_OBSERVATION_TOOLS.has(tool.name)) return false;
  if (!isCanonicalToolCall(tool)) return true;
  return tool.executable
    && tool.registered
    && tool.purpose === 'observe'
    && tool.effects.every(effect => effect === 'read');
}

function isCanonicalToolCall(tool: SchedulableTool): tool is CodingToolCall {
  return 'purpose' in tool && 'effects' in tool && 'executable' in tool;
}

function mergeToolLoopResults(results: readonly ToolLoopResult[]): ToolLoopResult {
  const lastWithTodos = [...results].reverse().find(result => result.todoItems !== undefined);
  const lastWithSummary = [...results].reverse().find(result => result.completeSummary !== undefined);
  const feedbackSegmentsForAI = results.flatMap(result => (
    result.feedbackSegmentsForAI?.length
      ? result.feedbackSegmentsForAI
      : result.feedbackForAI ? [result.feedbackForAI] : []
  ));
  return {
    taskComplete: results.some(result => result.taskComplete),
    toolCallsMade: results.some(result => result.toolCallsMade),
    workToolCallsMade: results.some(result => result.workToolCallsMade),
    feedbackForAI: feedbackSegmentsForAI.join('\n\n'),
    feedbackSegmentsForAI,
    ...(lastWithSummary?.completeSummary === undefined
      ? {}
      : { completeSummary: lastWithSummary.completeSummary }),
    allTodosCompleted: results.some(result => result.allTodosCompleted),
    ...(lastWithTodos?.todoItems === undefined ? {} : { todoItems: lastWithTodos.todoItems }),
    summaryEmitted: results.some(result => result.summaryEmitted),
    terminalCommands: results.flatMap(result => result.terminalCommands ?? []),
    terminalOutputs: results.flatMap(result => result.terminalOutputs ?? []),
    terminalEvidence: results.flatMap(result => result.terminalEvidence ?? []),
    writtenFiles: results.flatMap(result => result.writtenFiles ?? []),
    readFiles: results.flatMap(result => result.readFiles ?? []),
    evidenceRefs: results.flatMap(result => result.evidenceRefs ?? []),
    changeReceipts: results.flatMap(result => result.changeReceipts ?? []),
    toolExecutionReceipts: results
      .flatMap(result => result.toolExecutionReceipts ?? [])
      .sort((left, right) => left.sequence - right.sequence),
    verificationReceipts: results.flatMap(result => result.verificationReceipts ?? []),
    toolFailures: results.flatMap(result => result.toolFailures ?? []),
  };
}
