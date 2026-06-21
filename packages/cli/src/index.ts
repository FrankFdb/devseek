import { readFile, writeFile, mkdir } from 'fs/promises';
import { createInterface } from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { join, resolve } from 'path';
import {
  AgentApplicationService,
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
  const service = new AgentApplicationService({
    getProviderType: () => options.mock ? 'local-api' : 'bridge',
    getProvider: () => createMockProvider(),
    bridgeChat: (request) => callBridgeChat(options.cwd, request),
    getChatHistory: () => [],
    recordChatHistory: () => {},
    emitEvent: (event) => surface.renderEvent(event),
  });

  const command = surface.toChatCommand({
    prompt,
    request: {
      stream: !options.jsonl,
      trackHistory: true,
    },
  });

  try {
    await service.handle(command);
    await appendHistory(options.cwd, prompt);
    return 0;
  } catch {
    return 1;
  }
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
