import type { LLMProvider, LLMProviderType, ChatMessage } from './llm-types';
import {
  buildTextUserMessage,
  type AgentChatRequest,
  type AgentCommand,
  type AgentEvent,
  type ChatCompletedEvent,
} from './agent-protocol';

export interface AgentApplicationServiceDeps {
  getProviderType: () => LLMProviderType;
  getProvider: () => LLMProvider;
  bridgeChat: (request: AgentChatRequest) => Promise<string>;
  getChatHistory: () => ChatMessage[];
  recordChatHistory: (request: AgentChatRequest, response: string) => void;
  promptForApiKeyUpdate?: () => Promise<boolean>;
  emitEvent?: (event: AgentEvent) => void;
  now?: () => number;
  newId?: () => string;
}

export class AgentApplicationService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: AgentApplicationServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  }

  async handle(command: AgentCommand): Promise<AgentEvent[]> {
    switch (command.type) {
      case 'chat.request':
        return this.handleChatCommand(command);
      case 'plan.reviewDecision':
      case 'permission.decision':
      case 'task.resume':
      case 'task.cancel':
        return [this.errorEvent(command.commandId, `Unsupported command: ${command.type}`, 'UnsupportedCommand')];
    }
  }

  async routeChat(request: AgentChatRequest): Promise<string> {
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
        const bridgeRequest = this.buildBridgeTransportRequest(request);
        const response = await this.deps.bridgeChat(bridgeRequest);
        this.emit({ type: 'provider.status', providerType, status: 'completed' });
        this.deps.recordChatHistory(request, response);
        return response;
      } catch (error) {
        this.emit({ type: 'provider.status', providerType, status: 'completed' });
        throw error;
      }
    }

    return this.routeProviderChat(request);
  }

  private buildBridgeTransportRequest(request: AgentChatRequest): AgentChatRequest {
    const prompt = request.trackHistory
      ? buildBridgePromptWithExplicitHistory(request.prompt, this.deps.getChatHistory())
      : request.prompt;
    return {
      ...request,
      prompt,
      newSession: true,
    };
  }

  private async handleChatCommand(command: Extract<AgentCommand, { type: 'chat.request' }>): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    const started: AgentEvent = {
      type: 'chat.started',
      eventId: this.newId(),
      commandId: command.commandId,
      surface: command.surface,
      timestamp: this.now(),
      prompt: command.request.prompt,
    };
    events.push(started);
    this.emit(started);

    try {
      const response = await this.routeChat({
        ...command.request,
        onDelta: (delta) => {
          command.request.onDelta?.(delta);
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
      const event = this.errorEvent(
        command.commandId,
        error instanceof Error ? error.message : String(error),
        'AgentExecutionFailed',
      );
      events.push(event);
      this.emit(event);
      throw error;
    }
  }

  private async routeProviderChat(request: AgentChatRequest): Promise<string> {
    const messages: ChatMessage[] = [
      ...(request.trackHistory ? this.deps.getChatHistory() : []),
      buildTextUserMessage(request.prompt, request.images),
    ];

    try {
      const response = await this.deps.getProvider().chat({
        messages,
        mode: request.mode,
        stream: request.stream,
        onDelta: request.onDelta,
        timeoutMs: request.timeoutMs,
        onUsage: request.onUsage,
        signal: request.signal,
        files: request.files,
        traceRunId: request.traceRunId,
        traceWorkspaceRoot: request.traceWorkspaceRoot,
      });
      this.deps.recordChatHistory(request, response);
      return response;
    } catch (error) {
      if (error instanceof Error && error.message === 'DEEPSEEK_INVALID_API_KEY') {
        return this.retryAfterApiKeyUpdate(request, messages);
      }
      throw error;
    }
  }

  private async retryAfterApiKeyUpdate(request: AgentChatRequest, messages: ChatMessage[]): Promise<string> {
    const updated = await this.deps.promptForApiKeyUpdate?.();
    this.emit({
      type: 'provider.recovery',
      reason: 'DEEPSEEK_INVALID_API_KEY',
      recovered: updated === true,
    });
    if (!updated) {
      throw new Error('请先更新有效的 DeepSeek API Key 再重试。');
    }

    const response = await this.deps.getProvider().chat({
      messages,
      mode: request.mode,
      stream: request.stream,
      onDelta: request.onDelta,
      timeoutMs: request.timeoutMs,
      onUsage: request.onUsage,
      signal: request.signal,
      files: request.files,
      traceRunId: request.traceRunId,
      traceWorkspaceRoot: request.traceWorkspaceRoot,
    });
    this.deps.recordChatHistory(request, response);
    return response;
  }

  private emit(event: Partial<AgentEvent> & { type: AgentEvent['type'] }): void {
    this.deps.emitEvent?.({
      ...event,
      eventId: event.eventId ?? this.newId(),
      timestamp: event.timestamp ?? this.now(),
    } as AgentEvent);
  }

  private errorEvent(commandId: string | undefined, message: string, errorType: string): AgentEvent {
    return {
      type: 'error',
      eventId: this.newId(),
      commandId,
      timestamp: this.now(),
      severity: 'error',
      errorType,
      message,
    };
  }
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
