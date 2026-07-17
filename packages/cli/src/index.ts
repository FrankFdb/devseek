import cp from 'child_process';
import type { Dirent } from 'fs';
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { dirname, join, relative, resolve } from 'path';
import {
  AgentApplicationService,
  createProductRunEvidenceAuthorityToken,
  createProductRunEvidenceId,
  ProductRunEvidenceSession,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type AgentEvent,
  type LLMProvider,
} from '@devseek-netai/shared';
import { bridgeChat as callBridgeChat } from './bridge-client';
import { CliSurfaceAdapter } from './cli-surface-adapter';

interface CliOptions {
  command: 'exec' | 'interactive' | 'help' | 'version';
  prompt?: string;
  cwd: string;
  jsonl: boolean;
  mock: boolean;
}

type CliRunSurfaceKind = 'cli' | 'jsonl';

const VERSION = '1.0.0';

async function main(argv: readonly string[]): Promise<number> {
  const options = parseArgs(argv);
  if (options.command === 'help') {
    printHelp();
    return 0;
  }
  if (options.command === 'version') {
    console.log(VERSION);
    return 0;
  }

  if (options.command === 'exec') {
    if (!options.prompt) {
      console.error('Missing prompt. Use: devseek exec [--jsonl] <prompt>');
      return 2;
    }
    return runPrompt(options, options.prompt);
  }

  return runInteractive(options);
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    command: 'interactive',
    cwd: process.cwd(),
    jsonl: false,
    mock: process.env.DEVSEEK_CLI_MOCK === '1',
  };
  const promptParts: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg) continue;
    if (arg === 'exec') {
      options.command = 'exec';
    } else if (arg === '--jsonl') {
      options.jsonl = true;
    } else if (arg === '--mock') {
      options.mock = true;
    } else if (arg === '--cwd') {
      options.cwd = resolve(argv[++index] ?? process.cwd());
    } else if (arg === '--help' || arg === '-h') {
      options.command = 'help';
    } else if (arg === '--version' || arg === '-v') {
      options.command = 'version';
    } else if (!arg.startsWith('-')) {
      options.command = 'exec';
      promptParts.push(arg);
    }
  }

  options.prompt = promptParts.join(' ').trim();
  return options;
}

async function runPrompt(options: CliOptions, prompt: string): Promise<number> {
  const surface = new CliSurfaceAdapter({ jsonl: options.jsonl });
  const renderEvent = (event: AgentEvent) => surface.renderEvent(event);
  const runId = createProductRunEvidenceId();
  const evidence = openCliRunEvidence(options, runId, prompt);
  const initialProviderOperationId = 'cli-provider-1';
  const service = new AgentApplicationService({
    getProviderType: () => options.mock ? 'local-api' : 'bridge',
    getProvider: () => createMockProvider(),
    bridgeChat: (request) => callBridgeChat(options.cwd, request),
    getChatHistory: () => [],
    recordChatHistory: () => {},
    emitEvent: renderEvent,
  });

  const contextFiles = await selectWorkspaceContextFiles(options.cwd, prompt);
  const command = surface.toChatCommand({
    prompt,
    request: {
      stream: !options.jsonl,
      trackHistory: true,
      files: contextFiles,
      traceRunId: runId,
      traceWorkspaceRoot: options.cwd,
      traceOperationId: initialProviderOperationId,
      traceEvidenceParticipantToken: evidence.participantToken,
    },
  });

  try {
    recordCliOperationEvidence(evidence, {
      type: 'provider.requested',
      idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-requested', { runId, attempt: 1 }),
      payload: { provider: options.mock ? 'local-api' : 'bridge', attempt: 1 },
    }, initialProviderOperationId, 'cli-provider-client');
    let events: AgentEvent[];
    try {
      events = await service.handle(command);
    } catch (error) {
      recordCliOperationEvidence(evidence, {
        type: 'provider.failed',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-failed', { runId, attempt: 1 }),
        payload: { provider: options.mock ? 'local-api' : 'bridge', attempt: 1, error: summarizeTraceText(formatCliError(error)) },
      }, initialProviderOperationId, 'cli-provider-client');
      if (!options.mock) assertCliBridgeEvidenceComplete(evidence, initialProviderOperationId, 'failed');
      throw error;
    }
    const response = extractCompletedResponse(events);
    recordCliOperationEvidence(evidence, {
      type: 'provider.completed',
      idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-completed', { runId, attempt: 1 }),
      payload: { provider: options.mock ? 'local-api' : 'bridge', attempt: 1, response: summarizeTraceText(response) },
    }, initialProviderOperationId, 'cli-provider-client');
    if (!options.mock) assertCliBridgeEvidenceComplete(evidence, initialProviderOperationId, 'completed');
    await runCodingLoop({
      cwd: options.cwd,
      prompt,
      response,
      service,
      surface,
      renderEvent,
      evidence,
      runId,
      usesBridge: !options.mock,
    });
    await appendHistory(options.cwd, prompt);
    settleCliEvidence(evidence, runId, 'completed');
    return 0;
  } catch (error) {
    settleCliEvidence(evidence, runId, 'failed');
    console.error(`DevSeek CLI error: ${formatCliError(error)}`);
    return 1;
  }
}

interface CliEvidenceContext {
  readonly surface: CliRunSurfaceKind;
  readonly session?: ProductRunEvidenceSession;
  readonly participantToken: string;
  degraded: boolean;
  degradationRecorded: boolean;
}

function openCliRunEvidence(
  options: CliOptions,
  runId: string,
  prompt: string,
): CliEvidenceContext {
  const surface = resolveCliRunSurfaceKind(options);
  const ownerToken = createProductRunEvidenceAuthorityToken();
  const participantToken = createProductRunEvidenceAuthorityToken();
  try {
    const session = ProductRunEvidenceSession.forWorkspace({
      workspaceRoot: options.cwd,
      runId,
      surface,
      authority: { role: 'owner', token: ownerToken, participantToken },
      openIfMissing: true,
      openPayload: {
        owner_surface: surface,
        cwd: summarizeTraceText(options.cwd),
      },
    });
    session.record({
      type: 'command.accepted',
      idempotencyKey: productRunEvidenceIdempotencyKey('cli-command-accepted', { runId }),
      payload: { prompt: summarizeTraceText(prompt) },
    });
    return { surface, session, participantToken, degraded: false, degradationRecorded: false };
  } catch (error) {
    console.error(`DevSeek evidence warning: ${formatCliError(error)}`);
    return { surface, participantToken, degraded: true, degradationRecorded: false };
  }
}

function resolveCliRunSurfaceKind(options: Pick<CliOptions, 'jsonl'>): CliRunSurfaceKind {
  return options.jsonl ? 'jsonl' : 'cli';
}

function recordCliEvidence(
  evidence: CliEvidenceContext,
  input: Parameters<ProductRunEvidenceSession['record']>[0],
): void {
  if (!evidence.session) {
    evidence.degraded = true;
    return;
  }
  try {
    evidence.session.record(input);
  } catch (error) {
    markCliEvidenceDegraded(evidence, error);
  }
}

function recordCliOperationEvidence(
  evidence: CliEvidenceContext,
  input: Parameters<ProductRunEvidenceSession['record']>[0],
  operationId: string,
  boundary?: string,
): void {
  const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload
    : {};
  recordCliEvidence(evidence, {
    ...input,
    payload: {
      ...payload,
      operation_id: operationId,
      ...(boundary ? { boundary } : {}),
      status: input.type.slice(input.type.indexOf('.') + 1),
      trust: 'product-runtime-observation',
    },
  });
}

function markCliEvidenceDegraded(evidence: CliEvidenceContext, error: unknown): void {
  evidence.degraded = true;
  const message = formatCliError(error);
  console.error(`DevSeek evidence warning: ${message}`);
  if (!evidence.session || evidence.degradationRecorded) return;
  try {
    evidence.session.record({
      type: 'evidence.degraded',
      idempotencyKey: productRunEvidenceIdempotencyKey('cli-evidence-degraded', { message }),
      payload: {
        trust: 'product-runtime-observation',
        status: 'degraded',
        reason: message,
      },
    });
    evidence.degradationRecorded = true;
  } catch (appendError) {
    console.error(`DevSeek evidence warning: ${formatCliError(appendError)}`);
  }
}

function assertCliBridgeEvidenceComplete(
  evidence: CliEvidenceContext,
  operationId: string,
  expectedTerminal: 'completed' | 'failed',
): void {
  if (!evidence.session) return;
  try {
    const matching = evidence.session.readEvents().filter(event => {
      if (!event.type.startsWith('provider.')) return false;
      if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) return false;
      return event.payload.operation_id === operationId && event.payload.boundary === 'bridge-server';
    });
    const requested = matching.filter(event => event.type === 'provider.requested').length;
    const terminal = matching.filter(event => event.type === 'provider.completed' || event.type === 'provider.failed').length;
    if (requested !== 1 || terminal !== 1 || matching.at(-1)?.type !== `provider.${expectedTerminal}`) {
      markCliEvidenceDegraded(
        evidence,
        new Error(`Bridge evidence boundary is incomplete for ${operationId}; expected provider.${expectedTerminal}`),
      );
    }
  } catch (error) {
    markCliEvidenceDegraded(evidence, error);
  }
}

function settleCliEvidence(
  evidence: CliEvidenceContext,
  runId: string,
  status: 'completed' | 'failed',
): void {
  if (!evidence.session) return;
  if (status === 'completed' && evidence.degraded) {
    console.error('DevSeek evidence warning: completed settlement refused because evidence is degraded');
    return;
  }
  try {
    evidence.session.settleAndSeal({
      status,
      idempotencyKey: productRunEvidenceIdempotencyKey('cli-run-settled', { runId }),
      payload: { surface: evidence.surface },
    });
  } catch (error) {
    markCliEvidenceDegraded(evidence, error);
  }
}

function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === 'object' && 'cause' in error
    ? (error as { cause?: unknown }).cause
    : undefined;
  if (!cause) return message;

  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const causeCode = cause && typeof cause === 'object' && 'code' in cause
    ? String((cause as { code?: unknown }).code)
    : '';
  return [message, causeCode, causeMessage].filter(Boolean).join(' ');
}

async function selectWorkspaceContextFiles(cwd: string, prompt: string): Promise<string[]> {
  const candidates = extractMentionedFilePaths(prompt);
  const files: string[] = [];
  for (const candidate of candidates) {
    await addWorkspaceContextFile(cwd, candidate, files, 256 * 1024);
  }

  if (shouldAttachImplicitProjectContext(prompt)) {
    for (const candidate of await discoverImplicitProjectContextFiles(cwd)) {
      await addWorkspaceContextFile(cwd, candidate, files, 128 * 1024);
    }
  }

  return [...new Set(files)].slice(0, 20);
}

function extractMentionedFilePaths(prompt: string): string[] {
  const matches = prompt.matchAll(
    /(?:^|[\s`'":：])((?:\/|\.{0,2}\/)?[^\s`'"<>，。；;、)）\]}]+?\.(?:cpp|cxx|cc|hpp|tsx|jsx|mjs|cjs|toml|yaml|json|java|yml|ts|js|py|rs|go|markdown|md|h|c))(?=$|[\s`'")）\]}，。；;、])/giu,
  );
  return [...new Set([...matches]
    .map(match => cleanMentionedFilePath(match[1]))
    .filter((candidate): candidate is string => Boolean(candidate)))];
}

function cleanMentionedFilePath(value: string | undefined): string {
  return String(value || '')
    .replace(/[)\]}>，。；;、]+$/gu, '')
    .trim();
}

const CONTEXT_SCAN_DIRS = ['src', 'test', 'tests', 'lib', 'app'];
const CONTEXT_MANIFESTS = [
  'package.json',
  'devseek.verify.json',
  'tsconfig.json',
  'pyproject.toml',
  'pytest.ini',
  'Cargo.toml',
  'go.mod',
  'Makefile',
];
const IGNORED_CONTEXT_DIRS = new Set([
  '.devseek',
  '.git',
  'backups',
  'build',
  'coverage',
  'dist',
  'node_modules',
]);

function shouldAttachImplicitProjectContext(prompt: string): boolean {
  return /\b(add|build|change|compile|debug|fix|implement|modify|project|refactor|run|test|update)\b/i.test(prompt)
    || /代码|项目|实现|修改|修复|测试|编译|运行/.test(prompt);
}

async function discoverImplicitProjectContextFiles(cwd: string): Promise<string[]> {
  const files: string[] = [];
  for (const manifest of CONTEXT_MANIFESTS) {
    await addWorkspaceContextFile(cwd, manifest, files, 128 * 1024);
  }
  await collectTopLevelContextFiles(cwd, files);
  for (const dir of CONTEXT_SCAN_DIRS) {
    await collectContextFiles(cwd, dir, files, 3);
  }
  return files.slice(0, 20);
}

async function collectTopLevelContextFiles(cwd: string, files: string[]): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(resolve(cwd), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= 20) return;
    if (!entry.isFile() || !isTopLevelContextFile(entry.name)) continue;
    await addWorkspaceContextFile(cwd, entry.name, files, 128 * 1024);
  }
}

async function collectContextFiles(cwd: string, dirRel: string, files: string[], depth: number): Promise<void> {
  if (files.length >= 20 || depth < 0) return;
  let entries: Dirent[];
  try {
    entries = await readdir(resolveSafeWorkspacePath(cwd, dirRel), { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (files.length >= 20) return;
    if (entry.name.startsWith('.') || IGNORED_CONTEXT_DIRS.has(entry.name)) continue;
    const relPath = toPosixPath(join(dirRel, entry.name));
    if (entry.isDirectory()) {
      await collectContextFiles(cwd, relPath, files, depth - 1);
    } else if (entry.isFile() && isContextSourceFile(relPath)) {
      await addWorkspaceContextFile(cwd, relPath, files, 128 * 1024);
    }
  }
}

async function addWorkspaceContextFile(cwd: string, candidate: string, files: string[], maxBytes: number): Promise<void> {
  let target: string;
  try {
    target = resolveSafeWorkspacePath(cwd, candidate);
    const info = await stat(target);
    if (!info.isFile() || info.size > maxBytes) return;
  } catch {
    return;
  }

  const relPath = toPosixPath(relative(resolve(cwd), target));
  if (!files.includes(relPath)) {
    files.push(relPath);
  }
}

function isTopLevelContextFile(fileName: string): boolean {
  return CONTEXT_MANIFESTS.includes(fileName)
    || /^(app|cli|index|main|server|spec|test)\.(cjs|js|mjs|py|ts)$/i.test(fileName);
}

function isContextSourceFile(filePath: string): boolean {
  return /\.(c|cc|cpp|cxx|go|h|hpp|java|js|jsx|json|mjs|py|rs|ts|tsx|yaml|yml)$/i.test(filePath);
}

interface CodingLoopInput {
  cwd: string;
  prompt: string;
  response: string;
  service: AgentApplicationService;
  surface: CliSurfaceAdapter;
  renderEvent: (event: AgentEvent) => void;
  evidence: CliEvidenceContext;
  runId: string;
  usesBridge: boolean;
}

interface FileToolCall {
  name: 'create_file' | 'replace_file';
  filePath: string;
  content: string;
}

interface CliRecoveryBoundary {
  operationId: string;
  targetOperationIds: string[];
  unresolvedOperationIds: string[];
  closed: boolean;
}

async function runCodingLoop(input: CodingLoopInput): Promise<void> {
  let response = input.response;
  let recovery: CliRecoveryBoundary | undefined;
  let recoveryExitError: unknown;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const executionAttempt = attempt + 1;
      const fileToolCalls = parseFileToolCalls(response);
      const unifiedDiffs = parseUnifiedDiffs(response);
      const candidateCount = fileToolCalls.length + unifiedDiffs.length;
      if (candidateCount === 0) {
        if (recovery) {
          throw new Error('DevSeek repair response contained no workspace artifacts to validate');
        }
        return;
      }
      const sideEffectOperationId = `cli-file-write-${executionAttempt}`;
      const verificationOperationId = `cli-verification-${executionAttempt}`;
      const recoveryCorrelation: Record<string, string> = recovery
        ? { recovery_operation_id: recovery.operationId }
        : {};
      recordCliOperationEvidence(input.evidence, {
        type: 'side_effect.requested',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-requested', {
          runId: input.runId,
          attempt: executionAttempt,
        }),
        payload: {
          kind: 'workspace-file-write',
          attempt: executionAttempt,
          candidate_count: candidateCount,
          ...recoveryCorrelation,
        },
      }, sideEffectOperationId);
      recordCliOperationEvidence(input.evidence, {
        type: 'side_effect.authorized',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-authorized', {
          runId: input.runId,
          attempt: executionAttempt,
        }),
        payload: {
          kind: 'workspace-file-write',
          attempt: executionAttempt,
          authorization: 'cli-exec-request',
          ...recoveryCorrelation,
        },
      }, sideEffectOperationId);
      recordCliOperationEvidence(input.evidence, {
        type: 'side_effect.started',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-started', {
          runId: input.runId,
          attempt: executionAttempt,
        }),
        payload: {
          kind: 'workspace-file-write',
          attempt: executionAttempt,
          candidate_count: candidateCount,
          ...recoveryCorrelation,
        },
      }, sideEffectOperationId);
      let files: string[];
      try {
        files = await applyCodingArtifacts(input.cwd, fileToolCalls, unifiedDiffs);
      } catch (error) {
        noteCliRecoveryAdverse(recovery, sideEffectOperationId);
        recordCliOperationEvidence(input.evidence, {
          type: 'side_effect.indeterminate',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-indeterminate', {
            runId: input.runId,
            attempt: executionAttempt,
          }),
          payload: {
            kind: 'workspace-file-write',
            attempt: executionAttempt,
            error: summarizeTraceText(formatCliError(error)),
            ...recoveryCorrelation,
          },
        }, sideEffectOperationId);
        throw error;
      }
      if (files.length === 0) {
        noteCliRecoveryAdverse(recovery, sideEffectOperationId);
        recordCliOperationEvidence(input.evidence, {
          type: 'side_effect.failed',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-failed', {
            runId: input.runId,
            attempt: executionAttempt,
          }),
          payload: {
            kind: 'workspace-file-write',
            attempt: executionAttempt,
            reason: 'no-applicable-workspace-artifact',
            ...recoveryCorrelation,
          },
        }, sideEffectOperationId);
        throw new Error('Model returned workspace artifacts, but none could be applied');
      }
      recordCliOperationEvidence(input.evidence, {
        type: 'side_effect.committed',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-file-write-committed', {
          runId: input.runId,
          attempt: executionAttempt,
        }),
        payload: {
          kind: 'workspace-file-write',
          attempt: executionAttempt,
          changed_file_count: files.length,
          ...recoveryCorrelation,
        },
      }, sideEffectOperationId);
      emitSyntheticEvent(input.renderEvent, {
        type: 'fileChanges.proposed',
        files,
      });

      recordCliOperationEvidence(input.evidence, {
        type: 'verification.started',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-verification-started', {
          runId: input.runId,
          attempt: executionAttempt,
        }),
        payload: { attempt: executionAttempt, changed_file_count: files.length },
      }, verificationOperationId);
      let validation: ValidationResult;
      try {
        validation = await validateChangedFiles(input.cwd, files, input.prompt);
      } catch (error) {
        noteCliRecoveryAdverse(recovery, verificationOperationId);
        recordCliOperationEvidence(input.evidence, {
          type: 'verification.failed',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-verification-settled', {
            runId: input.runId,
            attempt: executionAttempt,
          }),
          payload: { attempt: executionAttempt, passed: false, error: summarizeTraceText(formatCliError(error)) },
        }, verificationOperationId);
        recordCliOperationEvidence(input.evidence, {
          type: 'quality_gate.started',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-quality-gate-started', {
            runId: input.runId,
            attempt: executionAttempt,
          }),
          payload: { attempt: executionAttempt, changed_file_count: files.length },
        }, verificationOperationId);
        recordCliOperationEvidence(input.evidence, {
          type: 'quality_gate.failed',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-quality-gate-settled', {
            runId: input.runId,
            attempt: executionAttempt,
          }),
          payload: { attempt: executionAttempt, passed: false, reason: 'verification-error' },
        }, verificationOperationId);
        throw error;
      }
      recordCliOperationEvidence(input.evidence, {
        type: validation.passed ? 'verification.completed' : 'verification.failed',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-verification-settled', {
          runId: input.runId,
          attempt: executionAttempt,
        }),
        payload: {
          attempt: executionAttempt,
          passed: validation.passed,
          evidence_ref_count: validation.evidenceRefs.length,
          summary: summarizeTraceText(validation.summary),
        },
      }, verificationOperationId);
      recordCliOperationEvidence(input.evidence, {
        type: 'quality_gate.started',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-quality-gate-started', {
          runId: input.runId,
          attempt: executionAttempt,
        }),
        payload: { attempt: executionAttempt, changed_file_count: files.length },
      }, verificationOperationId);
      recordCliOperationEvidence(input.evidence, {
        type: validation.passed ? 'quality_gate.passed' : 'quality_gate.failed',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-quality-gate-settled', {
          runId: input.runId,
          attempt: executionAttempt,
        }),
        payload: { attempt: executionAttempt, passed: validation.passed },
      }, verificationOperationId);
      emitSyntheticEvent(input.renderEvent, {
        type: 'validation.completed',
        passed: validation.passed,
        evidenceRefs: validation.evidenceRefs,
      });
      emitSyntheticEvent(input.renderEvent, {
        type: 'qualityGate.completed',
        passed: validation.passed,
        evidenceRefs: validation.evidenceRefs,
      });

      const recoveryOperationId = 'cli-recovery-1';
      if (validation.passed) {
        if (recovery) {
          closeCliRecoveryCompleted(input.evidence, input.runId, recovery, verificationOperationId);
        }
        return;
      }
      if (attempt === 1) {
        noteCliRecoveryAdverse(recovery, verificationOperationId);
        throw new Error(`DevSeek coding validation failed after repair: ${validation.summary}`);
      }

      recovery = {
        operationId: recoveryOperationId,
        targetOperationIds: [verificationOperationId],
        unresolvedOperationIds: [verificationOperationId],
        closed: false,
      };
      recordCliOperationEvidence(input.evidence, {
        type: 'recovery.detected',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-recovery-detected', { runId: input.runId }),
        payload: { target_operation_ids: [verificationOperationId] },
      }, recoveryOperationId);

      const repairPrompt = buildRepairPrompt(input.prompt, response, files, validation);
      const providerAttempt = attempt + 2;
      const repairProviderOperationId = `cli-provider-${providerAttempt}`;
      const repairCommand = input.surface.toChatCommand({
        prompt: repairPrompt,
        request: {
          stream: false,
          trackHistory: true,
          files,
          traceRunId: input.runId,
          traceWorkspaceRoot: input.cwd,
          traceOperationId: repairProviderOperationId,
          traceEvidenceParticipantToken: input.evidence.participantToken,
        },
      });
      recordCliOperationEvidence(input.evidence, {
        type: 'provider.requested',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-requested', {
          runId: input.runId,
          attempt: providerAttempt,
        }),
        payload: { provider: 'repair', attempt: providerAttempt },
      }, repairProviderOperationId, 'cli-provider-client');
      let repairEvents: AgentEvent[];
      try {
        repairEvents = await input.service.handle(repairCommand);
      } catch (error) {
        noteCliRecoveryAdverse(recovery, repairProviderOperationId);
        recordCliOperationEvidence(input.evidence, {
          type: 'provider.failed',
          idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-failed', {
            runId: input.runId,
            attempt: providerAttempt,
          }),
          payload: { provider: 'repair', attempt: providerAttempt, error: summarizeTraceText(formatCliError(error)) },
        }, repairProviderOperationId, 'cli-provider-client');
        if (input.usesBridge) {
          assertCliBridgeEvidenceComplete(input.evidence, repairProviderOperationId, 'failed');
        }
        throw error;
      }
      response = extractCompletedResponse(repairEvents);
      recordCliOperationEvidence(input.evidence, {
        type: 'provider.completed',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-completed', {
          runId: input.runId,
          attempt: providerAttempt,
        }),
        payload: { provider: 'repair', attempt: providerAttempt, response: summarizeTraceText(response) },
      }, repairProviderOperationId, 'cli-provider-client');
      if (input.usesBridge) {
        assertCliBridgeEvidenceComplete(input.evidence, repairProviderOperationId, 'completed');
      }
    }
    throw new Error('DevSeek repair loop exhausted without a validated terminal result');
  } catch (error) {
    recoveryExitError = error;
    throw error;
  } finally {
    if (recovery && !recovery.closed) {
      closeCliRecoveryFailed(
        input.evidence,
        input.runId,
        recovery,
        recoveryExitError ?? new Error('DevSeek repair exited before successful revalidation'),
      );
    }
  }
}

function noteCliRecoveryAdverse(recovery: CliRecoveryBoundary | undefined, operationId: string): void {
  if (!recovery || recovery.unresolvedOperationIds.includes(operationId)) return;
  recovery.unresolvedOperationIds.push(operationId);
}

function closeCliRecoveryCompleted(
  evidence: CliEvidenceContext,
  runId: string,
  recovery: CliRecoveryBoundary,
  verificationOperationId: string,
): void {
  if (recovery.closed) return;
  recordCliOperationEvidence(evidence, {
    type: 'recovery.completed',
    idempotencyKey: productRunEvidenceIdempotencyKey('cli-recovery-completed', { runId }),
    payload: {
      resolves_operation_ids: recovery.targetOperationIds,
      verification_operation_id: verificationOperationId,
    },
  }, recovery.operationId);
  recovery.closed = true;
}

function closeCliRecoveryFailed(
  evidence: CliEvidenceContext,
  runId: string,
  recovery: CliRecoveryBoundary,
  error: unknown,
): void {
  if (recovery.closed) return;
  recordCliOperationEvidence(evidence, {
    type: 'recovery.failed',
    idempotencyKey: productRunEvidenceIdempotencyKey('cli-recovery-failed', { runId }),
    payload: {
      unresolved_operation_ids: recovery.unresolvedOperationIds,
      reason: summarizeTraceText(formatCliError(error)),
    },
  }, recovery.operationId);
  recovery.closed = true;
}

function buildRepairPrompt(
  originalPrompt: string,
  failedResponse: string,
  files: readonly string[],
  validation: ValidationResult,
): string {
  return [
    'You are in DevSeek repair mode. A previous edit was already applied and failed local validation.',
    'Produce the corrected edit that passes the verifier now.',
    [
      'The original request below is context only.',
      'Any original instruction about a first response, intentionally broken code, deliberate compiler errors, or waiting for a later repair step has already been fulfilled.',
      'Do not repeat or obey those first-turn failure instructions during this repair turn.',
    ].join(' '),
    'Return the minimal corrected DevSeek replace_file tool call(s) for the changed file(s) needed to pass validation. Do not explain.',
    `Verifier failure:\n${validation.summary}`,
    `Changed files:\n${files.join('\n')}`,
    `Previous failing model response:\n${truncateForPrompt(failedResponse, 4000)}`,
    `Original user request (context only):\n${originalPrompt}`,
  ].join('\n\n');
}

function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated]`;
}

async function applyCodingArtifacts(
  cwd: string,
  fileToolCalls: readonly FileToolCall[],
  unifiedDiffs: readonly UnifiedDiffArtifact[],
): Promise<string[]> {
  const files = [
    ...await applyFileToolCalls(cwd, fileToolCalls),
    ...await applyUnifiedDiffs(cwd, unifiedDiffs),
  ];
  return [...new Set(files)];
}

function extractCompletedResponse(events: readonly AgentEvent[]): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type === 'chat.completed') {
      return event.response;
    }
  }
  return '';
}

function parseFileToolCalls(response: string): FileToolCall[] {
  const calls: FileToolCall[] = [];
  let cursor = 0;
  while (cursor < response.length) {
    const match = response.slice(cursor).match(/\[TOOL:(create_file|replace_file)\s+/);
    if (!match || match.index === undefined) break;
    const name = match[1] as FileToolCall['name'];
    const objectStart = cursor + match.index + match[0].length;
    const parsed = readJsonObject(response, objectStart);
    if (!parsed) {
      cursor = objectStart;
      continue;
    }
    let input: { filePath?: unknown; path?: unknown; content?: unknown } | undefined;
    try {
      input = JSON.parse(parsed.text) as { filePath?: unknown; path?: unknown; content?: unknown };
    } catch {
      const recovered = recoverLooseFileToolCall(name, parsed.text);
      if (recovered) {
        calls.push(recovered);
      }
      cursor = parsed.end;
      continue;
    }
    const filePath = typeof input.filePath === 'string'
      ? input.filePath
      : typeof input.path === 'string'
        ? input.path
        : undefined;
    if (filePath && typeof input.content === 'string') {
      calls.push({ name, filePath, content: normalizeToolContent(filePath, input.content) });
    }
    cursor = parsed.end;
  }
  calls.push(...parseXmlToolCalls(response));
  return calls;
}

function parseXmlToolCalls(response: string): FileToolCall[] {
  const calls: FileToolCall[] = [];
  for (const match of response.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi)) {
    const rawToolCall = match[1];
    if (!rawToolCall) continue;
    const parsed = parseXmlToolCall(rawToolCall);
    if (parsed) {
      calls.push(parsed);
    }
  }
  return calls;
}

function parseXmlToolCall(rawToolCall: string): FileToolCall | undefined {
  try {
    const parsed = JSON.parse(rawToolCall) as {
      name?: unknown;
      arguments?: { filePath?: unknown; path?: unknown; content?: unknown };
    };
    const name = parsed.name === 'create_file' || parsed.name === 'replace_file'
      ? parsed.name
      : undefined;
    const filePath = typeof parsed.arguments?.filePath === 'string'
      ? parsed.arguments.filePath
      : typeof parsed.arguments?.path === 'string'
        ? parsed.arguments.path
        : undefined;
    if (name && filePath && typeof parsed.arguments?.content === 'string') {
      return { name, filePath, content: normalizeToolContent(filePath, parsed.arguments.content) };
    }
  } catch {
    const name = rawToolCall.match(/"name"\s*:\s*"(create_file|replace_file)"/)?.[1] as FileToolCall['name'] | undefined;
    if (name) {
      return recoverLooseFileToolCall(name, rawToolCall);
    }
  }
  return undefined;
}

function recoverLooseFileToolCall(name: FileToolCall['name'], rawJsonish: string): FileToolCall | undefined {
  const rawPath = matchJsonishStringField(rawJsonish, 'filePath') ?? matchJsonishStringField(rawJsonish, 'path');
  const contentStart = rawJsonish.match(/"content"\s*:\s*"/);
  if (!rawPath || !contentStart || contentStart.index === undefined) return undefined;

  const start = contentStart.index + contentStart[0].length;
  const objectEnd = rawJsonish.lastIndexOf('}');
  const end = rawJsonish.lastIndexOf('"', objectEnd > start ? objectEnd - 1 : rawJsonish.length - 1);
  if (end <= start) return undefined;

  const filePath = decodeJsonishString(rawPath);
  return {
    name,
    filePath,
    content: normalizeToolContent(filePath, decodeLooseSourceContent(rawJsonish.slice(start, end))),
  };
}

function normalizeToolContent(filePath: string, content: string): string {
  if (!/\.py$/i.test(filePath)) {
    return content;
  }
  return content.replace(/\*\*(file|main|name)\*\*/g, '__$1__');
}

function matchJsonishStringField(text: string, fieldName: string): string | undefined {
  return text.match(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`))?.[1];
}

function decodeLooseSourceContent(text: string): string {
  const protectedNewlineEscape = '\0DEVSEEK_CLI_NEWLINE_ESCAPE\0';
  return decodeJsonishString(text.replace(/\\n(?=['"])/g, protectedNewlineEscape))
    .split(protectedNewlineEscape)
    .join('\\n');
}

function decodeJsonishString(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function readJsonObject(text: string, start: number): { text: string; end: number } | undefined {
  let index = start;
  while (index < text.length && /\s/.test(text[index] ?? '')) index++;
  if (text[index] !== '{') return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return { text: text.slice(start, index + 1).trim(), end: index + 1 };
      }
    }
  }
  return undefined;
}

async function applyFileToolCalls(cwd: string, calls: readonly FileToolCall[]): Promise<string[]> {
  const files: string[] = [];
  for (const call of calls) {
    const target = resolveSafeWorkspacePath(cwd, call.filePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, call.content, 'utf8');
    files.push(toPosixPath(relative(cwd, target)));
  }
  return files;
}

interface UnifiedDiffArtifact {
  filePath: string;
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  lines: string[];
}

function parseUnifiedDiffs(response: string): UnifiedDiffArtifact[] {
  return extractDiffTexts(response)
    .map(parseUnifiedDiff)
    .filter((diff): diff is UnifiedDiffArtifact => diff !== undefined);
}

function extractDiffTexts(response: string): string[] {
  const fenced = [...response.matchAll(/```(?:diff|patch)?\s*\n([\s\S]*?)```/gi)]
    .map(match => match[1] ?? '')
    .filter(text => /^---\s+/m.test(text) && /^\+\+\+\s+/m.test(text));
  if (fenced.length > 0) return fenced;
  if (/^---\s+/m.test(response) && /^\+\+\+\s+/m.test(response)) return [response];
  return [];
}

function parseUnifiedDiff(diffText: string): UnifiedDiffArtifact | undefined {
  const lines = diffText.replace(/\r\n/g, '\n').split('\n');
  const plusLine = lines.find(line => line.startsWith('+++ '));
  if (!plusLine) return undefined;
  const filePath = normalizeDiffPath(plusLine.slice(4).trim().split(/\s+/)[0] ?? '');
  if (!filePath) return undefined;

  const hunks: DiffHunk[] = [];
  for (let index = 0; index < lines.length; index++) {
    const header = lines[index]?.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/);
    if (!header) continue;
    const hunkLines: string[] = [];
    index++;
    while (index < lines.length && !lines[index]?.startsWith('@@ ')) {
      const line = lines[index] ?? '';
      if (line.startsWith('--- ') || line.startsWith('+++ ')) break;
      if (line === '\\ No newline at end of file') {
        index++;
        continue;
      }
      if (/^[ +\-]/.test(line)) hunkLines.push(line);
      index++;
    }
    index--;
    hunks.push({ oldStart: Number(header[1]), lines: hunkLines });
  }
  return hunks.length > 0 ? { filePath, hunks } : undefined;
}

function normalizeDiffPath(diffPath: string): string {
  if (!diffPath || diffPath === '/dev/null') return '';
  return diffPath.replace(/^[ab]\//, '');
}

async function applyUnifiedDiffs(cwd: string, diffs: readonly UnifiedDiffArtifact[]): Promise<string[]> {
  const files: string[] = [];
  for (const diff of diffs) {
    const target = resolveSafeWorkspacePath(cwd, diff.filePath);
    const originalText = await readFile(target, 'utf8');
    const hadTrailingNewline = originalText.endsWith('\n');
    const originalLines = originalText.replace(/\n$/, '').split('\n');
    let originalIndex = 0;
    const outputLines: string[] = [];

    for (const hunk of diff.hunks) {
      const hunkStartIndex = Math.max(0, hunk.oldStart - 1);
      while (originalIndex < hunkStartIndex) {
        outputLines.push(originalLines[originalIndex++] ?? '');
      }
      for (const line of hunk.lines) {
        const marker = line[0];
        const text = line.slice(1);
        if (marker === ' ') {
          assertPatchLine(originalLines[originalIndex], text, diff.filePath);
          outputLines.push(originalLines[originalIndex++] ?? '');
        } else if (marker === '-') {
          assertPatchLine(originalLines[originalIndex], text, diff.filePath);
          originalIndex++;
        } else if (marker === '+') {
          outputLines.push(text);
        }
      }
    }

    while (originalIndex < originalLines.length) {
      outputLines.push(originalLines[originalIndex++] ?? '');
    }
    await writeFile(target, outputLines.join('\n') + (hadTrailingNewline ? '\n' : ''), 'utf8');
    files.push(toPosixPath(relative(cwd, target)));
  }
  return files;
}

function assertPatchLine(actual: string | undefined, expected: string, filePath: string): void {
  if (actual !== expected) {
    throw new Error(`Patch context mismatch in ${filePath}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function resolveSafeWorkspacePath(cwd: string, filePath: string): string {
  if (filePath.includes('\0')) {
    throw new Error('Refusing to write path with NUL byte');
  }
  const root = resolve(cwd);
  const target = resolve(root, filePath);
  const rel = relative(root, target);
  if (rel === '' || rel.startsWith('..') || rel.startsWith('/') || rel.startsWith('\\')) {
    throw new Error(`Refusing to write outside workspace: ${filePath}`);
  }
  return target;
}

interface ValidationResult {
  passed: boolean;
  evidenceRefs: string[];
  summary: string;
}

async function validateChangedFiles(cwd: string, files: readonly string[], prompt: string): Promise<ValidationResult> {
  const evidenceRefs: string[] = [];
  const expectedStdout = inferExpectedStdout(prompt);
  const devseekValidation = await runDevseekVerifier(cwd);
  if (devseekValidation) {
    if (devseekValidation.passed && expectedStdout) {
      const missing = expectedStdout
        .split('\n')
        .filter(line => line && !devseekValidation.evidenceRefs.join('\n').includes(line));
      if (missing.length > 0) {
        return {
          passed: false,
          evidenceRefs: devseekValidation.evidenceRefs,
          summary: `Verifier passed but did not provide evidence for requested stdout: ${missing.join(', ')}`,
        };
      }
    }
    return devseekValidation;
  }

  const projectValidation = await runProjectVerifier(cwd, files);
  if (projectValidation) {
    evidenceRefs.push(...projectValidation.evidenceRefs);
    if (!projectValidation.passed) return projectValidation;
  }

  const cppFiles = files.filter(file => /\.(cc|cpp|cxx)$/i.test(file));
  if (cppFiles.length === 0) {
    return {
      passed: true,
      evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : ['no verifier configured for changed file types'],
      summary: evidenceRefs.length > 0 ? 'All configured verifiers passed.' : 'No verifier configured for changed file types.',
    };
  }

  for (const file of cppFiles) {
    const outputRel = join('.devseek', 'bin', file.replace(/[\\/]/g, '_').replace(/\.(cc|cpp|cxx)$/i, ''));
    await mkdir(dirname(resolve(cwd, outputRel)), { recursive: true });
    const compile = cp.spawnSync('g++', ['-std=c++17', file, '-o', outputRel], {
      cwd,
      encoding: 'utf8',
      timeout: 30000,
    });
    if (compile.status !== 0) {
      return {
        passed: false,
        evidenceRefs: [`g++ -std=c++17 ${file} -o ${outputRel}`],
        summary: (compile.stderr || compile.stdout || `g++ exited ${compile.status}`).slice(0, 2000),
      };
    }
    evidenceRefs.push(`g++ -std=c++17 ${file} -o ${outputRel}`);

    const run = cp.spawnSync(resolve(cwd, outputRel), [], {
      cwd,
      encoding: 'utf8',
      timeout: 10000,
    });
    if (run.status !== 0) {
      return {
        passed: false,
        evidenceRefs,
        summary: (run.stderr || run.stdout || `${outputRel} exited ${run.status}`).slice(0, 2000),
      };
    }
    const actualStdout = (run.stdout ?? '').trim();
    evidenceRefs.push(`${outputRel}: ${actualStdout}`);
    if (expectedStdout !== undefined && actualStdout !== expectedStdout) {
      return {
        passed: false,
        evidenceRefs,
        summary: [
          `Program output for ${file} did not match the requested stdout.`,
          `Expected exactly:\n${expectedStdout}`,
          `Actual:\n${actualStdout}`,
        ].join('\n'),
      };
    }
  }

  return {
    passed: true,
    evidenceRefs,
    summary: 'All configured verifiers passed.',
  };
}

function inferExpectedStdout(prompt: string): string | undefined {
  const ordinalLines = extractOrdinalExpectedLines(prompt);
  if (ordinalLines.length > 0) {
    return ordinalLines.join('\n');
  }

  const singleLine = prompt.match(/\b(?:program\s+must\s+print|must\s+print|prints?|print)\s+exactly\s+one\s+line:\s*([^\r\n]+)/i)?.[1];
  if (singleLine) {
    return cleanExpectedStdoutLine(singleLine);
  }

  const outputBlock = extractExpectedStdoutBlock(prompt, /\b(?:outputs?|stdout)[^:\r\n]*:\s*(?:\r?\n|$)/i);
  if (outputBlock) {
    return outputBlock;
  }

  const checksBlock = extractExpectedStdoutBlock(prompt, /\bchecks?\s+(?:both\s+)?outputs?:\s*(?:\r?\n|$)/i);
  if (checksBlock) {
    return checksBlock;
  }

  const blockHeader = prompt.match(/\b(?:program\s+must\s+print|must\s+print|prints?|print)\s+exactly\s+(?:two|three|four|five|six|seven|eight|nine|ten|\d+)\s+lines?:\s*(?:\r?\n|$)/i);
  if (!blockHeader || blockHeader.index === undefined) return undefined;
  return extractExpectedStdoutBlock(prompt, blockHeader);
}

function extractExpectedStdoutBlock(prompt: string, header: RegExp | RegExpMatchArray): string | undefined {
  const blockHeader = Array.isArray(header) ? header : prompt.match(header);
  if (!blockHeader || blockHeader.index === undefined) return undefined;
  const afterHeader = prompt.slice(blockHeader.index + blockHeader[0].length);
  const expected: string[] = [];
  for (const rawLine of afterHeader.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (expected.length > 0) break;
      continue;
    }
    if (trimmed.startsWith('- ')) break;
    const line = cleanExpectedStdoutLine(trimmed);
    if (/^(do not|return exactly|return the|the tool call|task:|new requirement:)/i.test(line)) break;
    expected.push(line);
  }
  return expected.length > 0 ? expected.join('\n') : undefined;
}

function extractOrdinalExpectedLines(prompt: string): string[] {
  const ordinalWords = 'first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth';
  const ordinalLinePattern = new RegExp(
    `\\b(${ordinalWords})\\s+(?:output\\s+)?line\\s+exactly:\\s*([\\s\\S]*?)(?=(?:\\b(?:add|preserve)\\s+(?:a\\s+)?)?(?:${ordinalWords})\\s+(?:output\\s+)?line\\s+exactly:|\\r?\\n|$)`,
    'gi',
  );
  const ordinalIndex = new Map([
    ['first', 0],
    ['second', 1],
    ['third', 2],
    ['fourth', 3],
    ['fifth', 4],
    ['sixth', 5],
    ['seventh', 6],
    ['eighth', 7],
    ['ninth', 8],
    ['tenth', 9],
  ]);
  const lines: string[] = [];
  for (const match of prompt.matchAll(ordinalLinePattern)) {
    const index = ordinalIndex.get(match[1]?.toLowerCase() ?? '');
    const value = match[2] ? cleanExpectedStdoutLine(match[2]) : '';
    if (index !== undefined && value) {
      lines[index] = value;
    }
  }
  return lines.filter(value => value !== undefined);
}

function cleanExpectedStdoutLine(line: string): string {
  let value = line.trim().replace(/^[-*]\s*/, '');
  value = value.replace(/\.\s+(?=(?:add|preserve|return|do not|the|new|create|update|use|if)\b).*/i, '');
  value = value.replace(/^["'`]|["'`]$/g, '');
  if (/^[A-Za-z0-9_:-]+\.$/.test(value)) {
    value = value.slice(0, -1);
  }
  return value;
}

interface DevseekVerifierConfig {
  commands?: DevseekVerifierCommand[];
  tests?: DevseekVerifierTest[];
}

interface DevseekVerifierCommand {
  cmd?: unknown;
  args?: unknown;
  stdin?: unknown;
  expectStdoutIncludes?: unknown;
}

interface DevseekVerifierTest {
  command?: unknown;
  stdin?: unknown;
  assert?: {
    stdout_contains?: unknown;
    stdoutContains?: unknown;
  };
  expectStdoutIncludes?: unknown;
}

async function runDevseekVerifier(cwd: string): Promise<ValidationResult | undefined> {
  const verifierPath = resolve(cwd, 'devseek.verify.json');
  let raw: string;
  try {
    raw = await readFile(verifierPath, 'utf8');
  } catch {
    return undefined;
  }

  let config: DevseekVerifierConfig;
  try {
    config = JSON.parse(raw) as DevseekVerifierConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      passed: false,
      evidenceRefs: ['devseek.verify.json'],
      summary: `devseek.verify.json is not valid JSON: ${message}`,
    };
  }

  const commands = normalizeVerifierConfig(config);
  if (commands.length === 0) {
    return {
      passed: false,
      evidenceRefs: ['devseek.verify.json'],
      summary: 'devseek.verify.json must include a non-empty commands array or compatible tests array.',
    };
  }

  const evidenceRefs: string[] = [];
  for (const [index, step] of commands.entries()) {
    const normalized = normalizeVerifierCommand(cwd, step, index);
    await ensureVerifierOutputDirectory(cwd, normalized.args);
    const result = cp.spawnSync(normalized.command, normalized.args, {
      cwd,
      encoding: 'utf8',
      input: normalized.stdin,
      timeout: 30000,
    });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const display = `${normalized.display}${normalized.stdin ? ` stdin=${summarizeProcessText(normalized.stdin)}` : ''}`;
    evidenceRefs.push(`${display}: stdout=${summarizeProcessText(stdout)}${stderr ? ` stderr=${summarizeProcessText(stderr)}` : ''}`);
    if (result.status !== 0) {
      return {
        passed: false,
        evidenceRefs,
        summary: `${normalized.display} exited ${result.status}: ${summarizeProcessText(stderr || stdout)}`,
      };
    }
    for (const expected of normalized.expectStdoutIncludes) {
      if (!stdout.includes(expected)) {
        return {
          passed: false,
          evidenceRefs,
          summary: `${normalized.display} stdout did not include ${JSON.stringify(expected)}.`,
        };
      }
    }
  }

  return {
    passed: true,
    evidenceRefs,
    summary: 'devseek.verify.json passed.',
  };
}

function normalizeVerifierConfig(config: DevseekVerifierConfig): DevseekVerifierCommand[] {
  if (Array.isArray(config.commands) && config.commands.length > 0) {
    return config.commands;
  }
  if (!Array.isArray(config.tests)) {
    return [];
  }
  return config.tests.flatMap((test): DevseekVerifierCommand[] => {
    if (typeof test.command !== 'string' || test.command.trim() === '') {
      return [];
    }
    const [cmd, ...args] = splitVerifierCommandLine(test.command);
    if (!cmd) return [];
    const stdoutContains = test.assert?.stdout_contains ?? test.assert?.stdoutContains ?? test.expectStdoutIncludes;
    return [{
      cmd,
      args,
      stdin: test.stdin,
      expectStdoutIncludes: stdoutContains,
    }];
  });
}

function splitVerifierCommandLine(commandLine: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const char of commandLine.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

interface NormalizedVerifierCommand {
  command: string;
  args: string[];
  stdin: string;
  expectStdoutIncludes: string[];
  display: string;
}

function normalizeVerifierCommand(cwd: string, step: DevseekVerifierCommand, index: number): NormalizedVerifierCommand {
  if (typeof step.cmd !== 'string' || step.cmd.trim() === '') {
    throw new Error(`devseek.verify.json command ${index} must include cmd.`);
  }
  const args = Array.isArray(step.args)
    ? step.args.map(arg => {
      if (typeof arg !== 'string') throw new Error(`devseek.verify.json command ${index} args must be strings.`);
      return arg;
    })
    : [];
  const stdin = typeof step.stdin === 'string' ? step.stdin : '';
  const expectStdoutIncludes = Array.isArray(step.expectStdoutIncludes)
    ? step.expectStdoutIncludes.map(value => {
      if (typeof value !== 'string') throw new Error(`devseek.verify.json command ${index} expectStdoutIncludes must be strings.`);
      return value;
    })
    : typeof step.expectStdoutIncludes === 'string'
      ? [step.expectStdoutIncludes]
      : [];

  const cmd = step.cmd.trim();
  const command = resolveVerifierExecutable(cwd, cmd);
  return {
    command,
    args,
    stdin,
    expectStdoutIncludes,
    display: [cmd, ...args].join(' '),
  };
}

function resolveVerifierExecutable(cwd: string, cmd: string): string {
  if (cmd.includes('/') || cmd.includes('\\')) {
    return resolveSafeWorkspacePath(cwd, cmd);
  }
  if (['g++', 'node', 'npm', 'python', 'python3'].includes(cmd)) {
    return cmd;
  }
  throw new Error(`devseek.verify.json command is not allowed: ${cmd}`);
}

async function ensureVerifierOutputDirectory(cwd: string, args: readonly string[]): Promise<void> {
  const outputFlagIndex = args.indexOf('-o');
  const outputPath = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined;
  if (!outputPath || outputPath.startsWith('-')) return;
  const target = resolveSafeWorkspacePath(cwd, outputPath);
  await mkdir(dirname(target), { recursive: true });
}

function summarizeProcessText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function runProjectVerifier(cwd: string, files: readonly string[]): Promise<ValidationResult | undefined> {
  const packageJsonPath = resolve(cwd, 'package.json');
  let packageJson: { scripts?: { test?: unknown } };
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { scripts?: { test?: unknown } };
  } catch {
    return undefined;
  }
  if (typeof packageJson.scripts?.test !== 'string' || packageJson.scripts.test.trim() === '') {
    return undefined;
  }
  if (!files.some(file => /\.(js|mjs|cjs|ts|tsx|jsx|json)$/i.test(file))) {
    return undefined;
  }

  const result = cp.spawnSync('npm', ['test', '--silent'], {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  const evidenceRefs = [`npm test --silent${output ? `: ${output.slice(0, 500)}` : ''}`];
  if (result.status !== 0) {
    return {
      passed: false,
      evidenceRefs,
      summary: output || `npm test --silent exited ${result.status}`,
    };
  }
  return {
    passed: true,
    evidenceRefs,
    summary: 'npm test --silent passed.',
  };
}

function emitSyntheticEvent(renderEvent: (event: AgentEvent) => void, event: Record<string, unknown> & { type: AgentEvent['type'] }): void {
  renderEvent({
    ...event,
    eventId: `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    surface: 'cli',
  } as AgentEvent);
}

function toPosixPath(value: string): string {
  return value.split('\\').join('/');
}

async function runInteractive(options: CliOptions): Promise<number> {
  const rl = createInterface({ input, output });
  console.log('DevSeek CLI. Type :exit to quit, :history to inspect prompts, :resume to repeat the last prompt.');
  try {
    while (true) {
      const prompt = (await rl.question('devseek> ')).trim();
      if (!prompt || prompt === ':exit') break;
      if (prompt === ':history') {
        console.log(await readHistory(options.cwd));
        continue;
      }
      if (prompt === ':resume') {
        const last = (await readHistory(options.cwd)).trim().split(/\r?\n/).filter(Boolean).at(-1);
        if (!last) {
          console.log('No prompt history yet.');
          continue;
        }
        await runPrompt(options, last);
        continue;
      }
      await runPrompt(options, prompt);
    }
    return 0;
  } finally {
    rl.close();
  }
}

function createMockProvider(): LLMProvider {
  return {
    type: 'local-api',
    displayName: 'DevSeek CLI mock',
    async available() { return true; },
    async chat(options) {
      const prompt = extractPrompt(options.messages.at(-1)?.content);
      const response = `mock: ${prompt}`;
      if (options.stream) {
        options.onDelta?.(response);
      }
      return response;
    },
  };
}

function extractPrompt(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const firstText = content.find(item => item && typeof item === 'object' && 'text' in item);
    if (firstText && typeof (firstText as { text?: unknown }).text === 'string') {
      return (firstText as { text: string }).text;
    }
  }
  return '';
}

async function appendHistory(cwd: string, prompt: string): Promise<void> {
  const dir = join(cwd, '.devseek');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'cli-history.jsonl'), `${JSON.stringify({ prompt, at: new Date().toISOString() })}\n`, { flag: 'a' });
}

async function readHistory(cwd: string): Promise<string> {
  try {
    const raw = await readFile(join(cwd, '.devseek', 'cli-history.jsonl'), 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line).prompt).join('\n');
  } catch {
    return '';
  }
}

function printHelp(): void {
  console.log(`DevSeek CLI

Usage:
  devseek exec [--jsonl] [--mock] [--cwd <dir>] <prompt>
  devseek [--mock]

Commands:
  exec        Run one prompt and exit.
  --jsonl     Emit one AgentEvent JSON object per line.
  --mock      Use deterministic local provider for tests and smoke checks.
`);
}

main(process.argv.slice(2)).then(
  code => { process.exitCode = code; },
  error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
