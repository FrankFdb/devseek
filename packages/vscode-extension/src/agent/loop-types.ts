import type { AgentTask } from '../agent-task-decomposer';
import type { AppliedChangeRecord, ApplyWorkflowStatus } from '../workspace-applier';
import type { McpToolRef } from '../mcp/client';
import type { MemoryWriteProposal } from '../memory/types';
import type { AgentStatusEvent } from './events';
import type { TodoItem } from './evidence-recovery';
import type { ExecutionMode } from '../intent/intent-types';
import type { AgentFileWriteContext } from '../app/agent-file-write-policy';
import type { ArtifactClaim, EvidenceRef, VerificationResult } from './evidence-grounding';
import type { ValidationCommandRunner } from '../workspace/validation-service';
import type {
  CodingCompletionAcceptanceDecision,
  CodingCompletionDecision,
  CodingConformanceProjection,
  CodingCheckpoint,
  CodingExternalEffectReconciliation,
  CodingExternalEffectSessionPort,
  CodingToolExecutionSessionPort,
  ProviderEventPort,
  ToolDispatchPort,
  CodingToolAuthoritySessionPort,
  CodingToolExecutionReceipt,
  CodingToolHostResult,
  CodingToolSurfaceConstraint,
  CodingVerificationReceipt,
  CodingVerificationCriterion,
  CodingVerificationSessionPort,
  BuildOrchestrationPort,
  VerifierSelectionPort,
  CodingWorkspaceMutationReceipt,
  WorkspaceMutationTransactionPort,
} from '@devseek-netai/shared';

export type AgentStatusMessage = AgentStatusEvent;

export interface AgentPreparedToolExecution<TResult = string> {
  /** Surface-local policy/confirmation constraint; the Kernel remains the authority issuer. */
  readonly constraint: CodingToolSurfaceConstraint;
  readonly reconciliationScope?: 'process-local' | 'durable';
  reconcile?(): Promise<CodingExternalEffectReconciliation<TResult>>;
  execute(): Promise<CodingToolHostResult<TResult>>;
}

export type AgentPreparedTerminalCommand = AgentPreparedToolExecution<string>;

export interface AgentDirectoryCreationResult {
  readonly message: string;
  readonly changeReceipt: CodingWorkspaceMutationReceipt<unknown>;
}

export interface AgentLoopCallbacks {
  /** Current intent/tool-policy mode. Used by the runtime task policy guard. */
  executionMode?: ExecutionMode;
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
  /** One diagnostic trace id shared by all provider/tool rounds in this top-level run. */
  traceRunId?: string;
  /** Kernel-owned execution sessions. Product execution always supplies the complete set. */
  canonicalToolAuthority?: CodingToolAuthoritySessionPort;
  canonicalToolExecution?: CodingToolExecutionSessionPort;
  canonicalWorkspaceMutations?: WorkspaceMutationTransactionPort;
  canonicalExternalEffects?: CodingExternalEffectSessionPort;
  canonicalVerifierSelection?: VerifierSelectionPort;
  canonicalBuildOrchestration?: BuildOrchestrationPort;
  canonicalVerificationAcceptance?: readonly CodingVerificationCriterion[];
  canonicalVerification?: CodingVerificationSessionPort;
  canonicalProviderEvents?: ProviderEventPort;
  canonicalToolDispatch?: ToolDispatchPort;
  /** Unified filesystem root for this run's provider/tool trace files. */
  traceWorkspaceRoot?: string;
  /** Run-scoped participant capability used by provider/Bridge evidence adapters. */
  traceEvidenceParticipantToken?: string;
  /** Marks the owner run degraded while allowing the coding operation to continue. */
  onTraceEvidenceError?: (error: unknown) => void;
  /**
   * Session checkpoint callback — called after each task completes (success or fail).
   * Extension saves the next-pending-task index to workspaceState for resume-on-reconnect.
   * Called with null for completedUpToIndex when the full loop finishes (clears checkpoint).
   */
  onTaskCheckpoint?: (
    completedUpToIndex: number | null,
    remainingTasks: AgentTask[],
    reason?: 'progress' | 'paused' | 'completed',
    checkpoint?: CodingCheckpoint,
  ) => void | Promise<void>;
  /**
   * L-3: AI called task_complete — terminate the agent loop.
   * Returns true to signal the loop should stop.
   */
  onTaskComplete?: (summary: string) => void | Promise<void>;
  onMemoryWrite?: (proposal: MemoryWriteProposal) => Promise<void>;
  /**
   * P3-5: AI called an MCP tool (mcp__server__tool) — route to McpManager.
   * Return the tool's text output so it can be injected back into the conversation.
   */
  onPrepareMcpToolCall?: (
    fakeName: string,
    args: Record<string, unknown>,
  ) => Promise<AgentPreparedToolExecution<string>>;
  /**
   * P3-5: Available MCP tools to advertise in the system prompt.
   * Populated from McpManager.toolRefs on activation.
   */
  mcpToolRefs?: McpToolRef[];
  /** Settles terminal policy/approval evidence before exposing the one-shot host capability. */
  onPrepareTerminalCommand?: (
    command: string,
    workdir?: string,
  ) => Promise<AgentPreparedTerminalCommand>;
  /** Automatic build/test commands must use the product's side-effect authority. */
  /** Evidence-aware authority for every automatic validation process. */
  onValidationCommand: ValidationCommandRunner;
  /**
   * Resolve product policy and user-confirmation evidence before a file effect.
   * The returned Surface constraint cannot grant final execution authority.
   */
  onResolveFileWriteConstraint?: (
    absPath: string,
    context?: AgentFileWriteContext,
  ) => Promise<CodingToolSurfaceConstraint>;
  /**
   * AI called read_file — return an AI-readable file context with metadata.
   * workDir resolves bare filenames against the current task directory first.
   * startLine/endLine let the model continue through large files by range.
   */
  onReadFile?: (path: string, workDir?: string, range?: { startLine?: number; endLine?: number }) => Promise<string>;
  /**
   * AI called grep_search — search workspace files for a regex/text pattern.
   * Returns matching lines in file:line: content format.
   * workDir (optional): absolute path of the current task's directory — when the AI
   * does not pass an explicit path, search is scoped to this directory rather than
   * the entire workspace root (prevents grep_search returning noise from unrelated projects).
   */
  onGrepSearch?: (
    pattern: string,
    path?: string,
    isRegexp?: boolean,
    workDir?: string,
    options?: { includePattern?: string; fileTypes?: string },
  ) => Promise<string>;
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
  onToolActivity?: (kind: 'read' | 'search' | 'list' | 'terminal' | 'memory' | 'write' | 'web' | 'todo' | 'label' | 'diagnostics' | 'vscode-command' | 'mcp', label: string) => void;
  /**
   * AI called get_changed_files — return git status/diff of current workspace.
   * Corresponds to Copilot's #search/changes tool.
   */
  onGetChangedFiles?: () => Promise<string>;
  /**
   * AI called create_directory — create a directory (and parents) in workspace.
   * Corresponds to Copilot's #edit/createDirectory tool.
   */
  onCreateDirectory?: (
    path: string,
    authorization: {
      readonly policyPreauthorized: true;
      readonly transaction: WorkspaceMutationTransactionPort;
      readonly runId: string;
      readonly sequence: number;
      readonly actionId: string;
      readonly evidenceRefs: readonly string[];
    },
  ) => Promise<AgentDirectoryCreationResult>;
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
   * AI called run_vscode_command — execute a command from DevSeek's closed,
   * typed VS Code registry. Workspace-mutating entries require permission;
   * unknown commands and terminal-owned build/test actions fail before dispatch.
   */
  onPrepareVscodeCommand?: (
    command: string,
    args?: unknown[],
  ) => Promise<AgentPreparedToolExecution<string>>;
  /**
   * User steering entered while the current agent run is active.
   * Consumed at round boundaries so the next model call treats it as an
   * incremental correction/supplement, not as a brand-new task.
   */
  onUserSteer?: () => string[];
  /**
   * Display-only classification for the first free-explore Working row.
   * This must not affect tool execution; it only prevents UI from describing
   * safe/literal responses as workspace exploration.
   */
  runDisplayAction?: AgentTask['action'];
  runDisplayTarget?: string;
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

/** Top-level loop compositions must bind one explicit tool-policy mode. */
export type ExecutionScopedAgentLoopCallbacks = AgentLoopCallbacks & {
  executionMode: ExecutionMode;
};

export interface AgentLoopResult {
  tasksTotal: number;
  tasksApplied: number;
  tasksFailed: number;
  changedPaths: string[];
  /** True when work is applied and executable, but final judgment needs human observation (GUI/interactive output). */
  manualReviewRequired?: boolean;
  manualReviewReason?: string;
  /** Full text of analysis output, populated when all tasks were analyze/explain.
   *  Callers can pass this to extractAnalysisFindings() and feed into next decomposeTask. */
  analysisText?: string;
  /** Collapsible, user-visible summary persisted into restored chat history. */
  historyText?: string;
  /** Immutable host evidence and claim verdicts retained through top-level settlement/replay. */
  verificationIds?: string[];
  evidenceRefs?: EvidenceRef[];
  artifactClaims?: ArtifactClaim[];
  verificationResults?: VerificationResult[];
  /** Shared immutable verification receipts emitted by product validation paths. */
  verificationReceipts?: CodingVerificationReceipt[];
  /** Shared immutable tool receipts emitted by effectful product tool paths. */
  toolExecutionReceipts?: CodingToolExecutionReceipt<unknown>[];
  /** Shared immutable workspace mutation receipts emitted by product write paths. */
  changeReceipts?: CodingWorkspaceMutationReceipt<unknown>[];
  /** Direct acceptance evidence whose semantic owner is outside a verifier (for example scope containment). */
  acceptanceEvidence?: CodingCompletionAcceptanceDecision[];
  /** Shared terminal decision; downstream settlement may project but never recompute it. */
  completionDecision?: CodingCompletionDecision;
  /** Complete settled projection emitted by the canonical VS Code product route. */
  codingConformance?: CodingConformanceProjection;
}
