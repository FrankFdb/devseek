import * as fs from 'fs';
import * as nodePath from 'path';
import { classifyFormattedTerminalExecutionEvidence } from '../execution-outcome-classifier';
import {
  classifyTerminalEvidenceCommand,
  type TerminalEvidence,
} from './completion-evidence';

function shellTokenizeSimple(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | '' = '';
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = '';
      } else if (char === '\\' && quote === '"' && index + 1 < command.length) {
        current += command[++index];
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function resolveCompilerOutputPath(command: string, workdir: string): string | undefined {
  const tokens = shellTokenizeSimple(command);
  const compilerIndex = tokens.findIndex(token => /^(?:g\+\+|gcc|clang\+\+|clang)(?:-\d+)?$/.test(nodePath.basename(token)));
  if (compilerIndex < 0) return undefined;
  const compilerArgs = tokens.slice(compilerIndex + 1);
  if (compilerArgs.some(token => token === '-c' || token === '-S' || token === '-E' || token === '-fsyntax-only')) return undefined;

  let output = '';
  for (let index = 0; index < compilerArgs.length; index++) {
    const token = compilerArgs[index];
    if (token === '-o' && compilerArgs[index + 1]) {
      output = compilerArgs[index + 1];
      break;
    }
    if (token.startsWith('-o') && token.length > 2) {
      output = token.slice(2);
      break;
    }
  }
  if (!output) output = 'a.out';
  if (!output || output.startsWith('-')) return undefined;
  return nodePath.isAbsolute(output) ? output : nodePath.resolve(workdir || process.cwd(), output);
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

export function analyzeTerminalEvidence(
  command: string,
  formattedOutput: string,
  workdir: string,
): { ran: boolean; evidence: TerminalEvidence } {
  const executionEvidence = classifyFormattedTerminalExecutionEvidence(formattedOutput);
  const kind = classifyTerminalEvidenceCommand(command);
  let ok = executionEvidence.ok;
  let detail = executionEvidence.detail;
  const outputPath = resolveCompilerOutputPath(command, workdir);
  if (ok && outputPath && !isExecutableFile(outputPath)) {
    ok = false;
    detail = `编译命令退出码为 0，但未找到可执行产物：${outputPath}`;
  }
  return {
    ran: executionEvidence.ran,
    evidence: {
      command,
      kind,
      ok,
      exitCode: executionEvidence.exitCode,
      ...(outputPath ? { outputPath } : {}),
      ...(detail ? { detail } : {}),
      ...(executionEvidence.reviewRequired ? { reviewRequired: true } : {}),
    },
  };
}
