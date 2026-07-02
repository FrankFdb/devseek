import {
  buildContextAnchors,
  filterByContextAnchors,
  hasContextAnchors,
  type ContextAnchorSet,
} from './context-relevance';
import type { ContextSource, ContextSourceKind } from './context-assembly-service';

export type ContextScopeOmitReason =
  | 'no-context-anchor'
  | 'not-relevant-to-current-scope';

export interface ContextScopeSourceReport {
  id: string;
  kind: ContextSourceKind;
  included: boolean;
  reason?: ContextScopeOmitReason;
}

export interface ContextScope {
  anchors: ContextAnchorSet;
  sources: ContextSource[];
  reports: ContextScopeSourceReport[];
}

export interface ResolveContextScopeInput {
  workspaceRoot?: string;
  prompt: string;
  relatedPaths?: readonly string[];
  sources: ContextSource[];
}

const ALWAYS_INCLUDED_KINDS = new Set<ContextSourceKind>([
  'project-instruction',
  'system',
  'attachment',
]);

const SCOPED_KINDS = new Set<ContextSourceKind>([
  'memory',
  'session',
  'active-editor',
]);

export class ContextScopeResolver {
  resolve(input: ResolveContextScopeInput): ContextScope {
    const anchors = buildContextAnchors({
      workspaceRoot: input.workspaceRoot,
      prompt: input.prompt,
      relatedPaths: input.relatedPaths ?? [],
    });
    const hasAnchors = hasContextAnchors(anchors);
    const reports: ContextScopeSourceReport[] = [];
    const sources: ContextSource[] = [];

    for (const source of input.sources) {
      if (ALWAYS_INCLUDED_KINDS.has(source.kind) || !SCOPED_KINDS.has(source.kind)) {
        reports.push(report(source, true));
        sources.push(source);
        continue;
      }

      if (!hasAnchors) {
        reports.push(report(source, false, 'no-context-anchor'));
        continue;
      }

      const matched = filterByContextAnchors([source], anchors, sourceText).length > 0;
      reports.push(report(source, matched, matched ? undefined : 'not-relevant-to-current-scope'));
      if (matched) sources.push(source);
    }

    return { anchors, sources, reports };
  }
}

function report(
  source: ContextSource,
  included: boolean,
  reason?: ContextScopeOmitReason,
): ContextScopeSourceReport {
  return {
    id: source.id,
    kind: source.kind,
    included,
    ...(reason ? { reason } : {}),
  };
}

function sourceText(source: ContextSource): string {
  return [
    source.path ?? '',
    source.label ?? '',
    source.content ?? '',
  ].join('\n');
}
