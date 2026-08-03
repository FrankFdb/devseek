import { readFile, writeFile, mkdir } from 'fs/promises';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { join, resolve } from 'path';
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
import { bridgeCancel as callBridgeCancel, bridgeChat as callBridgeChat } from './bridge-client';
import { CliCodingArtifactInterpreter } from './cli-coding-artifact-interpreter';
import { CliLegacyCodingLoop } from './cli-legacy-coding-loop';
import { CliLegacyWorkspaceContextSelector } from './cli-legacy-workspace-context-selector';
import { CliSurfaceAdapter, createCliRunLifecycleEvent, type CliRunLifecycleStatus, type CliSurfaceKind } from './cli-surface-adapter';
import { CliVerificationService } from './cli-verification-service';
import { CliWorkspaceMutationService } from './cli-workspace-mutation-service';

interface CliOptions {
  command: 'exec' | 'interactive' | 'help' | 'version';
  prompt?: string;
  cwd: string;
  jsonl: boolean;
  mock: boolean;
  resume: boolean;
}

type CliRunSurfaceKind = 'cli' | 'jsonl';

const VERSION = '1.0.0';
const codingArtifactInterpreter = new CliCodingArtifactInterpreter();
const verificationService = new CliVerificationService();
const workspaceMutationService = new CliWorkspaceMutationService();
const workspaceContextSelector = new CliLegacyWorkspaceContextSelector();
const legacyCodingLoop = new CliLegacyCodingLoop(
  codingArtifactInterpreter,
  workspaceMutationService,
  verificationService,
);

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
    const prompt = options.resume ? await readLastPrompt(options.cwd) : options.prompt;
    if (!prompt) {
      console.error('Missing prompt. Use: devseek exec [--jsonl] <prompt>');
      return 2;
    }
    return runPrompt(options, prompt);
  }

  return runInteractive(options);
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    command: 'interactive',
    cwd: process.cwd(),
    jsonl: false,
    mock: process.env.DEVSEEK_CLI_MOCK === '1',
    resume: false,
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
    } else if (arg === '--resume') {
      options.command = 'exec';
      options.resume = true;
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
  const cancellation = createCliCancellationController(() => {
    if (!options.mock) void callBridgeCancel(options.cwd).catch(() => {});
  });
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

  const contextFiles = await workspaceContextSelector.select(options.cwd, prompt);
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
      signal: cancellation.signal,
    },
  });
  const renderLifecycle = (status: CliRunLifecycleStatus, exitCode?: number) => surface.renderLifecycleEvent(
    createCliRunLifecycleEvent({
      surface: surface.kind,
      runId,
      commandId: command.commandId,
      status,
      exitCode: exitCode ?? null,
      cancelSignal: cancellation.signalName,
    }),
  );

  try {
    await renderLifecycle('running');
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
      if (!options.mock && !cancellation.cancelled) {
        assertCliBridgeEvidenceComplete(evidence, initialProviderOperationId, 'failed');
      }
      throw error;
    }
    const response = extractCompletedResponse(events);
    recordCliOperationEvidence(evidence, {
      type: 'provider.completed',
      idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-completed', { runId, attempt: 1 }),
      payload: { provider: options.mock ? 'local-api' : 'bridge', attempt: 1, response: summarizeTraceText(response) },
    }, initialProviderOperationId, 'cli-provider-client');
    if (!options.mock) assertCliBridgeEvidenceComplete(evidence, initialProviderOperationId, 'completed');
    await legacyCodingLoop.execute({
      cwd: options.cwd,
      prompt,
      response,
      runId,
      usesBridge: !options.mock,
      signal: cancellation.signal,
      requestRepair: async request => {
        const repairCommand = surface.toChatCommand({
          prompt: request.prompt,
          request: {
            stream: false,
            trackHistory: true,
            files: [...request.files],
            traceRunId: runId,
            traceWorkspaceRoot: options.cwd,
            traceOperationId: request.operationId,
            traceEvidenceParticipantToken: evidence.participantToken,
            signal: request.signal,
          },
        });
        return extractCompletedResponse(await service.handle(repairCommand));
      },
      recordOperationEvidence: (entry, operationId, boundary) => {
        recordCliOperationEvidence(evidence, entry, operationId, boundary);
      },
      assertBridgeEvidenceComplete: (operationId, terminal) => {
        assertCliBridgeEvidenceComplete(evidence, operationId, terminal);
      },
      emitEvent: event => emitSyntheticEvent(surface.kind, renderEvent, event),
      formatError: formatCliError,
    });
    await surface.flush();
    await appendHistory(options.cwd, prompt);
    await renderLifecycle('completed', 0);
    await surface.flush();
    settleCliEvidence(evidence, runId, 'completed');
    return 0;
  } catch (error) {
    let terminalError = error;
    try {
      await surface.flush();
    } catch (flushError) {
      terminalError = flushError;
    }
    if (cancellation.cancelled && !options.mock) {
      await waitForCliBridgeProviderTerminals(evidence);
    }
    const exitCode = cancellation.cancelled ? cancellation.exitCode : 1;
    try {
      await renderLifecycle(cancellation.cancelled ? 'cancelled' : 'failed', exitCode);
      await surface.flush();
    } catch (flushError) {
      terminalError = flushError;
    }
    settleCliEvidence(evidence, runId, cancellation.cancelled ? 'cancelled' : 'failed');
    console.error(`DevSeek CLI error: ${formatCliError(terminalError)}`);
    return exitCode;
  } finally {
    cancellation.dispose();
  }
}

interface CliCancellationController {
  readonly signal: AbortSignal;
  readonly cancelled: boolean;
  readonly exitCode: number;
  readonly signalName: NodeJS.Signals | undefined;
  dispose(): void;
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

function createCliCancellationController(onCancel?: () => void): CliCancellationController {
  const controller = new AbortController();
  let signalName: NodeJS.Signals | undefined;
  const cancel = (name: NodeJS.Signals) => {
    signalName = signalName ?? name;
    if (!controller.signal.aborted) {
      onCancel?.();
      controller.abort(new Error(`DevSeek CLI cancelled by ${name}`));
    }
  };
  const onSigint = () => cancel('SIGINT');
  const onSigterm = () => cancel('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  return {
    signal: controller.signal,
    get cancelled() {
      return controller.signal.aborted && signalName !== undefined;
    },
    get exitCode() {
      return signalName === 'SIGTERM' ? 143 : 130;
    },
    get signalName() {
      return signalName;
    },
    dispose() {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
    },
  };
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

async function waitForCliBridgeProviderTerminals(
  evidence: CliEvidenceContext,
  timeoutMs = 500,
): Promise<void> {
  if (!evidence.session) return;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      if (findPendingCliBridgeProviderOperations(evidence).length === 0) return;
    } catch (error) {
      markCliEvidenceDegraded(evidence, error);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

function findPendingCliBridgeProviderOperations(evidence: CliEvidenceContext): string[] {
  if (!evidence.session) return [];
  const states = new Map<string, { requested: boolean; terminal: boolean }>();
  for (const event of evidence.session.readEvents()) {
    if (!event.type.startsWith('provider.')) continue;
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue;
    if (event.payload.boundary !== 'bridge-server') continue;
    const operationId = String(event.payload.operation_id || '').trim();
    if (!operationId) continue;
    const state = states.get(operationId) ?? { requested: false, terminal: false };
    if (event.type === 'provider.requested') state.requested = true;
    if (event.type === 'provider.completed' || event.type === 'provider.failed') state.terminal = true;
    states.set(operationId, state);
  }
  return [...states.entries()]
    .filter(([, state]) => state.requested && !state.terminal)
    .map(([operationId]) => operationId);
}

function settleCliEvidence(
  evidence: CliEvidenceContext,
  runId: string,
  status: 'completed' | 'failed' | 'cancelled',
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

function extractCompletedResponse(events: readonly AgentEvent[]): string {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event?.type === 'chat.completed') {
      return event.response;
    }
  }
  return '';
}

function emitSyntheticEvent(
  surface: CliSurfaceKind,
  renderEvent: (event: AgentEvent) => void,
  event: Record<string, unknown> & { type: AgentEvent['type'] },
): void {
  renderEvent({
    ...event,
    eventId: `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    surface,
  } as AgentEvent);
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
        const last = await readLastPrompt(options.cwd);
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

async function readLastPrompt(cwd: string): Promise<string | undefined> {
  return (await readHistory(cwd)).trim().split(/\r?\n/).filter(Boolean).at(-1);
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
  --resume    Resume the last CLI prompt from .devseek/cli-history.jsonl.
`);
}

main(process.argv.slice(2)).then(
  code => { process.exitCode = code; },
  error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  },
);
