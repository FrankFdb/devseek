/**
 * P3-5: MCP 客户端 — JSON-RPC 2.0 over stdio
 *
 * 遵循 MCP 2024-11-05 协议规范：
 *   initialize → notifications/initialized → tools/list → tools/call
 *
 * 安全边界：
 * - 仅通过用户在 .devseek/mcp.json 中显式配置的命令启动子进程
 * - stdin 只写入有效 JSON-RPC 消息，不拼接外部输入
 * - stdout 按行解析，忽略格式错误行
 */

import * as cp from 'child_process';
import * as readline from 'readline';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * MCP stdio 客户端：对应一个外部 MCP server 进程。
 * 一个 McpStdioClient 对应一条 server 配置。
 */
export class McpStdioClient {
  readonly serverName: string;
  tools: McpTool[] = [];

  private readonly _proc: cp.ChildProcess;
  private _nextId = 1;
  private readonly _pending = new Map<number, PendingCall>();
  private _disposed = false;

  constructor(
    name: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
  ) {
    this.serverName = name;
    this._proc = cp.spawn(command, args, {
      // Merge caller-supplied env on top of current process env.
      // Never spread untrusted values — env values originate from user config.
      env: { ...process.env, ...(env ?? {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const rl = readline.createInterface({ input: this._proc.stdout! });
    rl.on('line', (line) => {
      try {
        this._onMessage(JSON.parse(line) as JsonRpcResponse);
      } catch {
        /* ignore non-JSON lines (e.g. server startup messages) */
      }
    });

    this._proc.on('error', (err) => {
      // Reject all in-flight calls so callers don't hang
      for (const [id, pending] of this._pending) {
        pending.reject(new Error(`MCP server '${name}' process error: ${err.message}`));
        this._pending.delete(id);
      }
    });
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _onMessage(msg: JsonRpcResponse): void {
    if (msg.id == null) return; // notification — ignore for now
    const pending = this._pending.get(msg.id);
    if (!pending) return;
    this._pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(`MCP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private _send<T>(method: string, params: unknown): Promise<T> {
    if (this._disposed) {
      return Promise.reject(new Error(`MCP client '${this.serverName}' is disposed`));
    }
    const id = this._nextId++;
    return new Promise<T>((resolve, reject) => {
      this._pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      try {
        this._proc.stdin!.write(msg + '\n');
      } catch (err) {
        this._pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private _notify(method: string): void {
    if (this._disposed) return;
    try {
      this._proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
    } catch { /* ignore if pipe already closed */ }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Run the MCP handshake and populate `this.tools`.
   * Must be called once before `callTool()`.
   */
  async initialize(): Promise<void> {
    await this._send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'DeepSeek NetAI', version: '0.2.0' },
    });
    this._notify('notifications/initialized');
    const result = await this._send<{ tools: McpTool[] }>('tools/list', {});
    this.tools = Array.isArray(result?.tools) ? result.tools : [];
  }

  /**
   * Invoke a tool and return its text output.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this._send<{
      content?: Array<{ type: string; text?: string }>;
    }>('tools/call', { name, arguments: args });
    return (result?.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    // Reject pending calls
    for (const [, pending] of this._pending) {
      pending.reject(new Error(`MCP client '${this.serverName}' disposed`));
    }
    this._pending.clear();
    try { this._proc.kill(); } catch { /* ignore */ }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// McpManager: reads .devseek/mcp.json, manages multiple server connections
// ─────────────────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpToolRef {
  serverName: string;
  tool: McpTool;
  /** Canonical name used in fake-tool-call syntax: mcp__serverName__toolName */
  fakeName: string;
}

export class McpManager {
  private _clients: McpStdioClient[] = [];
  private _toolRefs: McpToolRef[] = [];

  /**
   * Load config from `configPath` (.devseek/mcp.json) and connect to all servers.
   * Servers that fail to initialize are silently skipped so other servers still work.
   */
  async load(configPath: string): Promise<void> {
    let config: McpConfig;
    try {
      const fs = await import('fs');
      const raw = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(raw) as McpConfig;
    } catch {
      // Config missing or invalid — no MCP servers
      return;
    }

    if (!config.mcpServers || typeof config.mcpServers !== 'object') return;

    for (const [name, serverCfg] of Object.entries(config.mcpServers)) {
      if (!serverCfg.command) continue;
      const client = new McpStdioClient(
        name,
        serverCfg.command,
        serverCfg.args ?? [],
        serverCfg.env,
      );
      try {
        await client.initialize();
        this._clients.push(client);
        for (const tool of client.tools) {
          this._toolRefs.push({
            serverName: name,
            tool,
            fakeName: `mcp__${name}__${tool.name}`,
          });
        }
      } catch (err) {
        // Server failed — clean up and continue with others
        client.dispose();
      }
    }
  }

  /** All available MCP tools across all connected servers */
  get toolRefs(): McpToolRef[] { return this._toolRefs; }

  /** True when at least one server is connected with tools */
  get hasMcpTools(): boolean { return this._toolRefs.length > 0; }

  /**
   * Call a tool by its fake name (`mcp__serverName__toolName`).
   * Returns tool output string or throws if not found / server error.
   */
  async callTool(fakeName: string, args: Record<string, unknown>): Promise<string> {
    const ref = this._toolRefs.find((r) => r.fakeName === fakeName);
    if (!ref) throw new Error(`MCP tool not found: ${fakeName}`);
    const client = this._clients.find((c) => c.serverName === ref.serverName);
    if (!client) throw new Error(`MCP server not connected: ${ref.serverName}`);
    return client.callTool(ref.tool.name, args);
  }

  dispose(): void {
    for (const client of this._clients) {
      client.dispose();
    }
    this._clients = [];
    this._toolRefs = [];
  }
}
