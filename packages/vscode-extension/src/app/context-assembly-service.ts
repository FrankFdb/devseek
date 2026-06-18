export type ContextSourceKind =
  | 'project-instruction'
  | 'memory'
  | 'active-editor'
  | 'diagnostics'
  | 'attachment'
  | 'session'
  | 'system';

export interface ContextSource {
  id: string;
  kind: ContextSourceKind;
  label: string;
  content: string;
  path?: string;
  priority?: number;
}

export interface ContextSourceReport {
  id: string;
  kind: ContextSourceKind;
  label: string;
  path?: string;
  originalChars: number;
  includedChars: number;
  truncated: boolean;
  omitted: boolean;
}

export interface ContextBudgetReport {
  maxChars: number;
  usedChars: number;
  remainingChars: number;
  includedSources: string[];
  truncatedSources: string[];
  omittedSources: string[];
}

export interface PromptContext {
  prompt: string;
  sources: ContextSourceReport[];
  budget: ContextBudgetReport;
}

export interface AssemblePromptOptions {
  maxChars?: number;
  delimiter?: string;
}

const DEFAULT_MAX_CONTEXT_CHARS = 16_000;
const DEFAULT_DELIMITER = '\n\n---\n\n';

export class ContextAssemblyService {
  assemble(basePrompt: string, sources: ContextSource[], options: AssemblePromptOptions = {}): PromptContext {
    const maxChars = options.maxChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    const delimiter = options.delimiter ?? DEFAULT_DELIMITER;
    const ordered = [...sources].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

    const sections: string[] = [];
    const reports: ContextSourceReport[] = [];
    const includedSources: string[] = [];
    const truncatedSources: string[] = [];
    const omittedSources: string[] = [];
    let usedChars = basePrompt.length;

    for (const source of ordered) {
      const originalChars = source.content.length;
      const prefix = `[${source.label}${source.path ? ` — ${source.path}` : ''}]\n`;
      const suffix = `\n[/${source.label}]`;
      const overhead = prefix.length + suffix.length + delimiter.length;
      const remaining = maxChars - usedChars - overhead;

      if (remaining <= 0) {
        omittedSources.push(source.id);
        reports.push(toReport(source, originalChars, 0, false, true));
        continue;
      }

      const truncationMarker = '\n\n[上下文已截断]';
      const includedContent = source.content.length > remaining
        ? `${source.content.slice(0, Math.max(0, remaining - truncationMarker.length))}${truncationMarker}`
        : source.content;
      const truncated = includedContent.length !== source.content.length;
      const section = `${prefix}${includedContent}${suffix}`;
      sections.push(section);
      usedChars += section.length + delimiter.length;
      includedSources.push(source.id);
      if (truncated) truncatedSources.push(source.id);
      reports.push(toReport(source, originalChars, includedContent.length, truncated, false));
    }

    const prompt = sections.length > 0
      ? `${sections.join(delimiter)}${delimiter}${basePrompt}`
      : basePrompt;

    return {
      prompt,
      sources: reports,
      budget: {
        maxChars,
        usedChars: prompt.length,
        remainingChars: Math.max(0, maxChars - prompt.length),
        includedSources,
        truncatedSources,
        omittedSources,
      },
    };
  }
}

function toReport(
  source: ContextSource,
  originalChars: number,
  includedChars: number,
  truncated: boolean,
  omitted: boolean,
): ContextSourceReport {
  return {
    id: source.id,
    kind: source.kind,
    label: source.label,
    path: source.path,
    originalChars,
    includedChars,
    truncated,
    omitted,
  };
}
