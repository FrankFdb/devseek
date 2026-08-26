import type {
  CodingToolExecutionReceipt,
  CodingVerificationReceipt,
  CodingWorkspaceMutationReceipt,
} from '@devseek-netai/shared';
import type { TerminalEvidence } from './completion-evidence';
import type { TodoItem } from './evidence-recovery';
import type { EvidenceRef } from './tool-executor';

/** Evidence-bearing result contract between normalized tool execution and the turn loop. */
export interface ToolLoopResult {
  taskComplete: boolean;
  toolCallsMade: boolean;
  workToolCallsMade: boolean;
  feedbackForAI: string;
  /** Ordered feedback boundaries retained when observations execute independently. */
  feedbackSegmentsForAI?: string[];
  completeSummary?: string;
  allTodosCompleted?: boolean;
  todoItems?: TodoItem[];
  summaryEmitted?: boolean;
  terminalCommands?: string[];
  terminalOutputs?: Array<{command: string; workdir: string; output: string}>;
  terminalEvidence?: TerminalEvidence[];
  writtenFiles?: Array<{path: string; basename: string; linesAdded: number; linesRemoved: number; action: string}>;
  readFiles?: string[];
  evidenceRefs?: EvidenceRef[];
  changeReceipts?: CodingWorkspaceMutationReceipt<unknown>[];
  toolExecutionReceipts?: CodingToolExecutionReceipt<unknown>[];
  verificationReceipts?: CodingVerificationReceipt[];
  toolFailures?: ToolFailureEvidence[];
}

export interface ToolFailureEvidence {
  tool: string;
  kind: 'write' | 'replace' | 'terminal-guard' | 'terminal-capability' | 'tool-host';
  path?: string;
  reason: string;
  /** Digest of the concrete proposal; changed parameters are a new strategy. */
  strategyFingerprint?: string;
}

export interface ToolSuppressionEvidence {
  tool: string;
  reason:
    | 'repeated-terminal-without-progress'
    | 'repeated-context-without-progress'
    | 'covered-context-without-progress';
}
