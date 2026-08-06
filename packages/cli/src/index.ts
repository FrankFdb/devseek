import { readFile, writeFile, mkdir } from 'fs/promises';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { join, resolve } from 'path';
import {
  AgentApplicationService,
  createProductRunEvidenceId,
  productRunEvidenceIdempotencyKey,
  summarizeTraceText,
  type AgentEvent,
  type LLMProvider,
} from '@devseek-netai/shared';
import { bridgeCancel as callBridgeCancel, bridgeChat as callBridgeChat } from './bridge-client';
import { formatCliError } from './cli-error';
import { CliLegacyWorkspaceContextSelector } from './cli-legacy-workspace-context-selector';
import { productCliCodingKernelExecutor } from './cli-product-coding-kernel';
import { CliRunEvidence } from './cli-run-evidence';
import { acceptCliCodingKernelOutput, settleCliRunFailure } from './cli-run-lifecycle';
import { CliSurfaceAdapter, createCliRunLifecycleEvent, type CliRunLifecycleStatus, type CliSurfaceKind } from './cli-surface-adapter';

interface CliOptions {
  command: 'exec' | 'interactive' | 'help' | 'version';
  prompt?: string;
  cwd: string;
  jsonl: boolean;
  mock: boolean;
  resume: boolean;
}

const VERSION = '1.0.0';
const workspaceContextSelector = new CliLegacyWorkspaceContextSelector();

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
  const evidence = CliRunEvidence.open({
    workspaceRoot: options.cwd,
    runId,
    prompt,
    surface: options.jsonl ? 'jsonl' : 'cli',
  });
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
    evidence.recordOperation({
      type: 'provider.requested',
      idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-requested', { runId, attempt: 1 }),
      payload: { provider: options.mock ? 'local-api' : 'bridge', attempt: 1 },
    }, initialProviderOperationId, 'cli-provider-client');
    let events: AgentEvent[];
    try {
      events = await service.handle(command);
    } catch (error) {
      evidence.recordOperation({
        type: 'provider.failed',
        idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-failed', { runId, attempt: 1 }),
        payload: { provider: options.mock ? 'local-api' : 'bridge', attempt: 1, error: summarizeTraceText(formatCliError(error)) },
      }, initialProviderOperationId, 'cli-provider-client');
      if (!options.mock && !cancellation.cancelled) {
        evidence.assertBridgeComplete(initialProviderOperationId, 'failed');
      }
      throw error;
    }
    const response = extractCompletedResponse(events);
    evidence.recordOperation({
      type: 'provider.completed',
      idempotencyKey: productRunEvidenceIdempotencyKey('cli-provider-completed', { runId, attempt: 1 }),
      payload: { provider: options.mock ? 'local-api' : 'bridge', attempt: 1, response: summarizeTraceText(response) },
    }, initialProviderOperationId, 'cli-provider-client');
    if (!options.mock) evidence.assertBridgeComplete(initialProviderOperationId, 'completed');
    acceptCliCodingKernelOutput(evidence, await productCliCodingKernelExecutor.execute({
      workspaceRoot: options.cwd,
      userPrompt: prompt,
      contextFiles,
      runId,
      signal: cancellation.signal,
      response,
      usesBridge: !options.mock,
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
        evidence.recordOperation(entry, operationId, boundary);
      },
      assertBridgeEvidenceComplete: (operationId, terminal) => {
        evidence.assertBridgeComplete(operationId, terminal);
      },
      emitEvent: event => emitSyntheticEvent(surface.kind, renderEvent, event),
      formatError: formatCliError,
    }));
    await surface.flush();
    await appendHistory(options.cwd, prompt);
    await renderLifecycle('completed', 0);
    await surface.flush();
    evidence.settle('completed');
    return 0;
  } catch (error) {
    const failure = await settleCliRunFailure({
      error, cancellation, usesBridge: !options.mock, evidence, surface, renderLifecycle,
    });
    console.error(`DevSeek CLI error: ${formatCliError(failure.error)}`);
    return failure.exitCode;
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
