import type { AgentTask } from '../agent-task-decomposer';
import type { AppliedChangeRecord, ApplyWorkflowStatus } from '../workspace-applier';
import type { McpToolRef } from '../mcp/client';
import type { MemoryWriteProposal } from '../memory/types';
import type { AgentStatusEvent } from './events';
import type { TodoItem } from './evidence-recovery';

export type AgentStatusMessage = AgentStatusEvent;

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
  onTaskCheckpoint?: (
    completedUpToIndex: number | null,
    remainingTasks: AgentTask[],
    reason?: 'progress' | 'paused' | 'completed',
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
}
