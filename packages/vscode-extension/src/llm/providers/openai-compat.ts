/**
 * OpenAI 兼容 Provider — 对接任何实现 OpenAI Chat Completions API 的服务
 * 例如：本地 Ollama、LM Studio、OpenAI、Azure OpenAI、Groq、Together AI 等
 *
 * 配置项：
 *   devseek.openaiCompatBaseUrl  — API 根地址，如 http://localhost:11434/v1
 *   devseek.openaiCompatApiKey   — API Key（本地服务可留空）
 *   devseek.openaiCompatModel    — 模型名称，如 llama3、gpt-4o 等
 */
import * as https from 'https';
import * as http from 'http';
import * as vscode from 'vscode';
import { LLMProvider, LLMProviderType, LLMChatOptions, TokenUsage } from '../types';

export class OpenAICompatProvider implements LLMProvider {
  readonly type: LLMProviderType = 'openai-compat';
  readonly displayName = '$(extensions) OpenAI兼容';

  private cfg() {
    return vscode.workspace.getConfiguration('devseek');
  }

  private baseUrl(): string {
    return this.cfg().get<string>('openaiCompatBaseUrl', 'http://localhost:11434/v1').replace(/\/$/, '');
  }

  private apiKey(): string {
    return this.cfg().get<string>('openaiCompatApiKey', '').trim();
  }

  private model(): string {
    return this.cfg().get<string>('openaiCompatModel', 'llama3').trim();
  }

  async available(): Promise<boolean> {
    const base = this.baseUrl();
    return new Promise((resolve) => {
      try {
        const url = new URL(base + '/models');
        const mod = url.protocol === 'https:' ? https : http;
        const req = mod.request(
          { hostname: url.hostname, port: url.port || undefined, path: url.pathname, method: 'GET',
            headers: this.apiKey() ? { 'Authorization': `Bearer ${this.apiKey()}` } : {} },
          (res) => { resolve(res.statusCode !== undefined && res.statusCode < 500); },
        );
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
        req.on('error', () => resolve(false));
        req.end();
      } catch { resolve(false); }
    });
  }

  async chat(opts: LLMChatOptions): Promise<string> {
    const base = this.baseUrl();
    const url = new URL(base + '/chat/completions');
    // Only use SSE streaming when a delta callback is actually provided.
    const useStream = opts.stream !== false && !!opts.onDelta;

    const body = JSON.stringify({
      model: opts.model ?? this.model(),
      messages: opts.messages,
      stream: useStream,
    });
    const timeoutMs = opts.timeoutMs
      ?? this.cfg().get<number>('requestTimeoutMs', 120000);

    const headers: Record<string, string | number> = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (this.apiKey()) headers['Authorization'] = `Bearer ${this.apiKey()}`;

    if (useStream) {
      return this._stream(url, headers, body, opts.onDelta!, timeoutMs, opts.signal, opts.onUsage);
    }
    return this._simple(url, headers, body, timeoutMs, opts.signal, opts.onUsage);
  }

  private _simple(
    url: URL, headers: Record<string, string | number>,
    body: string, timeoutMs: number, signal?: AbortSignal,
    onUsage?: (u: TokenUsage) => void,
  ): Promise<string> {
    const mod = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('已取消')); return; }
      const req = mod.request(
        { hostname: url.hostname, port: url.port || undefined,
          path: url.pathname + url.search, method: 'POST', headers },
        (res) => {
          let data = '';
          res.on('data', (c: Buffer) => { data += c.toString(); });
          res.on('end', () => {
            try {
              const j = JSON.parse(data);
              if (j.error) { reject(new Error(`API Error: ${j.error.message ?? JSON.stringify(j.error)}`)); return; }
              if (onUsage && j.usage) {
                onUsage({ promptTokens: j.usage.prompt_tokens, completionTokens: j.usage.completion_tokens, totalTokens: j.usage.total_tokens });
              }
              resolve(j.choices?.[0]?.message?.content ?? '');
            } catch { reject(new Error(`响应解析失败: ${data.slice(0, 200)}`)); }
          });
        },
      );
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('请求超时')); });
      req.on('error', reject);
      signal?.addEventListener('abort', () => { req.destroy(); reject(new Error('已取消')); });
      req.write(body);
      req.end();
    });
  }

  private _stream(
    url: URL, headers: Record<string, string | number>,
    body: string, onDelta: (d: string) => void, timeoutMs: number, signal?: AbortSignal,
    onUsage?: (u: TokenUsage) => void,
  ): Promise<string> {
    const mod = url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('已取消')); return; }
      let full = '';
      let buf = '';
      const req = mod.request(
        { hostname: url.hostname, port: url.port || undefined,
          path: url.pathname + url.search, method: 'POST', headers },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let e = '';
            res.on('data', (c: Buffer) => { e += c.toString(); });
            res.on('end', () => { reject(new Error(`API ${res.statusCode}: ${e.slice(0, 200)}`)); });
            return;
          }
          res.on('data', (chunk: Buffer) => {
            buf += chunk.toString();
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith('data:')) continue;
              const j = t.slice(5).trim();
              if (j === '[DONE]') continue;
              try {
                const parsed = JSON.parse(j);
                if (onUsage && parsed.usage) {
                  onUsage({ promptTokens: parsed.usage.prompt_tokens, completionTokens: parsed.usage.completion_tokens, totalTokens: parsed.usage.total_tokens });
                }
                const d = parsed.choices?.[0]?.delta?.content;
                if (d) { onDelta(d); full += d; }
              } catch { /* skip */ }
            }
          });
          res.on('end', () => resolve(full));
          res.on('error', reject);
        },
      );
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('请求超时')); });
      req.on('error', reject);
      signal?.addEventListener('abort', () => { req.destroy(); reject(new Error('已取消')); });
      req.write(body);
      req.end();
    });
  }
}
