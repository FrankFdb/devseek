import * as cp from 'child_process';
import * as fs from 'fs';
import * as nodePath from 'path';
import {
  getCppAutoExecutablePath,
  getDevSeekBuildDir,
} from './cpp-build-layout';

export interface LocalExecutionDecision {
  handled: boolean;
  compileOnly: boolean;
  command: string;
  cwd: string;
  outputPath?: string;
  relatedFiles: string[];
  reason: string;
}

export interface LocalExecutionResult {
  ok: boolean;
  command: string;
  cwd: string;
  exitCode: number | null;
  output: string;
  relatedFiles: string[];
}

const COMPILE_INTENT_RE = /(编译|compile|构建|build|g\+\+|gcc|clang\+\+)/i;
const RUN_INTENT_RE = /(运行|执行|run|execute|启动|测试|test|看结果|输出效果|运行效果)/i;
const CPP_RE = /\.(cpp|cc|cxx|c)$/i;
const CPP_COMPILE_TIMEOUT_MS = 15_000;
const CPP_RUN_TIMEOUT_MS = 30_000;

export function decideLocalExecution(prompt: string, files: string[] | undefined): LocalExecutionDecision | null {
  const attached = (files || []).filter(Boolean);
  if (attached.length === 0) return null;

  const text = (prompt || '').trim();
  const wantsCompile = COMPILE_INTENT_RE.test(text);
  const wantsRun = RUN_INTENT_RE.test(text);
  if (!wantsCompile && !wantsRun) return null;

  const cppFiles = attached.filter((f) => CPP_RE.test(f) && fs.existsSync(f));
  if (cppFiles.length === 0) return null;

  const dirCount = new Map<string, number>();
  for (const abs of cppFiles) {
    const dir = nodePath.dirname(abs);
    dirCount.set(dir, (dirCount.get(dir) || 0) + 1);
  }
  const targetDir = [...dirCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!targetDir) return null;

  const dirCppFiles = cppFiles.filter((f) => nodePath.dirname(f) === targetDir);
  const outPath = getCppAutoExecutablePath(targetDir);
  const outDir = getDevSeekBuildDir(targetDir);
  const compileCmd = `mkdir -p ${q(outDir)} && g++ -std=c++17 ${dirCppFiles.map(q).join(' ')} -o ${q(outPath)}`;
  const compileOnly = !wantsRun;

  return {
    handled: true,
    compileOnly,
    command: compileOnly ? compileCmd : `${compileCmd} && ${q(outPath)}`,
    cwd: targetDir,
    outputPath: outPath,
    relatedFiles: dirCppFiles,
    reason: compileOnly ? 'local-cpp-compile-request' : 'local-cpp-compile-run-request',
  };
}

export async function runLocalExecution(decision: LocalExecutionDecision): Promise<LocalExecutionResult> {
  return new Promise((resolve) => {
    const timeoutMs = decision.compileOnly ? CPP_COMPILE_TIMEOUT_MS : CPP_RUN_TIMEOUT_MS;
    cp.exec(decision.command, { cwd: decision.cwd, timeout: timeoutMs, encoding: 'utf8' }, (error: cp.ExecException | null, stdout: string, stderr: string) => {
      const output = `${stdout || ''}\n${stderr || ''}`.trim();
      const timedOut = !!error && (error.killed || /timed out|timeout/i.test(error.message || ''));
      const exitCode = !error ? 0 : timedOut ? 124 : (typeof error.code === 'number' ? error.code : null);
      resolve({
        ok: !error,
        command: decision.command,
        cwd: decision.cwd,
        exitCode,
        output: timedOut
          ? [output, `[DevSeek] 命令超时，已终止（timeout ${timeoutMs}ms）。这通常表示程序仍在运行、等待输入或构建卡住；自动验证按失败处理。`].filter(Boolean).join('\n')
          : output,
        relatedFiles: decision.relatedFiles,
      });
    });
  });
}

function q(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}
