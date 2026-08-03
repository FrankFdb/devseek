import cp from 'child_process';
import { mkdir, readFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { resolveCliWorkspacePath } from './cli-workspace-path';

export interface CliValidationResult {
  passed: boolean;
  evidenceRefs: string[];
  summary: string;
}

export class CliVerificationService {
  async verify(cwd: string, files: readonly string[], prompt: string): Promise<CliValidationResult> {
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
}

function inferExpectedStdout(prompt: string): string | undefined {
  const ordinalLines = extractOrdinalExpectedLines(prompt);
  if (ordinalLines.length > 0) return ordinalLines.join('\n');

  const singleLine = prompt.match(/\b(?:program\s+must\s+print|must\s+print|prints?|print)\s+exactly\s+one\s+line:\s*([^\r\n]+)/i)?.[1];
  if (singleLine) return cleanExpectedStdoutLine(singleLine);

  const outputBlock = extractExpectedStdoutBlock(prompt, /\b(?:outputs?|stdout)[^:\r\n]*:\s*(?:\r?\n|$)/i);
  if (outputBlock) return outputBlock;

  const checksBlock = extractExpectedStdoutBlock(prompt, /\bchecks?\s+(?:both\s+)?outputs?:\s*(?:\r?\n|$)/i);
  if (checksBlock) return checksBlock;

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
    if (index !== undefined && value) lines[index] = value;
  }
  return lines.filter(value => value !== undefined);
}

function cleanExpectedStdoutLine(line: string): string {
  let value = line.trim().replace(/^[-*]\s*/, '');
  value = value.replace(/\.\s+(?=(?:add|preserve|return|do not|the|new|create|update|use|if)\b).*/i, '');
  value = value.replace(/^["'`]|["'`]$/g, '');
  if (/^[A-Za-z0-9_:-]+\.$/.test(value)) value = value.slice(0, -1);
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

async function runDevseekVerifier(cwd: string): Promise<CliValidationResult | undefined> {
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
  if (Array.isArray(config.commands) && config.commands.length > 0) return config.commands;
  if (!Array.isArray(config.tests)) return [];
  return config.tests.flatMap((test): DevseekVerifierCommand[] => {
    if (typeof test.command !== 'string' || test.command.trim() === '') return [];
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
      if (char === quote) quote = undefined;
      else current += char;
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
  if (current) parts.push(current);
  return parts;
}

interface NormalizedVerifierCommand {
  command: string;
  args: string[];
  stdin: string;
  expectStdoutIncludes: string[];
  display: string;
}

function normalizeVerifierCommand(
  cwd: string,
  step: DevseekVerifierCommand,
  index: number,
): NormalizedVerifierCommand {
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
      if (typeof value !== 'string') {
        throw new Error(`devseek.verify.json command ${index} expectStdoutIncludes must be strings.`);
      }
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
  if (cmd.includes('/') || cmd.includes('\\')) return resolveCliWorkspacePath(cwd, cmd);
  if (['g++', 'node', 'npm', 'python', 'python3'].includes(cmd)) return cmd;
  throw new Error(`devseek.verify.json command is not allowed: ${cmd}`);
}

async function ensureVerifierOutputDirectory(cwd: string, args: readonly string[]): Promise<void> {
  const outputFlagIndex = args.indexOf('-o');
  const outputPath = outputFlagIndex >= 0 ? args[outputFlagIndex + 1] : undefined;
  if (!outputPath || outputPath.startsWith('-')) return;
  const target = resolveCliWorkspacePath(cwd, outputPath);
  await mkdir(dirname(target), { recursive: true });
}

function summarizeProcessText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function runProjectVerifier(cwd: string, files: readonly string[]): Promise<CliValidationResult | undefined> {
  const packageJsonPath = resolve(cwd, 'package.json');
  let packageJson: { scripts?: { test?: unknown } };
  try {
    packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { scripts?: { test?: unknown } };
  } catch {
    return undefined;
  }
  if (typeof packageJson.scripts?.test !== 'string' || packageJson.scripts.test.trim() === '') return undefined;
  if (!files.some(file => /\.(js|mjs|cjs|ts|tsx|jsx|json)$/i.test(file))) return undefined;

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
