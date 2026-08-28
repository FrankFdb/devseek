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
  type DeliveryContextAdmission,
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
  readonly consumedPreciseContextRead: boolean;
  readonly exhaustedPreciseContextAllowance: boolean;
  readonly deliveryBlockedToolCount: number;
}

interface ContextInvestigationScreenInput {
  readonly progressEpoch: number;
  readonly hasWorkspaceMutation: boolean;
  readonly consumeContextRefresh: (path: string | undefined) => boolean;
  readonly alreadyBlockedToolIndexes?: ReadonlySet<number>;
  readonly providerRecoveryContextRefreshToolIndexes?: ReadonlySet<number>;
  readonly deliveryContextAdmission?: DeliveryContextAdmission;
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

/** Owns duplicate investigation suppression for the evidence visible to one Provider session. */
export class ContextInvestigationLedger {
  private readonly signatures = new Map<string, { count: number; progressEpoch: number }>();
  private readonly readCoverage = new Map<string, ReadCoverage[]>();
  private readonly pathRevisions = new Map<string, number>();

  constructor(private readonly workspaceRoot: string) {}

  reset(): void {
    this.signatures.clear();
    this.readCoverage.clear();
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
  ): void {
    const events = fileAccessEvents.map(event => ({ ...event, path: this.resolvePath(event.path) }));
    for (const event of events) {
      if (event.kind === 'write') this.advancePathRevision(event.path);
    }
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
      if (!stale) this.recordReadExposure(exposure);
    }
  }

  screen(
    tools: readonly InvestigationTool[],
    input: ContextInvestigationScreenInput,
  ): ContextInvestigationScreenResult {
    const blockedToolIndexes = new Set<number>();
    const suppressedTools: ToolSuppressionEvidence[] = [];
    const warnings: string[] = [];
    let acceptedRecoveryContextRefresh = false;
    let consumedPreciseContextRead = false;
    let exhaustedPreciseContextAllowance = false;
    let deliveryBlockedToolCount = 0;
    if (input.hasWorkspaceMutation) {
      return {
        blockedToolIndexes,
        suppressedTools,
        warnings,
        acceptedRecoveryContextRefresh,
        consumedPreciseContextRead,
        exhaustedPreciseContextAllowance,
        deliveryBlockedToolCount,
      };
    }

    const deliveryAdmission = input.deliveryContextAdmission ?? 'open';
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

      // Prompt projection can intentionally expose the head and tail of a large
      // read while instructing the Provider to request the omitted middle. That
      // exact continuation is host-created context debt, not renewed discovery.
      const completesProjectedRead = deliveryAdmission !== 'open'
        && this.readRequestCompletesVisibleGap(tool);
      if (completesProjectedRead) {
        consumedPreciseContextRead = true;
        return;
      }
      const admitsPreciseRead = deliveryAdmission === 'one-precise-read'
        && !consumedPreciseContextRead
        && !exactRepeat
        && !coveredRead
        && tool.name === 'read_file'
        && typeof tool.input.path === 'string';
      if (admitsPreciseRead) {
        consumedPreciseContextRead = true;
        return;
      }
      if (deliveryAdmission !== 'open') {
        if (deliveryAdmission === 'one-precise-read' && !consumedPreciseContextRead) {
          exhaustedPreciseContextAllowance = true;
        }
        deliveryBlockedToolCount++;
        blockedToolIndexes.add(toolIndex);
        suppressedTools.push({ tool: tool.name, reason: 'delivery-context-budget-exhausted' });
        warnings.push(buildDeliveryContextBlockedFeedback(tool));
        return;
      }
      if (!exactRepeat && !coveredRead) return;

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
    return {
      blockedToolIndexes,
      suppressedTools,
      warnings,
      acceptedRecoveryContextRefresh,
      consumedPreciseContextRead,
      exhaustedPreciseContextAllowance,
      deliveryBlockedToolCount,
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
    return (this.readCoverage.get(path) ?? []).some(coverage => (
      coverage.pathRevision === this.pathRevision(path)
      && coverage.startLine <= startLine
      && coverage.endLine >= endLine
    ));
  }

  private readRequestCompletesVisibleGap(tool: InvestigationTool): boolean {
    if (tool.name !== 'read_file' || typeof tool.input.path !== 'string') return false;
    const startLine = optionalPositiveInteger(tool.input, 'startLine', 'start_line', 'lineStart', 'fromLine');
    const endLine = optionalPositiveInteger(tool.input, 'endLine', 'end_line', 'lineEnd', 'toLine');
    if (startLine === undefined || endLine === undefined || endLine < startLine) return false;

    const path = this.resolvePath(tool.input.path);
    const current = (this.readCoverage.get(path) ?? [])
      .filter(entry => entry.pathRevision === this.pathRevision(path))
      .sort((left, right) => left.startLine - right.startLine || left.endLine - right.endLine);
    if (current.length < 2) return false;
    const totalLines = current[0].totalLines;
    if (current.some(entry => entry.totalLines !== totalLines)) return false;

    let coveredThrough = current[0].endLine;
    for (const next of current.slice(1)) {
      if (next.startLine > coveredThrough + 1
        && startLine === coveredThrough + 1
        && endLine === next.startLine - 1) return true;
      coveredThrough = Math.max(coveredThrough, next.endLine);
    }
    return false;
  }

  private recordReadExposure(exposure: ProviderVisibleReadExposure): void {
    if (!exposure.path
      || !Number.isSafeInteger(exposure.startLine)
      || !Number.isSafeInteger(exposure.endLine)
      || !Number.isSafeInteger(exposure.totalLines)
      || exposure.startLine < 1
      || exposure.endLine < exposure.startLine
      || exposure.totalLines < exposure.endLine) return;
    const path = this.resolvePath(exposure.path);
    const entries = this.readCoverage.get(path) ?? [];
    entries.push({
      startLine: exposure.startLine,
      endLine: exposure.endLine,
      totalLines: exposure.totalLines,
      pathRevision: this.pathRevision(path),
    });
    this.readCoverage.set(path, entries);
  }

  private pathRevision(path: string): number {
    return this.pathRevisions.get(path) ?? 0;
  }

  private advancePathRevision(path: string): void {
    this.pathRevisions.set(path, this.pathRevision(path) + 1);
  }

  private resolvePath(value: string): string {
    const path = nodePath.isAbsolute(value)
      ? nodePath.resolve(value)
      : nodePath.resolve(this.workspaceRoot, value);
    return process.platform === 'win32' ? path.toLowerCase() : path;
  }
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

function buildDeliveryContextBlockedFeedback(tool: InvestigationTool): string {
  const path = typeof tool.input.path === 'string' ? tool.input.path : tool.name;
  return [
    `【系统反馈】已跳过交付收敛后的额外上下文请求：${path}`,
    '模型已经使用最终精确读取机会，但仍未形成写入或可交付结论。',
    '下一轮必须依据已有证据提交最小修改或明确结论；不要继续横向 read/list/grep/search。',
  ].join('\n');
}
