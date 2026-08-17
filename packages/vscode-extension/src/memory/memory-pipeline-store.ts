import { createHash } from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  MEMORY_PIPELINE_VERSION,
  type MemoryPipelineDocument,
  type MemoryRolloutEvidence,
  type MemoryStage1Job,
  type MemoryStage1Output,
} from './pipeline-types';
import {
  canonicalMemoryEvidenceRef,
  normalizeMemoryRolloutEvidence,
} from './memory-evidence';
import {
  resolveRepositoryMemoryLocation,
  type RepositoryMemoryLocation,
  type RepositoryMemoryLocationOptions,
} from './repository-memory-location';

const DEFAULT_LEASE_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60_000;
const MAX_STAGE1_ATTEMPTS = 3;
const MAX_JOBS = 512;
const LEGACY_MEMORY_PIPELINE_VERSION = 'devseek.memory-pipeline/v1';

export interface MemoryPipelineStoreOptions extends RepositoryMemoryLocationOptions {
  location?: RepositoryMemoryLocation;
}

export class MemoryPipelineStore {
  readonly location: RepositoryMemoryLocation;

  constructor(workspaceRoot: string, options: MemoryPipelineStoreOptions = {}) {
    this.location = options.location
      ?? resolveRepositoryMemoryLocation(workspaceRoot, { memoryHome: options.memoryHome });
  }

  enqueue(evidence: MemoryRolloutEvidence, now = Date.now()): MemoryStage1Job {
    return this.update(document => {
      const existing = document.jobs.find(job => job.rolloutId === evidence.rolloutId);
      if (existing) return { document, result: existing };
      const job: MemoryStage1Job = {
        id: `memory-job-${hashText(`${evidence.repositoryId}\0${evidence.rolloutId}`).slice(0, 24)}`,
        rolloutId: evidence.rolloutId,
        status: 'pending',
        attemptCount: 0,
        createdAt: now,
        updatedAt: now,
        nextAttemptAt: now,
        evidence: snapshotEvidence(evidence),
      };
      return {
        document: {
          ...document,
          jobs: pruneJobs([...document.jobs, job], now),
        },
        result: job,
      };
    });
  }

  claimStage1(workerId: string, now = Date.now(), limit = 2): MemoryStage1Job[] {
    return this.update(document => {
      const claimableIds = document.jobs
        .filter(job => isStage1Claimable(job, now))
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(0, Math.max(1, limit))
        .map(job => job.id);
      const claimed = new Set(claimableIds);
      const jobs = document.jobs.map(job => claimed.has(job.id) ? {
        ...job,
        status: 'leased' as const,
        attemptCount: job.attemptCount + 1,
        leaseOwner: workerId,
        leaseExpiresAt: now + DEFAULT_LEASE_MS,
        updatedAt: now,
        lastError: undefined,
      } : job);
      return {
        document: { ...document, jobs },
        result: jobs.filter(job => claimed.has(job.id)),
      };
    });
  }

  completeStage1(
    jobId: string,
    workerId: string,
    output: MemoryStage1Output | undefined,
    now = Date.now(),
  ): MemoryStage1Job {
    return this.transitionLeasedJob(jobId, workerId, now, job => ({
      ...job,
      status: output ? 'succeeded' : 'no-output',
      updatedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      output,
    }));
  }

  failStage1(jobId: string, workerId: string, error: unknown, now = Date.now()): MemoryStage1Job {
    return this.transitionLeasedJob(jobId, workerId, now, job => ({
      ...job,
      status: job.attemptCount >= MAX_STAGE1_ATTEMPTS ? 'exhausted' : 'failed',
      updatedAt: now,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: now + retryDelay(job.attemptCount),
      lastError: truncateError(error),
    }));
  }

  claimConsolidation(workerId: string, now = Date.now(), limit = 256): MemoryStage1Job[] {
    return this.update(document => {
      const consolidation = document.consolidation;
      if (consolidation.leaseOwner
        && consolidation.leaseOwner !== workerId
        && (consolidation.leaseExpiresAt ?? 0) > now) {
        return { document, result: [] };
      }
      const selected = document.jobs
        .filter(job => job.status === 'succeeded' && !job.consolidatedAt && job.output)
        .sort((left, right) => left.updatedAt - right.updatedAt)
        .slice(0, Math.max(1, limit));
      if (selected.length === 0) return { document, result: [] };
      return {
        document: {
          ...document,
          consolidation: {
            ...consolidation,
            leaseOwner: workerId,
            leaseExpiresAt: now + DEFAULT_LEASE_MS,
            lastSelectedJobIds: selected.map(job => job.id),
            lastError: undefined,
          },
        },
        result: selected,
      };
    });
  }

  completeConsolidation(workerId: string, selectedJobIds: readonly string[], now = Date.now()): void {
    const selected = new Set(selectedJobIds);
    this.update(document => {
      assertConsolidationLease(document, workerId, now);
      return {
        document: {
          ...document,
          jobs: document.jobs.map(job => selected.has(job.id) ? { ...job, consolidatedAt: now } : job),
          consolidation: {
            lastCompletedAt: now,
            lastSelectedJobIds: [...selected],
          },
        },
        result: undefined,
      };
    });
  }

  failConsolidation(workerId: string, error: unknown, now = Date.now()): void {
    this.update(document => {
      assertConsolidationLease(document, workerId, now);
      return {
        document: {
          ...document,
          consolidation: {
            ...document.consolidation,
            leaseOwner: undefined,
            leaseExpiresAt: undefined,
            lastError: truncateError(error),
          },
        },
        result: undefined,
      };
    });
  }

  readSnapshot(): MemoryPipelineDocument {
    return this.readDocument();
  }

  private transitionLeasedJob(
    jobId: string,
    workerId: string,
    now: number,
    transition: (job: MemoryStage1Job) => MemoryStage1Job,
  ): MemoryStage1Job {
    return this.update(document => {
      const target = document.jobs.find(job => job.id === jobId);
      if (!target) throw new Error('memory-pipeline:job-not-found');
      if (target.status !== 'leased'
        || target.leaseOwner !== workerId
        || (target.leaseExpiresAt ?? 0) < now) {
        throw new Error('memory-pipeline:invalid-job-lease');
      }
      const updated = transition(target);
      return {
        document: {
          ...document,
          jobs: document.jobs.map(job => job.id === jobId ? updated : job),
        },
        result: updated,
      };
    });
  }

  private update<T>(
    mutate: (document: MemoryPipelineDocument) => { document: MemoryPipelineDocument; result: T },
  ): T {
    fs.mkdirSync(this.location.memoryRoot, { recursive: true, mode: 0o700 });
    const lockPath = `${this.location.pipelinePath}.lock`;
    const fd = acquireLock(lockPath);
    try {
      const current = this.readDocument();
      const { document, result } = mutate(current);
      if (document !== current) this.writeDocument({ ...document, revision: current.revision + 1 });
      return result;
    } finally {
      fs.closeSync(fd);
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Lock cleanup must not hide a completed state transition.
      }
    }
  }

  private readDocument(): MemoryPipelineDocument {
    const filePath = this.location.pipelinePath;
    if (!fs.existsSync(filePath)) return emptyDocument();
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`memory-pipeline:symlink-rejected:${filePath}`);
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<MemoryPipelineDocument> & {
        version?: unknown;
        jobs?: unknown[];
      };
      if ((parsed.version !== MEMORY_PIPELINE_VERSION && parsed.version !== LEGACY_MEMORY_PIPELINE_VERSION)
        || !Array.isArray(parsed.jobs)) {
        throw new Error('unsupported-document');
      }
      const jobs = parsed.jobs
        .map(normalizePersistedJob)
        .filter((job): job is MemoryStage1Job => Boolean(job));
      return {
        version: MEMORY_PIPELINE_VERSION,
        revision: normalizeCount(parsed.revision),
        jobs,
        consolidation: {
          lastSelectedJobIds: Array.isArray(parsed.consolidation?.lastSelectedJobIds)
            ? parsed.consolidation.lastSelectedJobIds.filter(value => typeof value === 'string')
            : [],
          ...(parsed.consolidation?.lastCompletedAt ? { lastCompletedAt: parsed.consolidation.lastCompletedAt } : {}),
          ...(parsed.consolidation?.leaseOwner ? { leaseOwner: parsed.consolidation.leaseOwner } : {}),
          ...(parsed.consolidation?.leaseExpiresAt ? { leaseExpiresAt: parsed.consolidation.leaseExpiresAt } : {}),
          ...(parsed.consolidation?.lastError ? { lastError: parsed.consolidation.lastError } : {}),
        },
      };
    } catch (error) {
      const failure = new Error(`memory-pipeline:invalid-document:${filePath}`) as Error & { cause?: unknown };
      failure.cause = error;
      throw failure;
    }
  }

  private writeDocument(document: MemoryPipelineDocument): void {
    const filePath = this.location.pipelinePath;
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, filePath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  }
}

function emptyDocument(): MemoryPipelineDocument {
  return {
    version: MEMORY_PIPELINE_VERSION,
    revision: 0,
    jobs: [],
    consolidation: { lastSelectedJobIds: [] },
  };
}

function snapshotEvidence(evidence: MemoryRolloutEvidence): MemoryRolloutEvidence {
  if (!evidence.rolloutId.trim() || !evidence.repositoryId.trim()) {
    throw new Error('memory-pipeline:invalid-rollout-evidence');
  }
  const normalized = normalizeMemoryRolloutEvidence(evidence);
  return Object.freeze({
    ...normalized,
    userTurns: Object.freeze(normalized.userTurns.map(value => String(value))),
    changedPaths: Object.freeze(normalized.changedPaths.map(value => String(value))),
    toolEvidence: Object.freeze(normalized.toolEvidence.map(value => String(value))),
    verificationEvidence: Object.freeze(normalized.verificationEvidence.map(value => String(value))),
    evidenceRefs: Object.freeze(normalized.evidenceRefs.map(value => String(value))),
    evidenceCatalog: Object.freeze(normalized.evidenceCatalog.map(descriptor => Object.freeze({ ...descriptor }))),
  });
}

function isStage1Claimable(job: MemoryStage1Job, now: number): boolean {
  if (job.status === 'pending') return job.nextAttemptAt <= now;
  if (job.status === 'failed') {
    return job.attemptCount < MAX_STAGE1_ATTEMPTS && job.nextAttemptAt <= now;
  }
  return job.status === 'leased' && (job.leaseExpiresAt ?? 0) <= now;
}

function assertConsolidationLease(document: MemoryPipelineDocument, workerId: string, now: number): void {
  if (document.consolidation.leaseOwner !== workerId
    || (document.consolidation.leaseExpiresAt ?? 0) < now) {
    throw new Error('memory-pipeline:invalid-consolidation-lease');
  }
}

function pruneJobs(jobs: readonly MemoryStage1Job[], now: number): MemoryStage1Job[] {
  return [...jobs]
    .filter(job => {
      const terminalAt = job.consolidatedAt
        ?? (job.status === 'exhausted' || job.status === 'no-output' ? job.updatedAt : undefined);
      return !terminalAt || now - terminalAt < 30 * 24 * 60 * 60_000;
    })
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_JOBS);
}

function retryDelay(attemptCount: number): number {
  return Math.min(MAX_RETRY_DELAY_MS, 30_000 * (2 ** Math.max(0, attemptCount - 1)));
}

function normalizeCount(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function isPlausibleJob(value: unknown): value is MemoryStage1Job {
  if (!value || typeof value !== 'object') return false;
  const job = value as Partial<MemoryStage1Job>;
  return Boolean(job.id && job.rolloutId && job.status && job.evidence);
}

function normalizePersistedJob(value: unknown): MemoryStage1Job | undefined {
  if (!isPlausibleJob(value)) return undefined;
  const status = normalizeJobStatus(value.status, normalizeCount(value.attemptCount));
  const evidence = snapshotEvidence(value.evidence);
  return {
    ...value,
    status,
    attemptCount: normalizeCount(value.attemptCount),
    createdAt: normalizeTimestamp(value.createdAt),
    updatedAt: normalizeTimestamp(value.updatedAt),
    nextAttemptAt: normalizeTimestamp(value.nextAttemptAt),
    evidence,
    ...(value.output ? { output: normalizePersistedStage1Output(value.output, evidence) } : {}),
  };
}

function normalizePersistedStage1Output(
  output: MemoryStage1Output,
  evidence: MemoryRolloutEvidence,
): MemoryStage1Output {
  return {
    ...output,
    candidates: output.candidates.map(candidate => ({
      ...candidate,
      evidenceRefs: [...new Set(candidate.evidenceRefs.map(ref => (
        canonicalMemoryEvidenceRef(evidence, ref)
      )))],
    })),
  };
}

function normalizeJobStatus(value: unknown, attemptCount: number): MemoryStage1Job['status'] {
  if (value === 'failed' && attemptCount >= MAX_STAGE1_ATTEMPTS) return 'exhausted';
  if (value === 'pending'
    || value === 'leased'
    || value === 'succeeded'
    || value === 'no-output'
    || value === 'failed'
    || value === 'exhausted') return value;
  throw new Error('memory-pipeline:invalid-job-status');
}

function normalizeTimestamp(value: unknown): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : 0;
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, ' ').slice(0, 500);
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function acquireLock(lockPath: string): number {
  try {
    const stat = fs.lstatSync(lockPath);
    if (stat.isSymbolicLink()) throw new Error(`memory-pipeline:symlink-rejected:${lockPath}`);
    if (Date.now() - stat.mtimeMs > DEFAULT_LEASE_MS) fs.unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`, 'utf8');
    return fd;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('memory-pipeline:locked');
    throw error;
  }
}
