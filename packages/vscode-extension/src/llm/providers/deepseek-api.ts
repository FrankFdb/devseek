/**
 * DeepSeek API Provider — 直接调用 DeepSeek 官方 API
 * 无需浏览器，使用 API Key，支持 deepseek-chat / deepseek-reasoner 等模型
 * API 兼容 OpenAI Chat Completions 格式
 */
import * as https from 'https';
import * as vscode from 'vscode';
import { LLMProvider, LLMProviderType, LLMChatOptions, TokenUsage } from '../types';

const API_HOSTNAME = 'api.deepseek.com';
const API_PATH = '/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';

export class DeepSeekApiProvider implements LLMProvider {
  readonly type: LLMProviderType = 'deepseek-api';
  readonly displayName = '$(key) API';

  private apiKey(): string {
    return vscode.workspace.getConfiguration('devseek').get<string>('apiKey', '').trim();
  }

  private model(): string {
    return vscode.workspace.getConfiguration('devseek').get<string>('model', DEFAULT_MODEL).trim();
  }

  async available(): Promise<boolean> {
    return this.apiKey().length > 0;
  }

  async chat(opts: LLMChatOptions): Promise<string> {
    const key = this.apiKey();
    if (!key) {
      throw new Error(
        'DeepSeek API Key 未配置。\n请在 VS Code 设置中填写 devseek.apiKey，\n或切换回"网页"模式。',
      );
    }

    // Only use SSE streaming when a delta callback is actually provided.
    // If stream:true is sent but we call _simpleChat (no onDelta), the API
    // returns SSE text and JSON.parse throws "响应解析失败".
    const useStream = opts.stream !== false && !!opts.onDelta;

    const body = JSON.stringify({
      model: opts.model ?? this.model(),
      messages: opts.messages,
      stream: useStream,
    });

    const timeoutMs = opts.timeoutMs
      ?? vscode.workspace.getConfiguration('devseek').get<number>('requestTimeoutMs', 120000);

    if (useStream) {
      return this._streamChat(key, body, opts.onDelta!, timeoutMs, opts.signal, opts.onUsage);
    }
    return this._simpleChat(key, body, timeoutMs, opts.signal, opts.onUsage);
  }

  private _simpleChat(
    apiKey: string,
    body: string,
    timeoutMs: number,
    signal?: AbortSignal,
    onUsage?: (u: TokenUsage) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('已取消')); return; }

      const req = https.request(
        { hostname: API_HOSTNAME, path: API_PATH, method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c: Buffer) => { data += c.toString(); });
          res.on('end', () => {
            try {
              if (res.statusCode === 401 || res.statusCode === 403) {
                reject(new Error('DEEPSEEK_INVALID_API_KEY'));
                return;
              }
              const json = JSON.parse(data);
              if (json.error) {
                if (json.error.code === 'invalid_api_key' || json.error.type === 'authentication_error') {
                  reject(new Error('DEEPSEEK_INVALID_API_KEY'));
                  return;
                }
                reject(new Error(`DeepSeek API: ${json.error.message}`)); return;
              }
              if (onUsage && json.usage) {
                onUsage({ promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens });
              }
              resolve(json.choices?.[0]?.message?.content ?? '');
            } catch (e) {
              reject(new Error(`响应解析失败: ${data.slice(0, 200)}`));
            }
          });
        },
      );

      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('DeepSeek API 请求超时')); });
      req.on('error', reject);
      signal?.addEventListener('abort', () => { req.destroy(); reject(new Error('已取消')); });
      req.write(body);
      req.end();
    });
  }

  private _streamChat(
    apiKey: string,
    body: string,
    onDelta: (d: string) => void,
    timeoutMs: number,
    signal?: AbortSignal,
    onUsage?: (u: TokenUsage) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('已取消')); return; }

      let full = '';
      let buf = '';

      const req = https.request(
        { hostname: API_HOSTNAME, path: API_PATH, method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let errData = '';
            res.on('data', (c: Buffer) => { errData += c.toString(); });
            res.on('end', () => {
              if (res.statusCode === 401 || res.statusCode === 403) {
                reject(new Error('DEEPSEEK_INVALID_API_KEY')); return;
              }
              try {
                const j = JSON.parse(errData);
                if (j.error?.code === 'invalid_api_key' || j.error?.type === 'authentication_error') {
                  reject(new Error('DEEPSEEK_INVALID_API_KEY')); return;
                }
                reject(new Error(`DeepSeek API ${res.statusCode}: ${j.error?.message ?? errData.slice(0, 200)}`));
              } catch {
                reject(new Error(`DeepSeek API ${res.statusCode}: ${errData.slice(0, 200)}`));
              }
            });
            return;
          }

          res.on('data', (chunk: Buffer) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';   // 保留未完整行
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const jsonStr = trimmed.slice(5).trim();
              if (jsonStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(jsonStr);
                // Capture usage from final SSE chunk (present in DeepSeek API format)
                if (onUsage && parsed.usage) {
                  onUsage({ promptTokens: parsed.usage.prompt_tokens, completionTokens: parsed.usage.completion_tokens, totalTokens: parsed.usage.total_tokens });
                }
                const delta = parsed.choices?.[0]?.delta?.content;
                if (delta) { onDelta(delta); full += delta; }
              } catch { /* 忽略单行解析错误 */ }
            }
          });

          res.on('end', () => resolve(full));
          res.on('error', reject);
        },
      );

      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('DeepSeek API 请求超时')); });
      req.on('error', reject);
      signal?.addEventListener('abort', () => { req.destroy(); reject(new Error('已取消')); });
      req.write(body);
      req.end();
    });
  }
}
