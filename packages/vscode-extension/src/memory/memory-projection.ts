import * as fs from 'fs';
import * as nodePath from 'path';
import type { MemoryStage1Job } from './pipeline-types';
import type { RepositoryMemoryLocation } from './repository-memory-location';
import type { MemoryRecord } from './types';

const SUMMARY_MAX_CHARS = 8_000;

export class MemoryProjectionWriter {
  constructor(private readonly location: RepositoryMemoryLocation) {}

  write(input: {
    records: readonly MemoryRecord[];
    stage1Jobs?: readonly MemoryStage1Job[];
  }): void {
    fs.mkdirSync(this.location.memoryRoot, { recursive: true, mode: 0o700 });
    fs.mkdirSync(this.location.rolloutsRoot, { recursive: true, mode: 0o700 });
    for (const job of input.stage1Jobs ?? []) this.writeRollout(job);
    atomicWrite(this.location.summaryPath, renderSummary(input.records));
    atomicWrite(this.location.indexPath, renderIndex(input.records));
  }

  private writeRollout(job: MemoryStage1Job): void {
    if (!job.output) return;
    const filePath = nodePath.join(this.location.rolloutsRoot, `${safeFilename(job.rolloutId)}.md`);
    const content = renderRollout(job);
    if (fs.existsSync(filePath)) {
      rejectSymbolicLink(filePath);
      if (fs.readFileSync(filePath, 'utf8') !== content) {
        throw new Error(`memory-projection:immutable-rollout-conflict:${job.rolloutId}`);
      }
      return;
    }
    fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
}

export class MemoryReadService {
  constructor(private readonly location: RepositoryMemoryLocation) {}

  readSummary(): string {
    return readBoundedFile(this.location.summaryPath, SUMMARY_MAX_CHARS) ?? '';
  }

  search(query: string, maxResults = 8): Array<{ path: string; line: number; text: string }> {
    const terms = semanticSearchTerms(query);
    if (terms.length === 0) return [];
    const files = [this.location.indexPath, ...listRolloutFiles(this.location.rolloutsRoot)];
    const results: Array<{ path: string; line: number; text: string; score: number }> = [];
    for (const filePath of files) {
      const content = readBoundedFile(filePath, 200_000);
      if (!content) continue;
      const relativePath = nodePath.relative(this.location.memoryRoot, filePath);
      for (const [index, line] of content.split(/\r?\n/u).entries()) {
        const normalized = normalizeSearchText(line);
        const score = terms.reduce((total, term) => total + termScore(normalized, term), 0);
        if (score > 0) results.push({ path: relativePath, line: index + 1, text: line, score });
      }
    }
    return results
      .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
      .slice(0, Math.max(1, Math.min(20, maxResults)))
      .map(({ score: _score, ...result }) => result);
  }

  read(relativePath: string, startLine = 1, maxLines = 120): string {
    const resolved = resolveScopedReadPath(this.location, relativePath);
    const content = readBoundedFile(resolved, 250_000);
    if (content === undefined) throw new Error('memory-read:not-found');
    const lines = content.split(/\r?\n/u);
    const start = Math.max(1, Math.floor(startLine));
    const count = Math.max(1, Math.min(200, Math.floor(maxLines)));
    if (start > lines.length) throw new Error('memory-read:line-offset-exceeds-file');
    return lines
      .slice(start - 1, start - 1 + count)
      .map((line, index) => `${start + index}: ${line}`)
      .join('\n');
  }
}

function renderSummary(records: readonly MemoryRecord[]): string {
  const body = records
    .filter(record => record.status === 'active')
    .sort(compareUsefulRecords)
    .slice(0, 8)
    .map(record => `- ${record.content.replace(/\s+/gu, ' ').slice(0, 300)}`)
    .join('\n');
  return [
    '# DevSeek Memory Summary',
    '',
    'Historical context only. Current user input, project rules, permissions, and live tool evidence override this summary.',
    '',
    body || 'No consolidated memory is available yet.',
    '',
  ].join('\n');
}

function renderIndex(records: readonly MemoryRecord[]): string {
  const sections = records
    .filter(record => record.status === 'active')
    .sort(compareUsefulRecords)
    .map(record => {
      const refs = record.evidenceRefs?.join(', ') || record.source.ref || 'unavailable';
      const rollouts = record.rolloutIds?.join(', ') || 'unavailable';
      return [
        `## ${record.id}`,
        '',
        record.content,
        '',
        `- type: ${record.type}`,
        `- scope: ${record.scope}`,
        `- epistemic_status: ${record.epistemicStatus ?? 'uncertain'}`,
        `- outcome: ${record.outcome ?? 'uncertain'}`,
        `- functional_stage: ${record.functionalStage ?? 'workflow'}`,
        `- source: ${record.provenance.sourceKind}${record.provenance.sourceRef ? ` (${record.provenance.sourceRef})` : ''}`,
        `- evidence_refs: ${refs}`,
        `- rollout_ids: ${rollouts}`,
        `- updated_at: ${new Date(record.updatedAt).toISOString()}`,
        `- tags: ${record.tags.join(', ') || 'none'}`,
        '',
      ].join('\n');
    });
  return [
    '# DevSeek Memory Index',
    '',
    'Search this registry first. Read at most one or two rollout files needed for the current task.',
    '',
    ...sections,
  ].join('\n');
}

function renderRollout(job: MemoryStage1Job): string {
  return [
    `# Rollout ${job.rolloutId}`,
    '',
    `- captured_at: ${new Date(job.evidence.capturedAt).toISOString()}`,
    `- outcome: ${job.evidence.status}`,
    `- job_id: ${job.id}`,
    '',
    '## Summary',
    '',
    job.output?.rolloutSummary ?? '',
    '',
    '## Raw Memory',
    '',
    job.output?.rawMemory ?? '',
    '',
    '## Evidence Refs',
    '',
    ...(job.evidence.evidenceRefs.length > 0
      ? job.evidence.evidenceRefs.map(ref => `- ${ref}`)
      : ['- unavailable']),
    '',
  ].join('\n');
}

function compareUsefulRecords(left: MemoryRecord, right: MemoryRecord): number {
  return (right.usageCount ?? 0) - (left.usageCount ?? 0)
    || (right.lastUsedAt ?? right.updatedAt) - (left.lastUsedAt ?? left.updatedAt)
    || right.updatedAt - left.updatedAt;
}

function resolveScopedReadPath(location: RepositoryMemoryLocation, relativePath: string): string {
  const normalized = String(relativePath || '').trim().replace(/\\/gu, '/');
  if (!normalized || nodePath.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error('memory-read:invalid-path');
  }
  if (normalized.split('/').some(component => component.startsWith('.'))) {
    throw new Error('memory-read:hidden-path');
  }
  const allowed = normalized === 'MEMORY.md'
    || normalized === 'memory_summary.md'
    || /^rollouts\/[a-zA-Z0-9._-]+\.md$/u.test(normalized);
  if (!allowed) throw new Error('memory-read:path-not-allowed');
  const resolved = nodePath.resolve(location.memoryRoot, normalized);
  const relative = nodePath.relative(location.memoryRoot, resolved);
  if (!relative || relative.startsWith('..') || nodePath.isAbsolute(relative)) {
    throw new Error('memory-read:path-outside-root');
  }
  return resolved;
}

function listRolloutFiles(root: string): string[] {
  try {
    if (fs.lstatSync(root).isSymbolicLink()) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.md'))
      .map(entry => nodePath.join(root, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function readBoundedFile(filePath: string, maxChars: number): string | undefined {
  try {
    rejectSymbolicLink(filePath);
    return fs.readFileSync(filePath, 'utf8').slice(0, maxChars);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function rejectSymbolicLink(filePath: string): void {
  if (fs.lstatSync(filePath).isSymbolicLink()) throw new Error(`memory-read:symlink-rejected:${filePath}`);
}

function semanticSearchTerms(query: string): string[] {
  return [...new Set(normalizeSearchText(query)
    .split(/[^\p{L}\p{N}._/-]+/u)
    .map(term => term.trim())
    .filter(term => term.length >= 2))]
    .slice(0, 12);
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

function termScore(line: string, term: string): number {
  if (line.includes(term)) return 3;
  if (term.length < 4) return 0;
  const words = line.split(/[^\p{L}\p{N}._/-]+/u).filter(Boolean);
  return words.some(word => editDistanceAtMostOne(word, term)) ? 1 : 0;
}

function editDistanceAtMostOne(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left === right) return true;
  let mismatches = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    mismatches += 1;
    if (mismatches > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return true;
}

function atomicWrite(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) rejectSymbolicLink(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

function safeFilename(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]/gu, '-').slice(0, 128);
  if (!normalized) throw new Error('memory-projection:invalid-rollout-id');
  return normalized;
}
