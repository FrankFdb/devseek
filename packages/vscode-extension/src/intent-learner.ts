/**
 * Intent Learner — Three-tier habit learning for intent routing.
 *
 * Architecture:
 *  L0  Session habits     (in-memory Map)          → promoted after ≥2 consistent hits/session
 *  L1  Workspace cache   (workspaceState)           → promoted after ≥3 distinct sessions
 *  L2  Global memory     (globalState)              → persists across all workspaces
 *
 * Lookup order: L2 → L1 → L0 → regex fallback (Plan A default-agent)
 *
 * Key design choices vs Copilot / Claude Code:
 *  - Copilot: no auto-learning, user maintains .github/copilot-instructions.md manually
 *  - Claude Code: AI writes to CLAUDE.md on demand, no frequency-based promotion
 *  - This module: automatic frequency-based promotion, conflict filtering (ambiguous
 *    patterns are NOT promoted), three-tier confidence escalation
 */

import * as vscode from 'vscode';

export type LearnedKind = 'code-change' | 'chat';

interface HabitRecord {
  /** Canonical token key extracted from the prompt */
  patternKey: string;
  kind: LearnedKind;
  /** Number of distinct sessions where this pattern was observed */
  sessionCount: number;
  /** Total hit count across all sessions */
  totalCount: number;
  /** Most recent session ID that updated this record */
  lastSessionId: string;
  /** Timestamp when this record was promoted to global state */
  promotedAt?: number;
}

/** Minimum consistent hits in one session before entering workspace cache (L1) */
const SESSION_PROMOTE_THRESHOLD = 2;
/** Minimum distinct sessions before entering global state (L2) */
const GLOBAL_PROMOTE_THRESHOLD = 3;
/** Max records in workspace cache */
const WORKSPACE_CACHE_LIMIT = 200;
/** Max records in global cache */
const GLOBAL_CACHE_LIMIT = 500;

const WORKSPACE_KEY = 'devseek.intentHabits';
const GLOBAL_KEY = 'devseek.globalIntentHabits';

// ── In-memory session habits (cleared on new session) ──────────────────────
const _sessionHabits = new Map<string, { kind: LearnedKind; count: number; conflicts: number }>();

// ── Token lists for lightweight fingerprinting ─────────────────────────────
// Intentionally kept separate from intent-router.ts to avoid circular imports.
const VERB_TOKENS = [
  '修复','修正','修改','优化','重构','实现','编写','生成','补全','完善',
  '新增','删除','替换','改写','改进','调整','规范','格式化','更新','添加',
  '增加','扩展','升级','改造','完成','重写','清理',
  'fix','update','create','write','add','modify','change',
  'enhance','extend','improve','edit','implement','refactor',
];

const NOUN_TOKENS = [
  '程序','项目','函数','模块','代码','脚本','测试','配置',
  '样式','动画','图形','游戏','页面','界面','特效','效果',
  'demo','component','class','function','file',
];

/**
 * Extract a canonical pattern key from a prompt.
 * Takes up to 2 verb tokens + 2 noun tokens, sorts alphabetically.
 * Returns empty string when no recognized tokens are found.
 */
function extractPatternKey(prompt: string): string {
  const text = prompt.toLowerCase();
  const verbs = VERB_TOKENS.filter(v => text.includes(v)).slice(0, 2);
  const nouns = NOUN_TOKENS.filter(n => text.includes(n)).slice(0, 2);
  const tokens = [...new Set([...verbs, ...nouns])].sort();
  return tokens.join('+');
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Clear session-level habits.
 * Call this when a new session starts.
 */
export function clearSessionHabits(): void {
  _sessionHabits.clear();
}

/**
 * Look up previously learned intent for a prompt.
 * Returns null if no reliable learned pattern is found (fall through to regex).
 *
 * Lookup order: L2 global → L1 workspace → L0 session
 */
export function lookupLearnedIntent(
  prompt: string,
  ctx: vscode.ExtensionContext,
): LearnedKind | null {
  const key = extractPatternKey(prompt);
  if (!key) return null;

  // L2: global habits — highest confidence, cross-workspace
  const globalHabits = ctx.globalState.get<HabitRecord[]>(GLOBAL_KEY, []) ?? [];
  const globalMatch = globalHabits.find(h => h.patternKey === key);
  if (globalMatch) return globalMatch.kind;

  // L1: workspace cache — requires at least SESSION_PROMOTE_THRESHOLD total hits
  const wsHabits = ctx.workspaceState.get<HabitRecord[]>(WORKSPACE_KEY, []) ?? [];
  const wsMatch = wsHabits.find(h => h.patternKey === key);
  if (wsMatch && wsMatch.totalCount >= SESSION_PROMOTE_THRESHOLD) return wsMatch.kind;

  // L0: current session — requires consistent hits without conflicts
  const sessMatch = _sessionHabits.get(key);
  if (sessMatch && sessMatch.count >= SESSION_PROMOTE_THRESHOLD && sessMatch.conflicts === 0) {
    return sessMatch.kind;
  }

  return null;
}

/**
 * Record the actual intent outcome after an AI response completes.
 * Call after every agent/chat turn with the determined kind.
 *
 * Handles conflict detection: if the same pattern resolves to different kinds,
 * the pattern is considered ambiguous and NOT promoted.
 */
export function recordIntentOutcome(
  prompt: string,
  kind: LearnedKind,
  sessionId: string,
  ctx: vscode.ExtensionContext,
): void {
  const key = extractPatternKey(prompt);
  if (!key) return;

  // Update L0 session habits
  const existing = _sessionHabits.get(key);
  if (existing) {
    if (existing.kind === kind) {
      existing.count++;
    } else {
      // Conflicting intent for same pattern — mark ambiguous, don't promote
      existing.conflicts++;
      return;
    }
  } else {
    _sessionHabits.set(key, { kind, count: 1, conflicts: 0 });
  }

  const sessData = _sessionHabits.get(key)!;
  if (sessData.kind === kind && sessData.count >= SESSION_PROMOTE_THRESHOLD && sessData.conflicts === 0) {
    _promoteToWorkspace(key, kind, sessionId, ctx);
  }
}

// ── Internal promotion helpers ─────────────────────────────────────────────

function _promoteToWorkspace(
  key: string,
  kind: LearnedKind,
  sessionId: string,
  ctx: vscode.ExtensionContext,
): void {
  const habits = (ctx.workspaceState.get<HabitRecord[]>(WORKSPACE_KEY, []) ?? []).slice();
  const idx = habits.findIndex(h => h.patternKey === key);

  if (idx >= 0) {
    const rec = { ...habits[idx] };
    // Only count a new session once per session ID
    if (rec.lastSessionId !== sessionId) {
      rec.sessionCount = (rec.sessionCount || 1) + 1;
      rec.lastSessionId = sessionId;
    }
    rec.totalCount = (rec.totalCount || 1) + 1;
    habits[idx] = rec;
  } else {
    habits.push({
      patternKey: key,
      kind,
      sessionCount: 1,
      totalCount: 1,
      lastSessionId: sessionId,
    });
  }

  void ctx.workspaceState.update(WORKSPACE_KEY, habits.slice(0, WORKSPACE_CACHE_LIMIT));

  // Check if ready for global promotion
  const rec = habits.find(h => h.patternKey === key)!;
  if (rec.sessionCount >= GLOBAL_PROMOTE_THRESHOLD && !rec.promotedAt) {
    _promoteToGlobal(rec, ctx);
    rec.promotedAt = Date.now();
    void ctx.workspaceState.update(WORKSPACE_KEY, habits);
  }
}

function _promoteToGlobal(record: HabitRecord, ctx: vscode.ExtensionContext): void {
  const globals = (ctx.globalState.get<HabitRecord[]>(GLOBAL_KEY, []) ?? []).slice();
  const idx = globals.findIndex(h => h.patternKey === record.patternKey);

  if (idx >= 0) {
    globals[idx] = {
      ...globals[idx],
      totalCount: globals[idx].totalCount + record.totalCount,
      promotedAt: Date.now(),
    };
  } else {
    globals.push({ ...record, promotedAt: Date.now() });
  }

  void ctx.globalState.update(GLOBAL_KEY, globals.slice(0, GLOBAL_CACHE_LIMIT));
}

/**
 * Inspect current learning state for diagnostics (used by debug commands).
 */
export function getLearnedHabitsSummary(ctx: vscode.ExtensionContext): string {
  const wsHabits = ctx.workspaceState.get<HabitRecord[]>(WORKSPACE_KEY, []) ?? [];
  const globalHabits = ctx.globalState.get<HabitRecord[]>(GLOBAL_KEY, []) ?? [];
  const sessionCount = _sessionHabits.size;

  const lines: string[] = [
    `[Intent Learner] Session patterns: ${sessionCount}`,
    `[Intent Learner] Workspace cache: ${wsHabits.length} patterns`,
    `[Intent Learner] Global memory: ${globalHabits.length} patterns`,
  ];

  if (globalHabits.length > 0) {
    lines.push('Global habits:');
    for (const h of globalHabits.slice(0, 10)) {
      lines.push(`  ${h.patternKey} → ${h.kind} (sessions: ${h.sessionCount}, total: ${h.totalCount})`);
    }
  }

  return lines.join('\n');
}
