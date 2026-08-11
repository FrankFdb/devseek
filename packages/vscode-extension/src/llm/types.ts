import type {
  ChatMessage as SharedChatMessage,
  ContentPart as SharedContentPart,
  LLMChatOptions as SharedLLMChatOptions,
  LLMProvider as SharedLLMProvider,
  LLMProviderCapability as SharedLLMProviderCapability,
  LLMProviderType as SharedLLMProviderType,
  TokenUsage as SharedTokenUsage,
} from '@devseek-netai/shared';

export type LLMProviderType = SharedLLMProviderType;
export type LLMProviderCapability = SharedLLMProviderCapability;
export type ContentPart = SharedContentPart;
export type ChatMessage = SharedChatMessage;
export type TokenUsage = SharedTokenUsage;
export type LLMChatOptions = SharedLLMChatOptions;
export type LLMProvider = SharedLLMProvider;

export type LLMProviderHealthStatus = 'unknown' | 'available' | 'degraded' | 'unavailable';

export interface LLMProviderHealth {
  status: LLMProviderHealthStatus;
  checkedAt?: number;
  reason?: string;
}
