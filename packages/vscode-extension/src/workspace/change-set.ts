import type { ChangeAction } from '../change-plan';

export type WorkspaceChangeKind = 'create' | 'overwrite' | 'patch';
export type WorkspaceChangeScope = 'file' | 'symbol';
export type WorkspaceSymbolKind = 'class' | 'function' | 'interface' | 'type' | 'enum' | 'const';
export type WorkspaceSymbolChangeType = 'added' | 'modified' | 'removed';
export type WorkspacePlanScopeStatus = 'unscoped' | 'in-plan' | 'out-of-plan';

export interface WorkspaceSymbolChange {
  path: string;
  name: string;
  kind: WorkspaceSymbolKind;
  changeType: WorkspaceSymbolChangeType;
  evidenceIds: string[];
}

export interface WorkspacePlannedSymbol {
  path: string;
  name: string;
  kind?: WorkspaceSymbolKind;
}

export interface WorkspaceChangePlanTrace {
  revisionId: string;
  actionType: string;
  confidence?: 'high' | 'medium';
  reason: string;
  evidenceIds: string[];
  scopeStatus: WorkspacePlanScopeStatus;
  revisionRequired: boolean;
}

export interface WorkspaceChangeInput {
  path: string;
  existed?: boolean;
  oldContent?: string;
  newContent?: string;
  actionType?: string;
  confidence?: 'high' | 'medium';
  reason?: string;
  evidenceIds?: string[];
  symbols?: WorkspaceSymbolChange[];
}

export interface WorkspacePlannedChangeInput {
  action: ChangeAction;
  existed?: boolean;
  oldContent?: string;
  newContent?: string;
  evidenceIds?: string[];
}

export interface ChangeSetPlanScope {
  revisionId?: string;
  paths?: string[];
  symbols?: WorkspacePlannedSymbol[];
  evidenceIds?: string[];
}

export interface WorkspaceChangeRecord {
  path: string;
  kind: WorkspaceChangeKind;
  existed: boolean;
  oldContent: string;
  newContent: string;
  addedLines: number;
  removedLines: number;
  scope: WorkspaceChangeScope;
  symbols: WorkspaceSymbolChange[];
  plan: WorkspaceChangePlanTrace;
}

export interface ChangeSetSummary {
  total: number;
  creates: number;
  overwrites: number;
  patches: number;
  changedPaths: string[];
}

export interface ChangeSetSymbolSummary {
  total: number;
  added: number;
  modified: number;
  removed: number;
  changedSymbols: WorkspaceSymbolChange[];
  revisionRequiredPaths: string[];
}

export class ChangeSet {
  constructor(readonly changes: WorkspaceChangeRecord[]) {}

  get changedPaths(): string[] {
    return this.changes.map(change => change.path);
  }

  requiresPlanRevision(): boolean {
    return this.changes.some(change => change.plan.revisionRequired);
  }

  summary(): ChangeSetSummary {
    return this.changes.reduce<ChangeSetSummary>((summary, change) => {
      summary.total += 1;
      summary.changedPaths.push(change.path);
      if (change.kind === 'create') summary.creates += 1;
      else if (change.kind === 'patch') summary.patches += 1;
      else summary.overwrites += 1;
      return summary;
    }, { total: 0, creates: 0, overwrites: 0, patches: 0, changedPaths: [] });
  }

  symbolSummary(): ChangeSetSymbolSummary {
    const changedSymbols = this.changes.flatMap(change => change.symbols);
    const revisionRequiredPaths = uniqueStrings(
      this.changes
        .filter(change => change.plan.revisionRequired)
        .map(change => change.path),
    );
    return changedSymbols.reduce<ChangeSetSymbolSummary>((summary, symbol) => {
      summary.total += 1;
      if (symbol.changeType === 'added') summary.added += 1;
      else if (symbol.changeType === 'removed') summary.removed += 1;
      else summary.modified += 1;
      summary.changedSymbols.push(symbol);
      return summary;
    }, { total: 0, added: 0, modified: 0, removed: 0, changedSymbols: [], revisionRequiredPaths });
  }
}

export function createChangeSet(inputs: WorkspaceChangeInput[], scope?: ChangeSetPlanScope): ChangeSet {
  const normalizedScope = normalizePlanScope(scope);
  return new ChangeSet(inputs.map(input => {
    const oldContent = input.oldContent ?? '';
    const newContent = input.newContent ?? '';
    const delta = estimateLineDelta(oldContent, newContent);
    const evidenceIds = normalizeEvidenceIds(input.evidenceIds ?? normalizedScope.evidenceIds);
    const symbols = input.symbols
      ? normalizeWorkspaceSymbolChanges(input.path, input.symbols, evidenceIds)
      : inferSymbolChanges(input.path, oldContent, newContent, evidenceIds);
    const scopeStatus = determinePlanScopeStatus(input.path, symbols, normalizedScope);
    return {
      path: input.path,
      kind: inferChangeKind(input),
      existed: !!input.existed,
      oldContent,
      newContent,
      addedLines: delta.added,
      removedLines: delta.removed,
      scope: symbols.length > 0 ? 'symbol' : 'file',
      symbols,
      plan: {
        revisionId: normalizedScope.revisionId,
        actionType: input.actionType ?? '',
        confidence: input.confidence,
        reason: input.reason ?? '',
        evidenceIds,
        scopeStatus,
        revisionRequired: scopeStatus === 'out-of-plan',
      },
    };
  }));
}

export function createChangeSetFromActions(
  plannedChanges: WorkspacePlannedChangeInput[],
  scope?: ChangeSetPlanScope,
): ChangeSet {
  return createChangeSet(plannedChanges.map(change => ({
    path: change.action.path,
    existed: change.existed,
    oldContent: change.oldContent,
    newContent: resolveActionNewContent(change),
    actionType: change.action.type,
    confidence: change.action.confidence,
    reason: change.action.reason,
    evidenceIds: change.evidenceIds,
  })), scope);
}

function inferChangeKind(input: WorkspaceChangeInput): WorkspaceChangeKind {
  if (input.actionType === 'patch-file') return 'patch';
  if (input.actionType === 'create-file') return 'create';
  if (input.actionType === 'overwrite-file') return 'overwrite';
  return input.existed ? 'overwrite' : 'create';
}

interface SymbolSpan {
  name: string;
  kind: WorkspaceSymbolKind;
  source: string;
}

interface NormalizedPlanScope {
  revisionId: string;
  paths: Set<string>;
  symbols: WorkspacePlannedSymbol[];
  evidenceIds: string[];
  active: boolean;
}

function resolveActionNewContent(change: WorkspacePlannedChangeInput): string {
  if (change.newContent !== undefined) return change.newContent;
  if (change.action.type === 'patch-file') return change.oldContent ?? '';
  return change.action.content;
}

function inferSymbolChanges(
  path: string,
  oldContent: string,
  newContent: string,
  evidenceIds: string[],
): WorkspaceSymbolChange[] {
  const oldSymbols = collectSymbolSpans(oldContent);
  const newSymbols = collectSymbolSpans(newContent);
  const keys = uniqueStrings([...oldSymbols.keys(), ...newSymbols.keys()]).sort();
  const changes: WorkspaceSymbolChange[] = [];

  for (const key of keys) {
    const oldSymbol = oldSymbols.get(key);
    const newSymbol = newSymbols.get(key);
    const symbol = newSymbol ?? oldSymbol;
    if (!symbol) continue;
    const changeType = !oldSymbol
      ? 'added'
      : !newSymbol
        ? 'removed'
        : oldSymbol.source === newSymbol.source
          ? undefined
          : 'modified';
    if (!changeType) continue;
    changes.push({
      path,
      name: symbol.name,
      kind: symbol.kind,
      changeType,
      evidenceIds,
    });
  }

  return changes;
}

function collectSymbolSpans(content: string): Map<string, SymbolSpan> {
  const declarations: Array<{ index: number; name: string; kind: WorkspaceSymbolKind }> = [];
  const declarationRe = /^\s*(?:export\s+)?(?:(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b|class\s+([A-Za-z_$][\w$]*)\b|interface\s+([A-Za-z_$][\w$]*)\b|type\s+([A-Za-z_$][\w$]*)\b|enum\s+([A-Za-z_$][\w$]*)\b|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\b)/gm;
  let match: RegExpExecArray | null;
  while ((match = declarationRe.exec(content)) !== null) {
    const name = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6];
    const kind = match[1]
      ? 'function'
      : match[2]
        ? 'class'
        : match[3]
          ? 'interface'
          : match[4]
            ? 'type'
            : match[5]
              ? 'enum'
              : 'const';
    declarations.push({ index: match.index, name, kind });
  }

  const spans = new Map<string, SymbolSpan>();
  for (let i = 0; i < declarations.length; i += 1) {
    const current = declarations[i];
    const next = declarations[i + 1];
    spans.set(symbolKey(current), {
      name: current.name,
      kind: current.kind,
      source: content.slice(current.index, next ? next.index : content.length).trim(),
    });
  }
  return spans;
}

function normalizeWorkspaceSymbolChanges(
  path: string,
  symbols: WorkspaceSymbolChange[],
  fallbackEvidenceIds: string[],
): WorkspaceSymbolChange[] {
  return symbols
    .map(symbol => ({
      path: normalizeChangePath(symbol.path || path),
      name: symbol.name.trim(),
      kind: symbol.kind,
      changeType: symbol.changeType,
      evidenceIds: normalizeEvidenceIds(symbol.evidenceIds.length > 0 ? symbol.evidenceIds : fallbackEvidenceIds),
    }))
    .filter(symbol => !!symbol.path && !!symbol.name);
}

function normalizePlanScope(scope?: ChangeSetPlanScope): NormalizedPlanScope {
  const paths = new Set((scope?.paths ?? []).map(normalizeChangePath).filter(Boolean));
  const symbols = (scope?.symbols ?? [])
    .map(symbol => ({
      path: normalizeChangePath(symbol.path),
      name: symbol.name.trim(),
      ...(symbol.kind ? { kind: symbol.kind } : {}),
    }))
    .filter(symbol => !!symbol.path && !!symbol.name);
  return {
    revisionId: (scope?.revisionId ?? '').trim(),
    paths,
    symbols,
    evidenceIds: normalizeEvidenceIds(scope?.evidenceIds ?? []),
    active: paths.size > 0 || symbols.length > 0,
  };
}

function determinePlanScopeStatus(
  path: string,
  symbols: WorkspaceSymbolChange[],
  scope: NormalizedPlanScope,
): WorkspacePlanScopeStatus {
  if (!scope.active) return 'unscoped';

  const normalizedPath = normalizeChangePath(path);
  if (scope.paths.size > 0 && !scope.paths.has(normalizedPath)) return 'out-of-plan';
  if (symbols.length === 0 || scope.symbols.length === 0) return 'in-plan';
  return symbols.every(symbol => matchesPlannedSymbol(symbol, scope.symbols)) ? 'in-plan' : 'out-of-plan';
}

function matchesPlannedSymbol(symbol: WorkspaceSymbolChange, plannedSymbols: WorkspacePlannedSymbol[]): boolean {
  return plannedSymbols.some(planned => (
    normalizeChangePath(planned.path) === normalizeChangePath(symbol.path)
    && planned.name === symbol.name
    && (!planned.kind || planned.kind === symbol.kind)
  ));
}

function symbolKey(symbol: { name: string; kind: WorkspaceSymbolKind }): string {
  return `${symbol.kind}:${symbol.name}`;
}

function normalizeEvidenceIds(values: string[]): string[] {
  return uniqueStrings(values.map(value => value.trim()).filter(Boolean));
}

function normalizeChangePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function estimateLineDelta(oldContent: string, newContent: string): { added: number; removed: number } {
  const oldLines = countLines(oldContent);
  const newLines = countLines(newContent);
  return {
    added: Math.max(0, newLines - oldLines),
    removed: Math.max(0, oldLines - newLines),
  };
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r?\n/).length;
}
