/**
 * Agent Learner — Universal Learning Bus for all agent dimensions.
 *
 * Unlike intent-learner.ts (which focuses on intent routing), this module
 * learns from ALL observable agent events:
 *
 *   Dimension A: Tool usage patterns (which tools work for which request types)
 *   Dimension B: Successful shell commands (compile/test/run — project-specific)
 *   Dimension C: Error → Fix patterns (fingerprint recurring errors, cache fixes)
 *   Dimension D: File co-change pairs (files often modified together)
 *
 * Architecture: Event Bus pattern
 *   emitLearningEvent(event) → learner handlers → workspaceState / globalState
 *   getXxxHint(context) → inject learned knowledge into LLM prompts
 *
 * Three-tier storage (same model as intent-learner.ts):
 *   L0   Session RAM  — current session, cleared on new session
 *   L1   workspaceState — project-scoped, survives restart
 *   L2   globalState  — plugin-wide, cross-project (only for stable patterns)
 *
 * Comparison with other agents:
 *   Copilot:   No automatic learning. user hand-writes copilot-instructions.md
 *   Claude Code: AI writes CLAUDE.md on demand via memory_write tool (reactive)
 *   Cursor:    .cursorrules + auto-suggests rule additions from pain-points (reactive)
 *   Windsurf:  Cascade Memories — auto-captures project facts (closest to our model)
 *   Devin:     Organizational Memory + Runbooks — team-level knowledge (richest)
 *   THIS MODULE: frequency-based auto-promotion, covers all 4 dimensions above
 */

import * as vscode from 'vscode';

// ── Event Types ────────────────────────────────────────────────────────────

export interface ToolCalledEvent {
  type: 'tool_called';
  tool: string;
  /** Broad request category: 'compile' | 'analyze' | 'edit' | 'test' | 'search' */
  requestCategory: string;
  success: boolean;
  sessionId: string;
}

export interface CommandSucceededEvent {
  type: 'command_succeeded';
  /** Full shell command that succeeded (exit 0) */
  command: string;
  /** Brief description of when this was used (from surrounding prompt context) */
  context: string;
  sessionId: string;
}

export interface FilesCochangedEvent {
  type: 'files_cochanged';
  /** Workspace-relative paths of all files modified in one agent turn */
  paths: string[];
  sessionId: string;
}

export interface ErrorFixedEvent {
  type: 'error_fixed';
  /** Key lines of the error output, normalised for fingerprinting */
  errorFingerprint: string;
  /** Short description of what fix was applied */
  fixSummary: string;
  sessionId: string;
}

export type LearningEvent =
  | ToolCalledEvent
  | CommandSucceededEvent
  | FilesCochangedEvent
  | ErrorFixedEvent;

// ── Storage keys ───────────────────────────────────────────────────────────

const WS_KEYS = {
  toolStats:   'devseek.learn.toolStats',   // L1 workspace
  commandLib:  'devseek.learn.commandLib',  // L1 workspace
  filePairs:   'devseek.learn.filePairs',   // L1 workspace
  errorFixes:  'devseek.learn.errorFixes',  // L1 workspace
} as const;

const GLOBAL_KEYS = {
  commandLib: 'devseek.learn.global.commandLib', // L2 global — stable build commands
} as const;

// ── Stored data shapes ─────────────────────────────────────────────────────

interface ToolStatRecord {
  tool: string;
  category: string;
  successCount: number;
  failCount: number;
}

export interface CommandRecord {
  command: string;
  context: string;
  successCount: number;
  lastUsed: number;
  /** Number of distinct sessions where this succeeded */
  sessionCount: number;
  lastSessionId: string;
  /** Set when promoted to globalState */
  promotedAt?: number;
}

interface FilePairRecord {
  fileA: string;
  fileB: string;
  coChangeCount: number;
}

interface ErrorFixRecord {
  fingerprint: string;
  fixes: Array<{ summary: string; count: number }>;
}

// Session-level L0 caches (cleared on new session)
const _sessionCmds = new Map<string, number>(); // command → hit count in this session

// ── Module state ───────────────────────────────────────────────────────────

let _ctx: vscode.ExtensionContext | undefined;

export function initAgentLearner(ctx: vscode.ExtensionContext): void {
  _ctx = ctx;
}

export function clearLearnerSession(): void {
  _sessionCmds.clear();
}

// ── Universal Event Bus ────────────────────────────────────────────────────

export function emitLearningEvent(event: LearningEvent): void {
  if (!_ctx) return;
  switch (event.type) {
    case 'tool_called':        _recordToolCall(event, _ctx); break;
    case 'command_succeeded':  _recordCommand(event, _ctx); break;
    case 'files_cochanged':    _recordFilePair(event, _ctx); break;
    case 'error_fixed':        _recordErrorFix(event, _ctx); break;
  }
}

// ── Query API — inject learned knowledge into LLM prompts ─────────────────

/**
 * Returns a formatted block of known-working commands for injection into
 * agent prompts (compile/test/run tasks). Returns empty string if nothing known.
 *
 * Lookup order: L2 global → L1 workspace
 */
export function getCommandHints(contextKeyword?: string): string {
  if (!_ctx) return '';

  // Merge L2 global + L1 workspace, dedup by command
  const global = _ctx.globalState.get<CommandRecord[]>(GLOBAL_KEYS.commandLib, []) ?? [];
  const ws = _ctx.workspaceState.get<CommandRecord[]>(WS_KEYS.commandLib, []) ?? [];
  const merged = new Map<string, CommandRecord>();
  for (const r of [...global, ...ws]) {
    const existing = merged.get(r.command);
    merged.set(r.command, existing
      ? { ...r, successCount: existing.successCount + r.successCount }
      : r,
    );
  }

  let records = [...merged.values()];
  if (contextKeyword) {
    const kw = contextKeyword.toLowerCase();
    const filtered = records.filter(r =>
      r.command.toLowerCase().includes(kw) ||
      r.context.toLowerCase().includes(kw),
    );
    if (filtered.length > 0) records = filtered;
  }

  if (records.length === 0) return '';

  const top = records
    .sort((a, b) => b.successCount - a.successCount)
    .slice(0, 5)
    .map(r => `  ${r.command}  # ${r.context}`);

  return `[已知有效命令 — 来自学习记忆]\n${top.join('\n')}`;
}

/**
 * Returns a hint for a known error fingerprint.
 * Returns empty string if not in the learning cache.
 */
export function getErrorFixHint(errorText: string): string {
  if (!_ctx) return '';
  const fp = fingerprintError(errorText);
  const records = _ctx.workspaceState.get<ErrorFixRecord[]>(WS_KEYS.errorFixes, []) ?? [];
  const match = records.find(r => r.fingerprint === fp);
  if (!match || match.fixes.length === 0) return '';
  const topFix = [...match.fixes].sort((a, b) => b.count - a.count)[0];
  return `[已知此类错误的处理方式] ${topFix.summary}`;
}

/**
 * Returns workspace-relative paths of files frequently co-changed with filePath.
 */
export function getCoChangedFiles(filePath: string): string[] {
  if (!_ctx) return [];
  const pairs = _ctx.workspaceState.get<FilePairRecord[]>(WS_KEYS.filePairs, []) ?? [];
  const norm = filePath.replace(/\\/g, '/');
  const base = norm.split('/').pop()?.toLowerCase() ?? '';
  return pairs
    .filter(p =>
      p.fileA === norm || p.fileB === norm ||
      p.fileA.split('/').pop()?.toLowerCase() === base ||
      p.fileB.split('/').pop()?.toLowerCase() === base,
    )
    .sort((a, b) => b.coChangeCount - a.coChangeCount)
    .slice(0, 3)
    .map(p => p.fileA === norm ? p.fileB : p.fileA);
}

/**
 * Diagnostics — returns a human-readable summary of all learned knowledge.
 */
export function getLearnerSummary(): string {
  if (!_ctx) return '[AgentLearner] not initialized';

  const wsCmd = _ctx.workspaceState.get<CommandRecord[]>(WS_KEYS.commandLib, []) ?? [];
  const glCmd = _ctx.globalState.get<CommandRecord[]>(GLOBAL_KEYS.commandLib, []) ?? [];
  const filePairs = _ctx.workspaceState.get<FilePairRecord[]>(WS_KEYS.filePairs, []) ?? [];
  const errFixes = _ctx.workspaceState.get<ErrorFixRecord[]>(WS_KEYS.errorFixes, []) ?? [];
  const toolStats = _ctx.workspaceState.get<ToolStatRecord[]>(WS_KEYS.toolStats, []) ?? [];

  const lines = [
    `[AgentLearner] Commands (workspace): ${wsCmd.length}, (global): ${glCmd.length}`,
    `[AgentLearner] File pairs: ${filePairs.length}`,
    `[AgentLearner] Error fixes: ${errFixes.length}`,
    `[AgentLearner] Tool stats: ${toolStats.length}`,
  ];
  if (wsCmd.length > 0) {
    lines.push('Top workspace commands:');
    wsCmd.slice(0, 5).forEach(c => lines.push(`  ${c.command} (×${c.successCount}) [${c.context}]`));
  }
  return lines.join('\n');
}

// ── Private: event handlers ─────────────────────────────────────────────────

function _recordToolCall(event: ToolCalledEvent, ctx: vscode.ExtensionContext): void {
  const stats = (ctx.workspaceState.get<ToolStatRecord[]>(WS_KEYS.toolStats, []) ?? []).slice();
  const idx = stats.findIndex(s => s.tool === event.tool && s.category === event.requestCategory);
  if (idx >= 0) {
    if (event.success) stats[idx].successCount++;
    else stats[idx].failCount++;
  } else {
    stats.push({
      tool: event.tool,
      category: event.requestCategory,
      successCount: event.success ? 1 : 0,
      failCount: event.success ? 0 : 1,
    });
  }
  void ctx.workspaceState.update(WS_KEYS.toolStats, stats.slice(0, 500));
}

function _recordCommand(event: CommandSucceededEvent, ctx: vscode.ExtensionContext): void {
  const cmd = event.command.trim();
  if (!cmd || cmd.length < 4) return;

  // Update L0 session counter
  _sessionCmds.set(cmd, (_sessionCmds.get(cmd) ?? 0) + 1);

  // Update L1 workspace
  const ws = (ctx.workspaceState.get<CommandRecord[]>(WS_KEYS.commandLib, []) ?? []).slice();
  const idx = ws.findIndex(c => c.command === cmd);
  if (idx >= 0) {
    const existing = { ...ws[idx] };
    existing.successCount++;
    existing.lastUsed = Date.now();
    existing.context = event.context || existing.context;
    if (existing.lastSessionId !== event.sessionId) {
      existing.sessionCount = (existing.sessionCount ?? 1) + 1;
      existing.lastSessionId = event.sessionId;
    }
    ws[idx] = existing;
  } else {
    ws.push({
      command: cmd,
      context: event.context,
      successCount: 1,
      lastUsed: Date.now(),
      sessionCount: 1,
      lastSessionId: event.sessionId,
    });
  }
  void ctx.workspaceState.update(WS_KEYS.commandLib, ws.slice(0, 200));

  // Promote to L2 if seen across ≥3 different sessions
  const rec = ws.find(c => c.command === cmd);
  if (rec && (rec.sessionCount ?? 0) >= 3 && !rec.promotedAt) {
    _promoteCommandToGlobal(rec, ctx);
    rec.promotedAt = Date.now();
    void ctx.workspaceState.update(WS_KEYS.commandLib, ws);
  }
}

function _promoteCommandToGlobal(record: CommandRecord, ctx: vscode.ExtensionContext): void {
  const globals = (ctx.globalState.get<CommandRecord[]>(GLOBAL_KEYS.commandLib, []) ?? []).slice();
  const idx = globals.findIndex(c => c.command === record.command);
  if (idx >= 0) {
    globals[idx] = {
      ...globals[idx],
      successCount: globals[idx].successCount + record.successCount,
      lastUsed: Date.now(),
      promotedAt: Date.now(),
    };
  } else {
    globals.push({ ...record, promotedAt: Date.now() });
  }
  void ctx.globalState.update(GLOBAL_KEYS.commandLib, globals.slice(0, 300));
}

function _recordFilePair(event: FilesCochangedEvent, ctx: vscode.ExtensionContext): void {
  const paths = event.paths.map(p => p.replace(/\\/g, '/'));
  if (paths.length < 2) return;

  const pairs = (ctx.workspaceState.get<FilePairRecord[]>(WS_KEYS.filePairs, []) ?? []).slice();
  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const [a, b] = [paths[i], paths[j]].sort();
      const idx = pairs.findIndex(p => p.fileA === a && p.fileB === b);
      if (idx >= 0) {
        pairs[idx] = { ...pairs[idx], coChangeCount: pairs[idx].coChangeCount + 1 };
      } else {
        pairs.push({ fileA: a, fileB: b, coChangeCount: 1 });
      }
    }
  }
  void ctx.workspaceState.update(WS_KEYS.filePairs, pairs.slice(0, 1000));
}

function _recordErrorFix(event: ErrorFixedEvent, ctx: vscode.ExtensionContext): void {
  if (!event.errorFingerprint || !event.fixSummary) return;
  const records = (ctx.workspaceState.get<ErrorFixRecord[]>(WS_KEYS.errorFixes, []) ?? []).slice();
  const idx = records.findIndex(r => r.fingerprint === event.errorFingerprint);
  if (idx >= 0) {
    const fixIdx = records[idx].fixes.findIndex(f => f.summary === event.fixSummary);
    if (fixIdx >= 0) {
      records[idx].fixes[fixIdx] = { ...records[idx].fixes[fixIdx], count: records[idx].fixes[fixIdx].count + 1 };
    } else {
      records[idx] = { ...records[idx], fixes: [...records[idx].fixes, { summary: event.fixSummary, count: 1 }] };
    }
  } else {
    records.push({ fingerprint: event.errorFingerprint, fixes: [{ summary: event.fixSummary, count: 1 }] });
  }
  void ctx.workspaceState.update(WS_KEYS.errorFixes, records.slice(0, 300));
}

// ── Error fingerprinting ───────────────────────────────────────────────────

export function fingerprintError(errorText: string): string {
  const lines = errorText
    .split('\n')
    .map(l => l.trim())
    .filter(l => /error:|fatal:|undefined reference|cannot find|no such file|linker|ld returned/i.test(l))
    .slice(0, 3);
  return lines.join('|').slice(0, 120).toLowerCase();
}
