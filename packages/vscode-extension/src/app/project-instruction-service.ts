import * as fs from 'fs';
import * as nodePath from 'path';
import {
  CanonicalInstructionPrecedenceService,
  type CodingContextProvenanceRecord,
  type CodingInstructionKind,
  type CodingInstructionPrecedenceDecision,
} from '@devseek-netai/shared';
import { shouldBlockProjectInstructionFileContent } from '../workspace/instruction-file-safety';

export type ProjectInstructionKind =
  | 'codex'
  | 'codex-override'
  | 'devseek'
  | 'copilot'
  | 'claude'
  | 'claude-local';

export interface ProjectInstructionSource {
  kind: ProjectInstructionKind;
  label: string;
  absPath: string;
  relPath: string;
  content: string;
  originalChars: number;
  includedChars: number;
  truncated: boolean;
  priority: number;
  depth: number;
  mtimeMs: number;
}

export interface ProjectInstructionDiagnostic {
  kind: 'missing-instructions' | 'scoped-conflict';
  severity: 'info' | 'warning';
  message: string;
  sources: string[];
  ruleKey?: string;
  winningRelPath?: string;
  recommendedInitTargetRelPath?: string;
}

export interface ProjectInstructionResult {
  sources: ProjectInstructionSource[];
  content: string;
  diagnostics: ProjectInstructionDiagnostic[];
  precedence: CodingInstructionPrecedenceDecision;
  provenance: readonly CodingContextProvenanceRecord[];
  budget: {
    maxCharsPerSource: number;
    maxTotalChars: number;
    usedChars: number;
    truncatedSources: string[];
    omittedSources: string[];
  };
}

export interface ProjectInstructionServiceOptions {
  workspaceRoots: string[];
  targetPaths?: string[];
  maxCharsPerSource?: number;
  maxTotalChars?: number;
}

interface InstructionDefinition {
  kind: ProjectInstructionKind;
  label: string;
  relPath: string;
  priority: number;
  scoped: boolean;
}

const DEFAULT_MAX_CHARS_PER_SOURCE = 4000;
const DEFAULT_MAX_TOTAL_CHARS = 12_000;
const INIT_RULES_REL_PATH = '.devseek/rules.md';

const INSTRUCTION_DEFINITIONS: InstructionDefinition[] = [
  { kind: 'codex-override', label: 'AGENTS.override.md', relPath: 'AGENTS.override.md', priority: 11, scoped: true },
  { kind: 'codex', label: 'AGENTS.md', relPath: 'AGENTS.md', priority: 10, scoped: true },
  { kind: 'devseek', label: '.devseek/rules.md', relPath: INIT_RULES_REL_PATH, priority: 20, scoped: false },
  { kind: 'copilot', label: '.github/copilot-instructions.md', relPath: '.github/copilot-instructions.md', priority: 30, scoped: false },
  { kind: 'claude', label: 'CLAUDE.md', relPath: 'CLAUDE.md', priority: 40, scoped: true },
  { kind: 'claude-local', label: 'CLAUDE.local.md', relPath: 'CLAUDE.local.md', priority: 41, scoped: true },
];

const instructionPrecedenceService = new CanonicalInstructionPrecedenceService();

export class ProjectInstructionService {
  discover(options: ProjectInstructionServiceOptions): ProjectInstructionResult {
    const roots = unique(options.workspaceRoots.map(root => nodePath.resolve(root)));
    const maxCharsPerSource = options.maxCharsPerSource ?? DEFAULT_MAX_CHARS_PER_SOURCE;
    const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;

    const rawSources: ProjectInstructionSource[] = [];
    for (const root of roots) {
      rawSources.push(...this.discoverRoot(root, options.targetPaths ?? [], maxCharsPerSource));
    }

    const discoveredDecision = resolveInstructionPrecedence(rawSources);
    const sourceById = new Map(rawSources.map(source => [instructionSourceId(source), source]));
    const sources = discoveredDecision.instructions.map(instruction => {
      const source = sourceById.get(instruction.sourceId);
      if (!source) throw new Error(`project-instruction:missing-source:${instruction.sourceId}`);
      return source;
    });

    const included: string[] = [];
    const truncatedSources: string[] = [];
    const omittedSources: string[] = [];
    const omittedSourceIds = new Set<string>();
    let usedChars = 0;

    for (const source of sources) {
      if (source.truncated) truncatedSources.push(source.relPath);
      const block = formatInstructionSource(source);
      if (usedChars + block.length > maxTotalChars) {
        omittedSources.push(source.relPath);
        omittedSourceIds.add(instructionSourceId(source));
        continue;
      }
      included.push(block);
      usedChars += block.length;
    }

    const includedSources = sources.filter(source => !omittedSourceIds.has(instructionSourceId(source)));
    const precedence = resolveInstructionPrecedence(includedSources);
    return {
      sources: includedSources,
      content: included.join('\n\n'),
      diagnostics: buildInstructionDiagnostics(includedSources, precedence),
      precedence,
      provenance: precedence.provenance,
      budget: {
        maxCharsPerSource,
        maxTotalChars,
        usedChars,
        truncatedSources,
        omittedSources,
      },
    };
  }

  private discoverRoot(root: string, targetPaths: string[], maxCharsPerSource: number): ProjectInstructionSource[] {
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

    const dirs = collectInstructionDirs(root, targetPaths);
    const seen = new Set<string>();
    const sources: ProjectInstructionSource[] = [];

    for (const dir of dirs) {
      const depth = relativeDepth(root, dir);
      for (const definition of selectInstructionDefinitions(dir)) {
        if (!definition.scoped && dir !== root) continue;
        const absPath = nodePath.join(dir, definition.relPath);
        if (seen.has(absPath) || !fs.existsSync(absPath)) continue;
        seen.add(absPath);
        const source = readInstructionSource(root, absPath, definition, depth, maxCharsPerSource);
        if (source) sources.push(source);
      }
    }

    return sources;
  }
}

export function wrapProjectInstructionsAsContext(instructions: string): string {
  return `[项目指令 — AGENTS.md / .devseek/rules.md / Copilot / CLAUDE.md]\n${instructions}\n[/项目指令]`;
}

function readInstructionSource(
  root: string,
  absPath: string,
  definition: InstructionDefinition,
  depth: number,
  maxCharsPerSource: number,
): ProjectInstructionSource | null {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) return null;
    const original = fs.readFileSync(absPath, 'utf8').trim();
    if (!original) return null;
    if (shouldBlockProjectInstructionFileContent(absPath, original)) return null;
    const content = original.length > maxCharsPerSource
      ? `${original.slice(0, maxCharsPerSource)}\n\n[指令文件已截断，超出 ${maxCharsPerSource} 字符限制]`
      : original;
    return {
      kind: definition.kind,
      label: definition.label,
      absPath,
      relPath: normalizeRelPath(nodePath.relative(root, absPath)),
      content,
      originalChars: original.length,
      includedChars: content.length,
      truncated: original.length > maxCharsPerSource,
      priority: definition.priority,
      depth,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function formatInstructionSource(source: ProjectInstructionSource): string {
  return `[来源: ${source.relPath}]\n${source.content}`;
}

function buildInstructionDiagnostics(
  sources: ProjectInstructionSource[],
  precedence: CodingInstructionPrecedenceDecision,
): ProjectInstructionDiagnostic[] {
  const diagnostics: ProjectInstructionDiagnostic[] = [];
  if (sources.length === 0) {
    diagnostics.push({
      kind: 'missing-instructions',
      severity: 'info',
      message: 'No AGENTS.md, CLAUDE.md, DevSeek, or Copilot project instructions were found; /init can provide a draft only.',
      sources: [],
      recommendedInitTargetRelPath: INIT_RULES_REL_PATH,
    });
  }
  const sourceById = new Map(sources.map(source => [instructionSourceId(source), source]));
  diagnostics.push(...precedence.conflicts.map(conflict => ({
    kind: 'scoped-conflict' as const,
    severity: 'warning' as const,
    message: `Conflicting scoped instruction for ${conflict.ruleKey}; strongest applicable rule wins for this target.`,
    sources: conflict.sourceIds.map(sourceId => sourceById.get(sourceId)?.relPath ?? sourceId),
    ruleKey: conflict.ruleKey,
    winningRelPath: sourceById.get(conflict.winningSourceId)?.relPath ?? conflict.winningSourceId,
  })));
  return diagnostics;
}

function resolveInstructionPrecedence(
  sources: readonly ProjectInstructionSource[],
): CodingInstructionPrecedenceDecision {
  return instructionPrecedenceService.resolve({
    instructions: sources.map(source => ({
      sourceId: instructionSourceId(source),
      authority: 'workspace',
      kind: sharedInstructionKind(source.kind),
      locator: source.relPath,
      content: source.content,
      scopeDepth: source.depth,
      sourcePriority: source.priority,
    })),
  });
}

function selectInstructionDefinitions(dir: string): InstructionDefinition[] {
  const override = INSTRUCTION_DEFINITIONS.find(definition => definition.kind === 'codex-override');
  const standard = INSTRUCTION_DEFINITIONS.find(definition => definition.kind === 'codex');
  const selectedCodex = override && isInstructionFile(nodePath.join(dir, override.relPath)) ? override : standard;
  return INSTRUCTION_DEFINITIONS.filter(definition => (
    definition.kind !== 'codex' && definition.kind !== 'codex-override'
  )).concat(selectedCodex ? [selectedCodex] : []);
}

function isInstructionFile(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isFile();
  } catch {
    return false;
  }
}

function instructionSourceId(source: ProjectInstructionSource): string {
  return `project-instruction:${normalizeRelPath(source.absPath)}`;
}

function sharedInstructionKind(kind: ProjectInstructionKind): CodingInstructionKind {
  if (kind === 'codex') return 'agents';
  if (kind === 'codex-override') return 'agents-override';
  if (kind === 'claude-local') return 'claude-local';
  return kind;
}

function collectInstructionDirs(root: string, targetPaths: string[]): string[] {
  const dirs = [root];
  for (const targetPath of targetPaths) {
    const absTarget = nodePath.resolve(targetPath);
    if (!isInside(root, absTarget)) continue;
    let dir = fs.existsSync(absTarget) && fs.statSync(absTarget).isFile()
      ? nodePath.dirname(absTarget)
      : absTarget;
    const chain: string[] = [];
    while (isInside(root, dir)) {
      chain.push(dir);
      if (dir === root) break;
      dir = nodePath.dirname(dir);
    }
    dirs.push(...chain.reverse());
  }
  return unique(dirs);
}

function isInside(root: string, target: string): boolean {
  const rel = nodePath.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !nodePath.isAbsolute(rel));
}

function relativeDepth(root: string, dir: string): number {
  const rel = nodePath.relative(root, dir);
  if (!rel) return 0;
  return rel.split(nodePath.sep).filter(Boolean).length;
}

function normalizeRelPath(relPath: string): string {
  return relPath.split(nodePath.sep).join('/');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
