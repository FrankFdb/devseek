import * as nodePath from 'path';
import type {
  ProviderVisibleReadExposure,
  ToolFileAccessEvent,
  ToolSuppressionEvidence,
} from './tool-loop-result';
import {
  buildRepeatedContextToolFeedback,
  isContextGatheringToolName,
  makeContextToolSignature,
  type ContextToolRequest,
} from './context-convergence-feedback';

interface InvestigationTool extends ContextToolRequest {
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ContextInvestigationScreenResult {
  readonly blockedToolIndexes: ReadonlySet<number>;
  readonly suppressedTools: readonly ToolSuppressionEvidence[];
  readonly warnings: readonly string[];
  readonly acceptedRecoveryContextRefresh: boolean;
  readonly admittedNovelContextToolCount: number;
  readonly admittedNovelReadToolCount: number;
  readonly suppressedContextToolCount: number;
}

export interface VisibleReadCoverageUpdate {
  readonly novelExposureCount: number;
}

export interface ProjectedReadContinuationResolution {
  readonly inputOverrides: ReadonlyMap<number, Readonly<Record<string, unknown>>>;
  readonly continuationToolIndexes: ReadonlySet<number>;
  readonly warnings: readonly string[];
}

interface ContextInvestigationScreenInput {
  readonly progressEpoch: number;
  readonly hasWorkspaceMutation: boolean;
  readonly consumeContextRefresh: (path: string | undefined) => boolean;
  readonly alreadyBlockedToolIndexes?: ReadonlySet<number>;
  readonly providerRecoveryContextRefreshToolIndexes?: ReadonlySet<number>;
}

interface ContextInvestigationRecordInput {
  readonly tools: readonly InvestigationTool[];
  readonly progressEpoch: number;
}

interface ReadCoverage {
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly pathRevision: number;
}

interface ProjectedReadGap {
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
  readonly pathRevision: number;
}

interface AcceptedReadExposure extends ProviderVisibleReadExposure {
  readonly readSequence: number;
}

const MAX_NOVEL_CONTEXT_TOOLS_PER_ROUND = 6;
const MAX_NOVEL_READ_TOOLS_PER_ROUND = 3;

/** Owns duplicate investigation suppression for the evidence visible to one Provider session. */
export class ContextInvestigationLedger {
  private readonly signatures = new Map<string, { count: number; progressEpoch: number }>();
  private readonly readCoverage = new Map<string, ReadCoverage[]>();
  private readonly projectedReadGaps = new Map<string, ProjectedReadGap[]>();
  private readonly pathRevisions = new Map<string, number>();

  constructor(private readonly workspaceRoot: string) {}

  reset(): void {
    this.signatures.clear();
    this.readCoverage.clear();
    this.projectedReadGaps.clear();
    this.pathRevisions.clear();
  }

  completeReadPaths(): string[] {
    const complete: string[] = [];
    for (const [path, entries] of this.readCoverage) {
      const pathRevision = this.pathRevision(path);
      const current = entries
        .filter(entry => entry.pathRevision === pathRevision)
        .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
      const totalLines = current[0]?.totalLines;
      if (!totalLines || current.some(entry => entry.totalLines !== totalLines)) continue;
      let coveredThrough = 0;
      for (const entry of current) {
        if (entry.startLine > coveredThrough + 1) break;
        coveredThrough = Math.max(coveredThrough, entry.endLine);
      }
      if (coveredThrough >= totalLines) complete.push(path);
    }
    return complete;
  }

  visibleReadPaths(): string[] {
    const visible: string[] = [];
    for (const [path, entries] of this.readCoverage) {
      if (entries.some(entry => entry.pathRevision === this.pathRevision(path))) visible.push(path);
    }
    return visible;
  }

  recordVisibleReadExposures(
    exposures: readonly ProviderVisibleReadExposure[],
    fileAccessEvents: readonly ToolFileAccessEvent[],
  ): VisibleReadCoverageUpdate {
    const events = fileAccessEvents.map(event => ({ ...event, path: this.resolvePath(event.path) }));
    for (const event of events) {
      if (event.kind === 'write') this.advancePathRevision(event.path);
    }
    const acceptedExposures: AcceptedReadExposure[] = [];
    let novelExposureCount = 0;
    for (const exposure of exposures) {
      const path = this.resolvePath(exposure.path);
      const readEvent = events.find(event => (
        event.kind === 'read'
        && event.path === path
        && event.sourceSegmentIndex === exposure.sourceSegmentIndex
      ));
      if (!readEvent) continue;
      const stale = events.some(event => (
        event.kind === 'write'
        && event.path === path
        && event.sequence > readEvent.sequence
      ));
      if (stale) continue;
      const acceptedExposure = { ...exposure, path, readSequence: readEvent.sequence };
      acceptedExposures.push(acceptedExposure);
      if (this.recordReadExposure(acceptedExposure)) novelExposureCount++;
    }
    this.subtractVisibleExposuresFromProjectedGaps(acceptedExposures);
    this.recordProjectedReadGaps(acceptedExposures);
    return Object.freeze({ novelExposureCount });
  }

  reconcileProjectedReadContinuations(
    tools: readonly InvestigationTool[],
  ): ProjectedReadContinuationResolution {
    const inputOverrides = new Map<number, Readonly<Record<string, unknown>>>();
    const continuationToolIndexes = new Set<number>();
    const warnings: string[] = [];
    const assignedGapKeys = new Set<string>();
    const directlyRequestedGaps = new Map<number, ProjectedReadGap>();
    tools.forEach((tool, toolIndex) => {
      const gap = this.projectedReadGapFor(tool, assignedGapKeys, false);
      if (!gap) return;
      directlyRequestedGaps.set(toolIndex, gap);
      assignedGapKeys.add(this.projectedReadGapKey(tool, gap));
    });
    tools.forEach((tool, toolIndex) => {
      const directGap = directlyRequestedGaps.get(toolIndex);
      const gap = directGap ?? this.projectedReadGapFor(tool, assignedGapKeys, true);
      if (!gap) return;
      if (!directGap) assignedGapKeys.add(this.projectedReadGapKey(tool, gap));
      continuationToolIndexes.add(toolIndex);
      const startLine = optionalPositiveInteger(tool.input, 'startLine', 'start_line', 'lineStart', 'fromLine');
      const endLine = optionalPositiveInteger(tool.input, 'endLine', 'end_line', 'lineEnd', 'toLine');
      if (startLine === gap.startLine && endLine === gap.endLine) return;
      inputOverrides.set(toolIndex, Object.freeze({
        ...tool.input,
        startLine: gap.startLine,
        endLine: gap.endLine,
      }));
      warnings.push([
        `【系统反馈】已将同文件读取收敛到尚未交付的投影缺口：${String(tool.input.path)}`,
        `实际读取范围：startLine=${gap.startLine}, endLine=${gap.endLine}。`,
        '该只读纠正没有扩大目标路径；后续必须依据补齐的源码事实恢复原动作。',
      ].join('\n'));
    });
    return Object.freeze({ inputOverrides, continuationToolIndexes, warnings });
  }

  screen(
    tools: readonly InvestigationTool[],
    input: ContextInvestigationScreenInput,
  ): ContextInvestigationScreenResult {
    const blockedToolIndexes = new Set<number>();
    const suppressedTools: ToolSuppressionEvidence[] = [];
    const warnings: string[] = [];
    let acceptedRecoveryContextRefresh = false;
    let admittedNovelContextToolCount = 0;
    let admittedNovelReadToolCount = 0;
    let suppressedContextToolCount = 0;
    const deferredContextTools: InvestigationTool[] = [];
    if (input.hasWorkspaceMutation) {
      return {
        blockedToolIndexes,
        suppressedTools,
        warnings,
        acceptedRecoveryContextRefresh,
        admittedNovelContextToolCount,
        admittedNovelReadToolCount,
        suppressedContextToolCount,
      };
    }

    tools.forEach((tool, toolIndex) => {
      if (input.alreadyBlockedToolIndexes?.has(toolIndex)) return;
      if (!isContextGatheringToolName(tool.name)) return;
      const signature = makeContextToolSignature(tool);
      const seen = this.signatures.get(signature);
      const exactRepeat = seen?.progressEpoch === input.progressEpoch;
      const coveredRead = this.readRequestIsCovered(tool);
      const refreshPath = tool.name === 'read_file' && typeof tool.input.path === 'string'
        ? tool.input.path
        : undefined;
      if (input.consumeContextRefresh(refreshPath)) {
        acceptedRecoveryContextRefresh = true;
        this.signatures.delete(signature);
        return;
      }
      if (input.providerRecoveryContextRefreshToolIndexes?.has(toolIndex)) return;
      if (!exactRepeat && !coveredRead) {
        const exceedsReadBudget = tool.name === 'read_file'
          && admittedNovelReadToolCount >= MAX_NOVEL_READ_TOOLS_PER_ROUND;
        const exceedsContextBudget = admittedNovelContextToolCount >= MAX_NOVEL_CONTEXT_TOOLS_PER_ROUND;
        if (exceedsReadBudget || exceedsContextBudget) {
          suppressedContextToolCount++;
          blockedToolIndexes.add(toolIndex);
          suppressedTools.push({ tool: tool.name, reason: 'context-batch-budget' });
          deferredContextTools.push(tool);
          return;
        }
        admittedNovelContextToolCount++;
        if (tool.name === 'read_file') admittedNovelReadToolCount++;
        return;
      }

      suppressedContextToolCount++;
      const nextCount = exactRepeat ? (seen?.count ?? 1) + 1 : 2;
      if (exactRepeat) {
        this.signatures.set(signature, { count: nextCount, progressEpoch: input.progressEpoch });
      }
      blockedToolIndexes.add(toolIndex);
      suppressedTools.push({
        tool: tool.name,
        reason: coveredRead ? 'covered-context-without-progress' : 'repeated-context-without-progress',
      });
      warnings.push(coveredRead
        ? buildCoveredContextReadFeedback(tool)
        : buildRepeatedContextToolFeedback(tool, nextCount));
    });
    if (deferredContextTools.length > 0) {
      warnings.push(buildDeferredContextBatchFeedback(deferredContextTools));
    }
    return {
      blockedToolIndexes,
      suppressedTools,
      warnings,
      acceptedRecoveryContextRefresh,
      admittedNovelContextToolCount,
      admittedNovelReadToolCount,
      suppressedContextToolCount,
    };
  }

  record(input: ContextInvestigationRecordInput): string[] {
    const warnings: string[] = [];
    for (const tool of input.tools) {
      if (!isContextGatheringToolName(tool.name)) continue;
      const signature = makeContextToolSignature(tool);
      const previous = this.signatures.get(signature);
      const count = previous?.progressEpoch === input.progressEpoch ? previous.count + 1 : 1;
      this.signatures.set(signature, { count, progressEpoch: input.progressEpoch });
      if (count >= 2) warnings.push(buildRepeatedContextToolFeedback(tool, count));
    }
    return warnings;
  }

  private readRequestIsCovered(tool: InvestigationTool): boolean {
    if (tool.name !== 'read_file' || typeof tool.input.path !== 'string') return false;
    const startLine = optionalPositiveInteger(tool.input, 'startLine', 'start_line', 'lineStart', 'fromLine') ?? 1;
    const endLine = optionalPositiveInteger(tool.input, 'endLine', 'end_line', 'lineEnd', 'toLine');
    if (endLine === undefined || endLine < startLine) return false;
    const path = this.resolvePath(tool.input.path);
    return this.readRangeIsCovered(path, startLine, endLine);
  }

  private projectedReadGapFor(
    tool: InvestigationTool,
    excludedGapKeys: ReadonlySet<string>,
    allowCoveredFallback: boolean,
  ): ProjectedReadGap | undefined {
    if (tool.name !== 'read_file' || typeof tool.input.path !== 'string') return undefined;
    const path = this.resolvePath(tool.input.path);
    const gaps = (this.projectedReadGaps.get(path) ?? [])
      .filter(gap => gap.pathRevision === this.pathRevision(path))
      .filter(gap => !excludedGapKeys.has(this.projectedReadGapKey(tool, gap)))
      .sort((left, right) => left.startLine - right.startLine);
    if (gaps.length === 0) return undefined;
    const startLine = optionalPositiveInteger(tool.input, 'startLine', 'start_line', 'lineStart', 'fromLine');
    const endLine = optionalPositiveInteger(tool.input, 'endLine', 'end_line', 'lineEnd', 'toLine');
    if (startLine === undefined || endLine === undefined) return gaps[0];
    const intersecting = gaps.find(gap => startLine <= gap.endLine && endLine >= gap.startLine);
    if (intersecting) return intersecting;
    return allowCoveredFallback && this.readRequestIsCovered(tool) ? gaps[0] : undefined;
  }

  private projectedReadGapKey(tool: InvestigationTool, gap: ProjectedReadGap): string {
    const path = typeof tool.input.path === 'string' ? this.resolvePath(tool.input.path) : '';
    return `${path}\u0000${gap.pathRevision}\u0000${gap.startLine}\u0000${gap.endLine}`;
  }

  private subtractVisibleExposuresFromProjectedGaps(exposures: readonly AcceptedReadExposure[]): void {
    const paths = new Set(exposures.map(exposure => exposure.path));
    for (const path of paths) {
      const revision = this.pathRevision(path);
      const visible = exposures.filter(exposure => exposure.path === path);
      const retained: ProjectedReadGap[] = [];
      for (const gap of this.projectedReadGaps.get(path) ?? []) {
        if (gap.pathRevision !== revision) continue;
        let fragments = [gap];
        for (const exposure of visible) {
          fragments = fragments.flatMap(fragment => subtractRange(fragment, exposure.startLine, exposure.endLine));
        }
        retained.push(...fragments);
      }
      this.projectedReadGaps.set(path, retained);
    }
  }

  private recordProjectedReadGaps(exposures: readonly AcceptedReadExposure[]): void {
    const groups = new Map<string, AcceptedReadExposure[]>();
    for (const exposure of exposures) {
      const key = `${exposure.path}\u0000${exposure.sourceSegmentIndex}\u0000${exposure.readSequence}`;
      const group = groups.get(key) ?? [];
      group.push(exposure);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const sorted = [...group].sort((left, right) => left.startLine - right.startLine);
      const first = sorted[0];
      if (!first) continue;
      const declaredRange = sorted.every(exposure => (
        Number.isSafeInteger(exposure.sourceRangeStartLine)
        && Number.isSafeInteger(exposure.sourceRangeEndLine)
        && exposure.sourceRangeStartLine! >= 1
        && exposure.sourceRangeStartLine! <= exposure.startLine
        && exposure.sourceRangeEndLine! >= exposure.endLine
        && exposure.sourceRangeEndLine! <= exposure.totalLines
        && exposure.totalLines === first.totalLines
        && exposure.sourceRangeStartLine === first.sourceRangeStartLine
        && exposure.sourceRangeEndLine === first.sourceRangeEndLine
      ));
      const gaps = declaredRange
        ? sorted.reduce<ProjectedReadGap[]>(
          (remaining, exposure) => remaining.flatMap(gap => subtractRange(
            gap,
            exposure.startLine,
            exposure.endLine,
          )),
          [{
            startLine: first.sourceRangeStartLine!,
            endLine: first.sourceRangeEndLine!,
            totalLines: first.totalLines,
            pathRevision: this.pathRevision(first.path),
          }],
        )
        : sorted.slice(1).flatMap((right, index) => {
          const left = sorted[index];
          if (left.totalLines !== right.totalLines || left.endLine + 1 >= right.startLine) return [];
          return [{
            startLine: left.endLine + 1,
            endLine: right.startLine - 1,
            totalLines: left.totalLines,
            pathRevision: this.pathRevision(left.path),
          }];
        });
      const current = this.projectedReadGaps.get(first.path) ?? [];
      for (const gap of gaps) {
        if (!current.some(existing => existing.startLine === gap.startLine
          && existing.endLine === gap.endLine
          && existing.pathRevision === gap.pathRevision)) current.push(gap);
      }
      this.projectedReadGaps.set(first.path, current);
    }
  }

  private recordReadExposure(exposure: ProviderVisibleReadExposure): boolean {
    if (!exposure.path
      || !Number.isSafeInteger(exposure.startLine)
      || !Number.isSafeInteger(exposure.endLine)
      || !Number.isSafeInteger(exposure.totalLines)
      || exposure.startLine < 1
      || exposure.endLine < exposure.startLine
      || exposure.totalLines < exposure.endLine) return false;
    const path = this.resolvePath(exposure.path);
    const novel = !this.readRangeIsCovered(path, exposure.startLine, exposure.endLine);
    const entries = this.readCoverage.get(path) ?? [];
    entries.push({
      startLine: exposure.startLine,
      endLine: exposure.endLine,
      totalLines: exposure.totalLines,
      pathRevision: this.pathRevision(path),
    });
    this.readCoverage.set(path, entries);
    return novel;
  }

  private readRangeIsCovered(path: string, startLine: number, endLine: number): boolean {
    const entries = (this.readCoverage.get(path) ?? [])
      .filter(entry => entry.pathRevision === this.pathRevision(path) && entry.endLine >= startLine)
      .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
    let coveredThrough = startLine - 1;
    for (const entry of entries) {
      if (entry.startLine > coveredThrough + 1) return false;
      coveredThrough = Math.max(coveredThrough, entry.endLine);
      if (coveredThrough >= endLine) return true;
    }
    return false;
  }

  private pathRevision(path: string): number {
    return this.pathRevisions.get(path) ?? 0;
  }

  private advancePathRevision(path: string): void {
    this.pathRevisions.set(path, this.pathRevision(path) + 1);
    this.projectedReadGaps.delete(path);
  }

  private resolvePath(value: string): string {
    const path = nodePath.isAbsolute(value)
      ? nodePath.resolve(value)
      : nodePath.resolve(this.workspaceRoot, value);
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }
}

function buildDeferredContextBatchFeedback(tools: readonly InvestigationTool[]): string {
  const labels = tools.slice(0, 6).map(tool => {
    const path = typeof tool.input.path === 'string' ? tool.input.path : '';
    return path ? `${tool.name}:${path}` : tool.name;
  });
  const omitted = tools.length - labels.length;
  return [
    `【系统反馈】本轮延后了 ${tools.length} 个上下文工具，以保证已执行读取获得足够的可见源码。`,
    `延后项：${labels.join('；')}${omitted > 0 ? `；另有 ${omitted} 项` : ''}。`,
    '这些动作没有执行，也不代表对应内容缺失。先依据本轮已返回证据实施；若仍缺少事实，下一轮只重发最相关的未执行读取或查询。',
  ].join('\n');
}

function subtractRange(
  gap: ProjectedReadGap,
  visibleStart: number,
  visibleEnd: number,
): ProjectedReadGap[] {
  if (visibleEnd < gap.startLine || visibleStart > gap.endLine) return [gap];
  const fragments: ProjectedReadGap[] = [];
  if (visibleStart > gap.startLine) {
    fragments.push({ ...gap, endLine: Math.min(gap.endLine, visibleStart - 1) });
  }
  if (visibleEnd < gap.endLine) {
    fragments.push({ ...gap, startLine: Math.max(gap.startLine, visibleEnd + 1) });
  }
  return fragments;
}

function optionalPositiveInteger(
  input: Readonly<Record<string, unknown>>,
  ...keys: string[]
): number | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  }
  return undefined;
}

function buildCoveredContextReadFeedback(tool: InvestigationTool): string {
  const path = typeof tool.input.path === 'string' ? tool.input.path : '当前文件';
  return [
    `【系统反馈】已跳过被既有证据覆盖的重复读取：${path}`,
    '请求的行范围已由本轮较早的成功读取完整覆盖，期间没有写盘使证据失效。',
    '请直接依据模型已经收到的内容实施修改或形成结论；只有写入失败、文件变化或缺少未覆盖行时才重新读取。',
  ].join('\n');
}
