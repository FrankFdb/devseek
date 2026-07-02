import * as crypto from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';

export type DevSeekTraceLevel = 'off' | 'error' | 'info' | 'debug' | 'trace';

export interface DevSeekTraceLoggerOptions {
  workspaceRoot: string;
  source: string;
  level?: DevSeekTraceLevel | string;
  runId?: string;
  now?: Date;
  appVersion?: string;
  buildChannel?: string;
  buildId?: string;
  gitCommit?: string;
}

export interface DevSeekTraceEvent {
  ts?: string;
  seq?: number;
  pid?: number;
  level: Exclude<DevSeekTraceLevel, 'off'>;
  source?: string;
  tag?: string;
  phase: string;
  event: string;
  runId?: string;
  data?: unknown;
}

export interface DevSeekTracePayloadRecord {
  ts: string;
  seq: number;
  pid: number;
  source: string;
  tag: string;
  name: string;
  runId: string;
  contentType: string;
  length: number;
  sha256: string;
  content: string;
}

const TRACE_LEVELS: Record<DevSeekTraceLevel, number> = {
  off: 0,
  error: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY_RE = /(?:token|cookie|authorization|password|secret|api[_-]?key|session|credential)/i;
const TRACE_SEQ_BY_RUN = new Map<string, number>();

export function resolveDevSeekTraceLevel(
  value: string | undefined,
  fallback: DevSeekTraceLevel = 'debug',
): DevSeekTraceLevel {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'off' || normalized === 'error' || normalized === 'info' || normalized === 'debug' || normalized === 'trace') {
    return normalized;
  }
  return fallback;
}

export function createDevSeekRunId(now = new Date()): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
  return stamp;
}

export function hashTraceText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function getDevSeekTraceRoot(workspaceRoot: string): string {
  return nodePath.join(workspaceRoot, '.devseek', 'runs');
}

function traceLogFileName(runId: string): string {
  const safeRunId = runId.replace(/[^a-zA-Z0-9._-]/g, '_') || createDevSeekRunId();
  return `${safeRunId}.log`;
}

export class DevSeekTraceLogger {
  readonly workspaceRoot: string;
  readonly source: string;
  readonly level: DevSeekTraceLevel;
  readonly runId: string;
  readonly runDir: string;
  readonly logPath: string;
  private readonly buildInfo: DevSeekBuildInfo;

  constructor(options: DevSeekTraceLoggerOptions) {
    this.workspaceRoot = nodePath.resolve(options.workspaceRoot);
    this.source = options.source;
    this.level = resolveDevSeekTraceLevel(String(options.level ?? process.env.DEVSEEK_TRACE_LEVEL ?? 'debug'));
    this.runId = options.runId || createDevSeekRunId(options.now);
    this.runDir = getDevSeekTraceRoot(this.workspaceRoot);
    this.logPath = nodePath.join(this.runDir, traceLogFileName(this.runId));
    this.buildInfo = resolveBuildInfo(options);
    this.init(options.now ?? new Date());
  }

  enabled(level: Exclude<DevSeekTraceLevel, 'off'> = 'info'): boolean {
    return TRACE_LEVELS[this.level] >= TRACE_LEVELS[level];
  }

  event(
    level: Exclude<DevSeekTraceLevel, 'off'>,
    phase: string,
    event: string,
    data?: unknown,
  ): void {
    if (!this.enabled(level)) return;
    this.ensureRunDir();
    const entry: DevSeekTraceEvent = {
      ts: new Date().toISOString(),
      seq: this.nextSeq(),
      pid: process.pid,
      level,
      source: this.source,
      tag: phase,
      phase,
      event,
      runId: this.runId,
      data: sanitizeTraceData(data),
    };
    this.appendLog(entry);
  }

  info(phase: string, event: string, data?: unknown): void {
    this.event('info', phase, event, data);
  }

  debug(phase: string, event: string, data?: unknown): void {
    this.event('debug', phase, event, data);
  }

  error(phase: string, event: string, data?: unknown): void {
    this.event('error', phase, event, data);
  }

  writeTextArtifact(
    relPath: string,
    content: string,
    minLevel: Exclude<DevSeekTraceLevel, 'off'> = 'debug',
  ): string | undefined {
    const payloadId = this.payload('artifact', relPath, content, 'text/plain; charset=utf-8', minLevel);
    if (!payloadId) return undefined;
    return `payload:${payloadId}`;
  }

  payload(
    tag: string,
    name: string,
    content: string,
    contentType = 'text/plain; charset=utf-8',
    minLevel: Exclude<DevSeekTraceLevel, 'off'> = 'debug',
  ): string | undefined {
    if (!this.enabled(minLevel)) return undefined;
    this.ensureRunDir();
    const seq = this.nextSeq();
    const payloadId = `${this.source}:${seq}`;
    const record: DevSeekTracePayloadRecord = {
      ts: new Date().toISOString(),
      seq,
      pid: process.pid,
      source: this.source,
      tag,
      name,
      runId: this.runId,
      contentType,
      length: content.length,
      sha256: hashTraceText(content),
      content,
    };
    this.appendLog({
      ts: record.ts,
      seq,
      pid: record.pid,
      level: minLevel,
      source: this.source,
      phase: 'payload',
      event: 'payload-recorded',
      tag,
      runId: this.runId,
      data: record,
    });
    this.event('debug', 'trace', 'payload-written', {
      payloadId,
      tag,
      name,
      length: record.length,
      sha256: record.sha256,
    });
    return payloadId;
  }

  child(source: string): DevSeekTraceLogger {
    return new DevSeekTraceLogger({
      workspaceRoot: this.workspaceRoot,
      source,
      level: this.level,
      runId: this.runId,
      ...this.buildInfo,
    });
  }

  private init(now: Date): void {
    if (this.level === 'off') return;
    this.ensureRunDir();
    if (!fs.existsSync(this.logPath)) {
      this.appendLog({
        level: 'info',
        phase: 'trace',
        event: 'run-started',
        tag: 'trace',
        data: {
          schemaVersion: 1,
          runId: this.runId,
          createdAt: now.toISOString(),
          workspaceRoot: this.workspaceRoot,
          traceLevel: this.level,
          logPath: this.logPath,
          ...this.buildInfo,
        },
      });
    }
    this.info('trace', 'participant-started', {
      source: this.source,
      pid: process.pid,
      ...this.buildInfo,
    });
  }

  private ensureRunDir(): void {
    fs.mkdirSync(this.runDir, { recursive: true });
  }

  private appendLog(entry: DevSeekTraceEvent): void {
    this.ensureRunDir();
    const normalized: DevSeekTraceEvent = {
      ...entry,
      ts: entry.ts ?? new Date().toISOString(),
      seq: entry.seq ?? this.nextSeq(),
      pid: entry.pid ?? process.pid,
      source: entry.source ?? this.source,
      runId: entry.runId ?? this.runId,
    };
    fs.appendFileSync(this.logPath, `${JSON.stringify(normalized)}\n`, 'utf8');
  }

  private nextSeq(): number {
    const key = this.logPath;
    const previous = TRACE_SEQ_BY_RUN.get(key) ?? 0;
    const candidate = Math.max(previous + 1, Date.now() * 1000);
    TRACE_SEQ_BY_RUN.set(key, candidate);
    return candidate;
  }
}

export interface DevSeekBuildInfo {
  appVersion?: string;
  buildChannel?: string;
  buildId?: string;
  gitCommit?: string;
}

export function createDevSeekTraceLogger(options: DevSeekTraceLoggerOptions): DevSeekTraceLogger {
  return new DevSeekTraceLogger(options);
}

export function summarizeTraceText(value: string): { length: number; sha256: string } {
  return {
    length: value.length,
    sha256: hashTraceText(value),
  };
}

function resolveBuildInfo(options: DevSeekTraceLoggerOptions): DevSeekBuildInfo {
  return {
    appVersion: options.appVersion || process.env.DEVSEEK_VERSION || undefined,
    buildChannel: options.buildChannel || process.env.DEVSEEK_BUILD_CHANNEL || undefined,
    buildId: options.buildId || process.env.DEVSEEK_BUILD_ID || undefined,
    gitCommit: options.gitCommit || process.env.DEVSEEK_GIT_COMMIT || undefined,
  };
}

function sanitizeTraceData(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY_RE.test(key)) return REDACTED;
  if (typeof value === 'string') {
    return value.length > 8000 ? `${value.slice(0, 8000)}...[truncated:${value.length}]` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => sanitizeTraceData(item));
  const out: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    out[entryKey] = sanitizeTraceData(entryValue, entryKey);
  }
  return out;
}
