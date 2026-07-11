import { EvidenceStore, type EvidenceRef } from './evidence-grounding';

/** Converts the read_file display envelope back into immutable host evidence. */
export class ToolReadEvidenceRecorder {
  private readonly evidenceStore: EvidenceStore;

  constructor(workspaceRoot: string, runId?: string) {
    this.evidenceStore = new EvidenceStore(workspaceRoot, runId || 'tool-loop');
  }

  recordArtifactReadback(path: string, content: string): EvidenceRef {
    return this.evidenceStore.recordFileRead({ path, content, kind: 'artifact-readback' });
  }

  record(displayText: string, fallbackPath: string): EvidenceRef {
    const normalized = String(displayText || '').replace(/\r\n?/g, '\n');
    const envelope = normalized.match(/^\[file_context\]\n([\s\S]*?)\n\[\/file_context\]\n?/);
    if (!envelope) {
      return this.evidenceStore.recordFileRead({ path: fallbackPath, content: displayText });
    }
    const metadata = envelope[1];
    const resolvedPath = metadata.match(/(?:^|\n)resolvedPath=([^\n]+)/)?.[1]?.trim() || fallbackPath;
    const returnedRange = metadata.match(/(?:^|\n)returnedLines=(\d+)-(\d+)\//);
    return this.evidenceStore.recordFileRead({
      path: resolvedPath,
      content: normalized.slice(envelope[0].length),
      lineStart: returnedRange ? Number(returnedRange[1]) : undefined,
      lineEnd: returnedRange ? Number(returnedRange[2]) : undefined,
    });
  }
}

interface ToolReadEvidenceResult {
  evidenceRefs?: EvidenceRef[];
}

/** Retains every read captured by the nested tool rounds of one task. */
export function collectToolReadEvidence<T extends ToolReadEvidenceResult>(
  target: EvidenceRef[],
  result: T,
): T {
  if (result.evidenceRefs?.length) target.push(...result.evidenceRefs);
  return result;
}

/** Attaches collected tool reads without dropping evidence owned by another executor. */
export function withToolReadEvidence<T extends ToolReadEvidenceResult>(
  result: T,
  collected: readonly EvidenceRef[],
): T {
  if (collected.length === 0) return result;
  const merged = [...(result.evidenceRefs ?? []), ...collected].filter((ref, index, refs) =>
    ref.evidenceId
      ? refs.findIndex(candidate => candidate.evidenceId === ref.evidenceId) === index
      : refs.indexOf(ref) === index);
  return { ...result, evidenceRefs: merged };
}
