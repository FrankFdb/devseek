import type { LLMChatOptions, LLMProvider, LLMProviderType, ChatMessage } from './llm-types';
import {
  buildTextUserMessage,
  type AgentChatHistoryRequest,
  type AgentChatRequest,
  type AgentCommand,
  type AgentEvent,
  type AgentSurfaceKind,
  type BridgeAgentChatRequest,
  type CapabilityFreeAgentChatRequest,
  type ChatCompletedEvent,
} from './agent-protocol';
import {
  assertRunEvidencePersistedSecretBoundary,
  normalizeRunEvidenceJson,
  RunEvidenceLedgerError,
  snapshotRunEvidenceInputObject,
} from './run-evidence-protocol';
import { DevSeekCapabilityTextStreamGuard } from './persisted-secret';
import { CanonicalAgentCommandService, type AgentCommandPort } from './agent-command';

interface SnapshotAgentChatRequest {
  readonly request: CapabilityFreeAgentChatRequest;
  readonly evidenceParticipantToken?: string;
}

export interface AgentApplicationServiceDeps {
  getProviderType: () => LLMProviderType;
  getProvider: () => LLMProvider;
  bridgeChat: (request: BridgeAgentChatRequest) => Promise<string>;
  getChatHistory: () => ChatMessage[];
  recordChatHistory: (request: AgentChatHistoryRequest, response: string) => void;
  promptForApiKeyUpdate?: () => Promise<boolean>;
  emitEvent?: (event: AgentEvent) => void;
  now?: () => number;
  newId?: () => string;
  commandAuthority?: AgentCommandPort;
}

export class AgentApplicationService {
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly commandAuthority: AgentCommandPort;

  constructor(private readonly deps: AgentApplicationServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
    this.commandAuthority = deps.commandAuthority ?? new CanonicalAgentCommandService();
  }

  async handle(command: AgentCommand): Promise<AgentEvent[]> {
    const accepted = this.commandAuthority.accept(command);
    switch (accepted.type) {
      case 'chat.request':
        return this.handleChatCommand(accepted);
      case 'plan.reviewDecision':
      case 'permission.decision':
      case 'task.resume':
      case 'task.cancel':
        return [this.errorEvent(accepted.commandId, `Unsupported command: ${accepted.type}`, 'UnsupportedCommand', accepted.surface)];
    }
  }

  async routeChat(request: AgentChatRequest): Promise<string> {
    return this.routeSnapshotChat(this.requireCapabilityFreeRequest(request));
  }

  private async routeSnapshotChat(snapshot: SnapshotAgentChatRequest): Promise<string> {
    const providerRequest = snapshot.request;
    const deltaGuard = new DevSeekCapabilityTextStreamGuard();
    const onDelta = providerRequest.onDelta;
    const guardedProviderRequest: CapabilityFreeAgentChatRequest = onDelta
      ? {
          ...providerRequest,
          onDelta: (delta) => {
            const released = deltaGuard.push(delta);
            if (released) onDelta(released);
          },
        }
      : providerRequest;
    const providerType = this.deps.getProviderType();
    this.emit({ type: 'provider.selected', providerType });

    if (providerType === 'bridge') {
      this.emit({
        type: 'provider.status',
        providerType,
        status: 'waiting',
        message: 'Waiting for Bridge provider response',
      });
      try {
        const bridgeRequest = this.buildBridgeTransportRequest(
          guardedProviderRequest,
          snapshot.evidenceParticipantToken,
        );
        const response = requirePrimitiveCapabilityFreeText(
          await this.deps.bridgeChat(bridgeRequest),
          'Bridge response',
        );
        const trailingDelta = deltaGuard.finish();
        if (trailingDelta && onDelta) onDelta(trailingDelta);
        this.emit({ type: 'provider.status', providerType, status: 'completed' });
        this.recordCapabilityFreeHistory(guardedProviderRequest, response);
        return response;
      } catch (error) {
        this.emit({ type: 'provider.status', providerType, status: 'completed' });
        throw capabilitySafeError(error);
      }
    }

    try {
      const response = await this.routeProviderChat(guardedProviderRequest);
      const trailingDelta = deltaGuard.finish();
      if (trailingDelta && onDelta) onDelta(trailingDelta);
      return response;
    } catch (error) {
      throw capabilitySafeError(error);
    }
  }

  private buildBridgeTransportRequest(
    providerRequest: CapabilityFreeAgentChatRequest,
    evidenceParticipantToken?: string,
  ): BridgeAgentChatRequest {
    const history = providerRequest.trackHistory
      ? snapshotCapabilityFreeChatHistory(this.deps.getChatHistory())
      : [];
    const prompt = providerRequest.trackHistory
      ? buildBridgePromptWithExplicitHistory(providerRequest.prompt, history)
      : providerRequest.prompt;
    return {
      ...providerRequest,
      ...(providerRequest.files === undefined ? {} : { files: [...providerRequest.files] }),
      ...(providerRequest.images === undefined ? {} : { images: [...providerRequest.images] }),
      prompt,
      newSession: true,
      ...(evidenceParticipantToken
        ? {
            evidenceCapability: {
              role: 'participant' as const,
              token: evidenceParticipantToken,
            },
          }
        : {}),
    };
  }

  private async handleChatCommand(command: Extract<AgentCommand, { type: 'chat.request' }>): Promise<AgentEvent[]> {
    const snapshot = this.requireCapabilityFreeRequest(command.request);
    const capabilityFreeRequest = snapshot.request;
    const events: AgentEvent[] = [];
    const started: AgentEvent = {
      type: 'chat.started',
      eventId: this.newId(),
      commandId: command.commandId,
      surface: command.surface,
      timestamp: this.now(),
      prompt: capabilityFreeRequest.prompt,
    };
    events.push(started);
    this.emit(started);

    try {
      const originalOnDelta = capabilityFreeRequest.onDelta;
      const response = await this.routeSnapshotChat({
        ...snapshot,
        request: {
          ...capabilityFreeRequest,
          onDelta: (delta) => {
            originalOnDelta?.(delta);
            const event: AgentEvent = {
              type: 'chat.delta',
              eventId: this.newId(),
              commandId: command.commandId,
              surface: command.surface,
              timestamp: this.now(),
              delta,
            };
            events.push(event);
            this.emit(event);
          },
        },
      });
      const completed: ChatCompletedEvent = {
        type: 'chat.completed',
        eventId: this.newId(),
        commandId: command.commandId,
        surface: command.surface,
        timestamp: this.now(),
        response,
      };
      events.push(completed);
      this.emit(completed);
      return events;
    } catch (error) {
      const safeError = capabilitySafeError(error);
      const event = this.errorEvent(
        command.commandId,
        capabilitySafeErrorMessage(safeError),
        'AgentExecutionFailed',
        command.surface,
      );
      events.push(event);
      this.emit(event);
      throw safeError;
    }
  }

  private async routeProviderChat(request: CapabilityFreeAgentChatRequest): Promise<string> {
    const history = request.trackHistory
      ? snapshotCapabilityFreeChatHistory(this.deps.getChatHistory())
      : [];
    const messages = snapshotCapabilityFreeChatHistory([
      ...history,
      buildTextUserMessage(request.prompt, request.images),
    ]);

    try {
      const response = requirePrimitiveCapabilityFreeText(
        await this.deps.getProvider().chat(providerChatOptions(request, messages)),
        'Provider response',
      );
      this.recordCapabilityFreeHistory(request, response);
      return response;
    } catch (error) {
      const safeError = capabilitySafeError(error);
      if (safeError instanceof Error && safeError.message === 'DEEPSEEK_INVALID_API_KEY') {
        return this.retryAfterApiKeyUpdate(request, messages);
      }
      throw safeError;
    }
  }

  private async retryAfterApiKeyUpdate(request: CapabilityFreeAgentChatRequest, messages: ChatMessage[]): Promise<string> {
    const updated = await this.deps.promptForApiKeyUpdate?.();
    this.emit({
      type: 'provider.recovery',
      reason: 'DEEPSEEK_INVALID_API_KEY',
      recovered: updated === true,
    });
    if (!updated) {
      throw new Error('请先更新有效的 DeepSeek API Key 再重试。');
    }

    try {
      const response = requirePrimitiveCapabilityFreeText(
        await this.deps.getProvider().chat(providerChatOptions(request, messages)),
        'Provider response',
      );
      this.recordCapabilityFreeHistory(request, response);
      return response;
    } catch (error) {
      throw capabilitySafeError(error);
    }
  }

  private requireCapabilityFreeRequest(
    request: AgentChatRequest,
  ): SnapshotAgentChatRequest {
    return snapshotAgentChatRequest(request);
  }

  private recordCapabilityFreeHistory(
    request: CapabilityFreeAgentChatRequest,
    response: string,
  ): void {
    assertRunEvidencePersistedSecretBoundary(response);
    this.deps.recordChatHistory({
      prompt: request.prompt,
      trackHistory: request.trackHistory,
      displayPrompt: request.displayPrompt,
    }, response);
  }

  private emit(event: Partial<AgentEvent> & { type: AgentEvent['type'] }): void {
    this.deps.emitEvent?.({
      ...event,
      eventId: event.eventId ?? this.newId(),
      timestamp: event.timestamp ?? this.now(),
    } as AgentEvent);
  }

  private errorEvent(
    commandId: string | undefined,
    message: string,
    errorType: string,
    surface?: AgentSurfaceKind,
  ): AgentEvent {
    return {
      type: 'error',
      eventId: this.newId(),
      commandId,
      timestamp: this.now(),
      ...(surface ? { surface } : {}),
      severity: 'error',
      errorType,
      message,
    };
  }
}

function requirePrimitiveCapabilityFreeText(value: unknown, name: string): string {
  assertRunEvidencePersistedSecretBoundary(value);
  if (typeof value !== 'string') {
    throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} must be primitive text`);
  }
  return value;
}

const AGENT_CHAT_REQUEST_KEYS = new Set([
  'prompt',
  'newSession',
  'mode',
  'files',
  'stream',
  'onDelta',
  'timeoutMs',
  'trackHistory',
  'displayPrompt',
  'onUsage',
  'signal',
  'images',
  'traceRunId',
  'traceWorkspaceRoot',
  'traceOperationId',
  'traceEvidenceParticipantToken',
  'onTraceEvidenceError',
]);

function snapshotAgentChatRequest(value: unknown): SnapshotAgentChatRequest {
  const input = snapshotRunEvidenceInputObject(value, 'Agent chat request must be a plain object');
  for (const key of Object.keys(input)) {
    if (!AGENT_CHAT_REQUEST_KEYS.has(key)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'Agent chat request contains unsupported fields');
    }
  }

  const request: CapabilityFreeAgentChatRequest = {
    prompt: requirePrimitiveCapabilityFreeText(input.prompt, 'Prompt'),
  };
  const output = request as unknown as Record<string, unknown>;

  for (const key of ['newSession', 'stream', 'trackHistory'] as const) {
    const candidate = input[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== 'boolean') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', `${key} must be boolean`);
    }
    output[key] = candidate;
  }

  if (input.mode !== undefined) {
    if (input.mode !== 'fast' && input.mode !== 'r1') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'mode must be fast or r1');
    }
    request.mode = input.mode;
  }
  if (input.timeoutMs !== undefined) {
    if (typeof input.timeoutMs !== 'number' || !Number.isFinite(input.timeoutMs) || input.timeoutMs < 0) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'timeoutMs must be a finite non-negative number');
    }
    request.timeoutMs = input.timeoutMs;
  }

  for (const key of ['displayPrompt', 'traceRunId', 'traceWorkspaceRoot', 'traceOperationId'] as const) {
    const candidate = input[key];
    if (candidate === undefined) continue;
    output[key] = requirePrimitiveCapabilityFreeText(candidate, key);
  }
  if (input.files !== undefined) {
    request.files = snapshotCapabilityFreeTextArray(input.files, 'files');
  }
  if (input.images !== undefined) {
    request.images = snapshotCapabilityFreeTextArray(input.images, 'images');
  }

  if (input.onDelta !== undefined) {
    if (typeof input.onDelta !== 'function') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'onDelta must be a function');
    }
    const callback = input.onDelta as (delta: string) => void;
    request.onDelta = delta => Reflect.apply(callback, undefined, [delta]);
  }
  if (input.onUsage !== undefined) {
    if (typeof input.onUsage !== 'function') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'onUsage must be a function');
    }
    const callback = input.onUsage as NonNullable<AgentChatRequest['onUsage']>;
    request.onUsage = usage => Reflect.apply(callback, undefined, [usage]);
  }
  if (input.onTraceEvidenceError !== undefined) {
    if (typeof input.onTraceEvidenceError !== 'function') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'onTraceEvidenceError must be a function');
    }
    const callback = input.onTraceEvidenceError as NonNullable<AgentChatRequest['onTraceEvidenceError']>;
    request.onTraceEvidenceError = error => Reflect.apply(callback, undefined, [error]);
  }
  if (input.signal !== undefined) {
    request.signal = snapshotAbortSignal(input.signal);
  }

  let evidenceParticipantToken: string | undefined;
  if (input.traceEvidenceParticipantToken !== undefined) {
    if (typeof input.traceEvidenceParticipantToken !== 'string') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'Evidence participant token must be primitive text');
    }
    evidenceParticipantToken = input.traceEvidenceParticipantToken;
  }
  return {
    request,
    ...(evidenceParticipantToken === undefined ? {} : { evidenceParticipantToken }),
  };
}

function snapshotCapabilityFreeTextArray(value: unknown, name: string): string[] {
  const snapshot = normalizeRunEvidenceJson(value);
  if (!Array.isArray(snapshot) || snapshot.some(item => typeof item !== 'string')) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', `${name} must be an array of primitive text`);
  }
  return [...snapshot] as string[];
}

function snapshotAbortSignal(value: unknown): AbortSignal {
  try {
    if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== AbortSignal.prototype) {
      throw new Error('invalid signal');
    }
    const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
    if (!abortedGetter) throw new Error('missing AbortSignal brand guard');
    const controller = new AbortController();
    const abort = () => controller.abort();
    EventTarget.prototype.addEventListener.call(value, 'abort', abort, { once: true });
    if (Reflect.apply(abortedGetter, value, [])) {
      EventTarget.prototype.removeEventListener.call(value, 'abort', abort);
      controller.abort();
    }
    return controller.signal;
  } catch {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'signal must be a native AbortSignal');
  }
}

function snapshotCapabilityFreeChatHistory(value: unknown): ChatMessage[] {
  const snapshot = normalizeRunEvidenceJson(value);
  if (!Array.isArray(snapshot)) {
    throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history must be an array');
  }
  return snapshot.map((message) => {
    if (!isJsonRecord(message) || !hasOnlyKeys(message, ['role', 'content'])) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history messages must use the supported shape');
    }
    if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history message role is invalid');
    }
    const role = message.role;
    if (typeof message.content === 'string') return { role, content: message.content };
    if (!Array.isArray(message.content)) {
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history message content is invalid');
    }
    const content = message.content.map((part) => {
      if (!isJsonRecord(part) || typeof part.type !== 'string') {
        throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history content part is invalid');
      }
      if (part.type === 'text') {
        if (!hasOnlyKeys(part, ['type', 'text']) || (part.text !== undefined && typeof part.text !== 'string')) {
          throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history text part is invalid');
        }
        return {
          type: 'text' as const,
          ...(part.text === undefined ? {} : { text: part.text }),
        };
      }
      if (part.type === 'image_url') {
        if (!hasOnlyKeys(part, ['type', 'image_url'])) {
          throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history image part is invalid');
        }
        if (part.image_url === undefined) return { type: 'image_url' as const };
        if (
          !isJsonRecord(part.image_url)
          || !hasOnlyKeys(part.image_url, ['url'])
          || typeof part.image_url.url !== 'string'
        ) {
          throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history image URL is invalid');
        }
        return { type: 'image_url' as const, image_url: { url: part.image_url.url } };
      }
      throw new RunEvidenceLedgerError('INVALID_INPUT', 'Chat history content part type is invalid');
    });
    return { role, content };
  });
}

function providerChatOptions(
  request: CapabilityFreeAgentChatRequest,
  messages: ChatMessage[],
): LLMChatOptions {
  return {
    messages: snapshotCapabilityFreeChatHistory(messages),
    mode: request.mode,
    stream: request.stream,
    onDelta: request.onDelta === undefined
      ? undefined
      : delta => request.onDelta?.(delta),
    timeoutMs: request.timeoutMs,
    onUsage: request.onUsage === undefined
      ? undefined
      : usage => request.onUsage?.(usage),
    signal: request.signal === undefined ? undefined : snapshotAbortSignal(request.signal),
    files: request.files === undefined ? undefined : [...request.files],
    traceRunId: request.traceRunId,
    traceWorkspaceRoot: request.traceWorkspaceRoot,
    traceOperationId: request.traceOperationId,
  };
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every(key => allowedKeys.has(key));
}

function capabilitySafeError(error: unknown): Error {
  let message = 'External provider operation failed';
  let code: string | undefined;
  try {
    const candidateMessage = typeof error === 'string'
      ? error
      : error && (typeof error === 'object' || typeof error === 'function')
        ? Reflect.get(error, 'message')
        : undefined;
    if (candidateMessage !== undefined) {
      message = requirePrimitiveCapabilityFreeText(candidateMessage, 'External error message');
    }
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      const candidateCode = Reflect.get(error, 'code');
      if (candidateCode !== undefined) {
        code = requirePrimitiveCapabilityFreeText(candidateCode, 'External error code');
      }
    }
  } catch {
    return new RunEvidenceLedgerError('INVALID_INPUT', 'External provider data contained forbidden secret material');
  }
  const safe = new Error(message) as Error & { code?: string };
  if (code !== undefined) {
    Object.defineProperty(safe, 'code', {
      value: code,
      enumerable: true,
      configurable: true,
      writable: false,
    });
  }
  return safe;
}

function capabilitySafeErrorMessage(error: Error): string {
  return error.message;
}

function buildBridgePromptWithExplicitHistory(prompt: string, history: ChatMessage[]): string {
  const historyText = formatBridgeHistory(history);
  if (!historyText) return prompt;

  return [
    '【DevSeek 当前 session 显式上下文】',
    '以下内容只来自当前 DevSeek session 的本地历史。不要使用 DeepSeek 网页中可能残留的旧对话作为上下文。',
    '',
    historyText,
    '',
    '【当前用户请求】',
    prompt,
  ].join('\n');
}

function formatBridgeHistory(history: ChatMessage[]): string {
  const items = history
    .slice(-12)
    .map((message) => {
      const content = stringifyMessageContent(message.content).trim();
      if (!content) return '';
      return `[${message.role}]\n${truncateForBridgeHistory(content, 1200)}`;
    })
    .filter(Boolean);
  return truncateForBridgeHistory(items.join('\n\n'), 10_000);
}

function stringifyMessageContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text)
    .join('\n');
}

function truncateForBridgeHistory(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...[已截断，仅保留当前 session 最近上下文]`;
}
