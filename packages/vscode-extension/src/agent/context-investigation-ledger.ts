import * as nodePath from 'path';
import type { EvidenceRef } from './evidence-grounding';
import type { ToolSuppressionEvidence } from './tool-loop-result';
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
}

interface ContextInvestigationScreenInput {
  readonly progressEpoch: number;
  readonly hasWorkspaceMutation: boolean;
  readonly consumeContextRefresh: (path: string | undefined) => boolean;
}

interface ContextInvestigationRecordInput {
  readonly tools: readonly InvestigationTool[];
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly progressEpoch: number;
}

interface ReadCoverage {
  readonly startLine: number;
  readonly endLine: number;
  readonly progressEpoch: number;
}

/** Owns duplicate investigation suppression for the evidence visible to one Provider session. */
export class ContextInvestigationLedger {
  private readonly signatures = new Map<string, { count: number; progressEpoch: number }>();
  private readonly readCoverage = new Map<string, ReadCoverage[]>();

  constructor(private readonly workspaceRoot: string) {}

  reset(): void {
    this.signatures.clear();
    this.readCoverage.clear();
  }

  screen(
    tools: readonly InvestigationTool[],
    input: ContextInvestigationScreenInput,
  ): ContextInvestigationScreenResult {
    const blockedToolIndexes = new Set<number>();
    const suppressedTools: ToolSuppressionEvidence[] = [];
    const warnings: string[] = [];
    if (input.hasWorkspaceMutation) {
      return { blockedToolIndexes, suppressedTools, warnings };
    }

    tools.forEach((tool, toolIndex) => {
      if (!isContextGatheringToolName(tool.name)) return;
      const signature = makeContextToolSignature(tool);
      const seen = this.signatures.get(signature);
      const exactRepeat = seen?.progressEpoch === input.progressEpoch;
      const coveredRead = this.readRequestIsCovered(tool, input.progressEpoch);
      if (!exactRepeat && !coveredRead) return;

      const refreshPath = tool.name === 'read_file' && typeof tool.input.path === 'string'
        ? tool.input.path
        : undefined;
      if (input.consumeContextRefresh(refreshPath)) {
        this.signatures.delete(signature);
        return;
      }

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
    return { blockedToolIndexes, suppressedTools, warnings };
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
    for (const evidence of input.evidenceRefs) this.recordReadEvidence(evidence, input.progressEpoch);
    return warnings;
  }

  private readRequestIsCovered(tool: InvestigationTool, progressEpoch: number): boolean {
    if (tool.name !== 'read_file' || typeof tool.input.path !== 'string') return false;
    const startLine = optionalPositiveInteger(tool.input, 'startLine', 'start_line', 'lineStart', 'fromLine') ?? 1;
    const endLine = optionalPositiveInteger(tool.input, 'endLine', 'end_line', 'lineEnd', 'toLine');
    if (endLine === undefined || endLine < startLine) return false;
    const path = this.resolvePath(tool.input.path);
    return (this.readCoverage.get(path) ?? []).some(coverage => (
      coverage.progressEpoch === progressEpoch
      && coverage.startLine <= startLine
      && coverage.endLine >= endLine
    ));
  }

  private recordReadEvidence(evidence: EvidenceRef, progressEpoch: number): void {
    if (evidence.kind !== 'read'
      || !evidence.sourcePath
      || evidence.lineStart === undefined
      || evidence.lineEnd === undefined) return;
    const path = this.resolvePath(evidence.sourcePath);
    const entries = this.readCoverage.get(path) ?? [];
    entries.push({
      startLine: evidence.lineStart,
      endLine: evidence.lineEnd,
      progressEpoch,
    });
    this.readCoverage.set(path, entries);
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
    '请直接依据已有内容实施修改或形成结论；只有写入失败、文件变化或缺少未覆盖行时才重新读取。',
  ].join('\n');
}
