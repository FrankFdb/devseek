import * as nodePath from 'path';
import { parseGeneratedArtifacts } from '../generated-file-parser';
import { resolveGeneratedArtifactPathForPrompt, resolveWorkspaceWritePath } from '../workspace/path-resolver';
import { WorkspaceEditService } from '../workspace/edit-service';
import { decideProjectInstructionFileWrite } from '../workspace/instruction-file-safety';
import type { WrittenFileEvidence } from './completion-evidence';
import type { AgentLoopCallbacks } from './loop-types';
import {
  detectNestedFilePayloadDrift,
  shouldBlockUnverifiedSourceOverwrite,
} from './write-guard';

const workspaceEditService = new WorkspaceEditService();

function promptLooksLikeCppProgram(userPrompt: string): boolean {
  return /(?:c\+\+|cpp|\.cpp\b|\.cc\b|\.cxx\b|C\+\+)/i.test(userPrompt);
}

function promptLooksLikeCProgram(userPrompt: string): boolean {
  return /(?:\bC\b|C语言|c程序|\.c\b)/i.test(userPrompt) && !promptLooksLikeCppProgram(userPrompt);
}

function contentLooksLikeCppProgram(content: string): boolean {
  return /#include\s*<(?:iostream|vector|string|map|memory|algorithm|GL\/glut|GLFW|SFML)|\bstd::|using\s+namespace\s+std|class\s+\w+/i.test(content);
}

function defaultCodeArtifactBasename(userPrompt: string): string {
  return /(?:三维|3d|3D|OpenGL|GLUT|动画世界)/i.test(userPrompt) ? '3d_world' : 'main';
}

function inferCArtifactFromMarkdown(text: string, userPrompt: string): Array<{path: string; content: string}> {
  const wantsCpp = promptLooksLikeCppProgram(userPrompt);
  const wantsC = !wantsCpp && promptLooksLikeCProgram(userPrompt);
  if (!wantsCpp && !wantsC) return [];
  const blockRe = /```(?:c|cpp|cxx|cc|c\+\+)\s*\n([\s\S]*?)```/gi;
  const results: Array<{path: string; content: string}> = [];
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    const content = (match[1] || '').trim();
    if (!/#include\s*</.test(content) || !/\bmain\s*\(/.test(content)) continue;
    if (wantsCpp && !contentLooksLikeCppProgram(content) && !/(?:c\+\+|cpp|cxx|cc)/i.test(match[0].slice(0, 24))) continue;
    const before = text.slice(Math.max(0, match.index - 400), match.index);
    const pathMatch = before.match(/([A-Za-z0-9_./-]+\.(?:c|cc|cpp|cxx))\b/g);
    const ext = wantsCpp ? '.cpp' : '.c';
    const path = pathMatch?.[pathMatch.length - 1] || `code/${defaultCodeArtifactBasename(userPrompt)}${ext}`;
    results.push({ path: resolveGeneratedArtifactPathForPrompt(path, userPrompt), content });
  }
  return results;
}

function isLikelyWritableFilePath(filePath: string): boolean {
  const normalized = (filePath || '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.endsWith('/')) return false;
  const base = nodePath.posix.basename(normalized);
  return ['Makefile', 'Dockerfile', 'CMakeLists.txt'].includes(base) || /\.[A-Za-z0-9]+$/.test(base);
}

export async function applyMarkdownFileArtifactsForLoop(
  text: string,
  userPrompt: string,
  workspaceRoot: string,
  callbacks: AgentLoopCallbacks,
  writeGuard?: {
    requireReadBeforeOverwrite?: boolean;
    readEvidencePaths?: Iterable<string>;
  },
): Promise<{ feedbackForAI: string; writtenFiles: WrittenFileEvidence[] }> {
  const parsed = parseGeneratedArtifacts(text)
    .filter((artifact): artifact is Extract<ReturnType<typeof parseGeneratedArtifacts>[number], { type: 'file' }> => artifact.type === 'file')
    .map(artifact => ({ path: artifact.path, content: artifact.content }));
  const inferred = parsed.length > 0 ? [] : inferCArtifactFromMarkdown(text, userPrompt);
  const candidates = parsed.length > 0 ? parsed : inferred;
  const feedback: string[] = [];
  const writtenFiles: WrittenFileEvidence[] = [];
  const seen = new Set<string>();

  for (const artifact of candidates) {
    if (!artifact.path || !artifact.content.trim()) continue;
    const resolvedWrite = resolveWorkspaceWritePath(artifact.path, {
      requestPrompt: userPrompt,
      content: artifact.content,
      workspaceRootFsPath: workspaceRoot,
      defaultWorkdir: workspaceRoot,
    });
    if (!resolvedWrite) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（无法解析为工作区内路径）`);
      continue;
    }
    if (!isLikelyWritableFilePath(resolvedWrite.relPath)) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（目标是目录或缺少文件名）`);
      continue;
    }
    const instructionDecision = decideProjectInstructionFileWrite({
      filePath: resolvedWrite.relPath,
      content: artifact.content,
      requestPrompt: userPrompt,
    });
    if (!instructionDecision.allowed) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（${instructionDecision.reason ?? '项目指令文件写入未被允许'}）`);
      continue;
    }
    const resolvedAbs = resolvedWrite.absPath;
    const payloadDrift = detectNestedFilePayloadDrift({
      targetAbsPath: resolvedAbs,
      content: artifact.content,
      workspaceRoot,
      defaultWorkdir: workspaceRoot,
    });
    if (payloadDrift.block) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过：${payloadDrift.reason}`);
      continue;
    }
    if (seen.has(resolvedAbs)) continue;
    seen.add(resolvedAbs);
    let baseline;
    try {
      baseline = workspaceEditService.captureTextFileBaseline(resolvedAbs, workspaceRoot);
    } catch (error) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（工作区写入边界）：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const existed = baseline.snapshot.existed;
    if (writeGuard?.requireReadBeforeOverwrite) {
      const guard = shouldBlockUnverifiedSourceOverwrite({
        absPath: resolvedAbs,
        existed,
        readEvidencePaths: writeGuard.readEvidencePaths,
      });
      if (guard.block) {
        feedback.push(`[generated_file: ${artifact.path}] 跳过：${guard.reason}`);
        continue;
      }
    }
    if (callbacks.onBeforeFileWrite) {
      const allowed = await callbacks.onBeforeFileWrite(resolvedAbs, {
        purpose: 'tool-write',
        userRequested: false,
        displayName: resolvedWrite.relPath,
        requestPrompt: userPrompt,
      });
      if (!allowed) {
        feedback.push(`[generated_file: ${artifact.path}] 跳过（写入权限策略阻止）`);
        continue;
      }
    }
    callbacks.onToolActivity?.('write', resolvedWrite.relPath);
    let writeResult;
    try {
      writeResult = workspaceEditService.commitTextFileProposal(
        workspaceEditService.proposeTextFileWrite(resolvedAbs, artifact.content),
        baseline,
        {
          validateSourceSanity: true,
          repairSourceTransportEscapes: true,
        },
      ).result;
    } catch (error) {
      feedback.push(`[generated_file: ${artifact.path}] 跳过（源码语法护栏）：${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (writeResult.normalization) {
      feedback.push(
        `[generated_file: ${artifact.path}] 诊断: 已修复 ${writeResult.normalization.repairCount} 处源码工具协议转义污染。`,
      );
    }
    if (writeResult.existed && writeResult.oldContent === writeResult.newContent) {
      feedback.push(`[generated_file: ${artifact.path}] 未发生内容变化，未计入本轮修改证据：${resolvedWrite.relPath}`);
      continue;
    }
    await callbacks.onAppliedChange({ path: resolvedAbs, ...writeResult });
    const newLines = writeResult.newContent.split('\n').length;
    const oldLines = writeResult.oldContent ? writeResult.oldContent.split('\n').length : 0;
    writtenFiles.push({
      path: resolvedAbs,
      basename: nodePath.basename(resolvedAbs),
      linesAdded: newLines,
      linesRemoved: oldLines,
      action: writeResult.existed ? 'modify' : 'create',
    });
    feedback.push(`[generated_file: ${artifact.path}] 已写入 ${resolvedWrite.relPath} (${newLines} 行)`);
  }

  return { feedbackForAI: feedback.join('\n'), writtenFiles };
}
