import * as fs from 'fs';
import * as nodePath from 'path';
import type { AgentStatusEvent } from './events';
import {
  classifyTerminalEvidenceCommand,
  type TerminalEvidence,
  type TerminalEvidenceKind,
  type WrittenFileEvidence,
} from './completion-evidence';
import { assessFormalProjectDocumentQuality } from './formal-project-document-quality';
import { assessFormalProjectSourceQuality } from './formal-project-source-quality';
import { isInsideWorkspacePath } from './write-guard';
import {
  ValidationService,
  type AutoValidationResult,
  type ValidationCommandRunner,
} from '../workspace/validation-service';
import type { CppValidationPolicy } from '../validation-planner';
import {
  buildValidationFailureDiagnosis,
  type FailureDiagnosis,
} from '../app/failure-diagnosis';

export interface AgentAutoValidationCallbacks {
  onAgentStatus: (status: AgentStatusEvent) => void | Promise<void>;
  onToolActivity?: (kind: 'terminal', label: string) => void;
  /** Evidence-aware authority for every automatic validation process. */
  onValidationCommand: ValidationCommandRunner;
  signal?: AbortSignal;
}

export interface AgentAutoValidationResult {
  evidence?: TerminalEvidence;
  feedbackForAI?: string;
  repairBlockedReason?: string;
  qualityGate?: {
    status: 'pass' | 'fail' | 'blocked';
    summary: string;
    risks?: string[];
    evidenceRefs?: string[];
    failureDiagnosis?: FailureDiagnosis;
    alternativeChecks?: string[];
    requiredActions?: string[];
  };
}

export interface AgentAutoValidationOptions {
  validationService?: Pick<ValidationService, 'validateWorkspaceChanges'>;
  qualityWrittenFiles?: WrittenFileEvidence[];
}

let autoValidationOperationSequence = 0;

function nextAutoValidationOperationId(changedPaths: readonly string[]): string {
  autoValidationOperationSequence += 1;
  const scope = changedPaths.join('|').replace(/[^0-9A-Za-z._/-]+/g, '-').slice(0, 160) || 'workspace';
  return `auto-validation-${autoValidationOperationSequence}-${scope}`.slice(0, 512);
}

function qualityGateStatusToAgentState(
  status: NonNullable<AgentAutoValidationResult['qualityGate']>['status'],
): AgentStatusEvent['state'] {
  if (status === 'pass') return 'completed';
  if (status === 'blocked') return 'skipped';
  return 'failed';
}

async function emitAutoValidationQualityGateStatus(
  callbacks: AgentAutoValidationCallbacks,
  evidenceOperationId: string,
  qualityGate: NonNullable<AgentAutoValidationResult['qualityGate']>,
): Promise<void> {
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'quality',
    state: 'started',
    evidenceOperationId,
    title: '评估自动验证 QualityGate',
    detail: qualityGate.summary,
  });
  await callbacks.onAgentStatus({
    type: 'agentStatus',
    phase: 'quality',
    state: qualityGateStatusToAgentState(qualityGate.status),
    evidenceOperationId,
    title: qualityGate.status === 'pass'
      ? '自动验证 QualityGate 通过'
      : qualityGate.status === 'blocked'
        ? '自动验证 QualityGate 阻塞'
        : '自动验证 QualityGate 未通过',
    detail: qualityGate.summary,
  });
}

function workspaceRelativeValidationPaths(writtenFiles: WrittenFileEvidence[], workspaceRootFsPath: string): string[] {
  if (!workspaceRootFsPath) return [];
  const root = nodePath.resolve(workspaceRootFsPath);
  const seen = new Set<string>();
  const relPaths: string[] = [];
  for (const file of writtenFiles) {
    const absPath = nodePath.resolve(nodePath.isAbsolute(file.path) ? file.path : nodePath.join(root, file.path));
    if (!isInsideWorkspacePath(absPath, root)) continue;
    const relPath = nodePath.relative(root, absPath).replace(/\\/g, '/');
    if (!relPath || seen.has(relPath)) continue;
    seen.add(relPath);
    relPaths.push(relPath);
  }
  return relPaths;
}

export function validationResultToTerminalEvidence(result: AutoValidationResult): TerminalEvidence {
  const classified = classifyTerminalEvidenceCommand(result.command);
  const kind: TerminalEvidenceKind = result.mode === 'compile-run'
    ? 'compile-run'
    : result.mode === 'file-check'
      ? 'other'
    : classified !== 'other'
      ? classified
      : result.mode
        ? 'compile'
        : 'other';
  const detail = [result.reason, result.output].filter(Boolean).join('\n').slice(0, 1200);
  return {
    command: result.command,
    kind,
    ok: result.ok,
    exitCode: result.exitCode,
    ...(detail ? { detail } : {}),
  };
}

function formatAutoValidationFeedback(result: AutoValidationResult): string {
  return [
    `[auto_validation: ${result.command}]`,
    `cwd=${result.cwd}`,
    `exitCode=${result.exitCode ?? 'unknown'}`,
    result.reason ? `reason=${result.reason}` : '',
    result.output ? result.output.slice(0, 4000) : '',
    result.risks?.length ? `risks:\n${result.risks.map((risk) => `- ${risk}`).join('\n')}` : '',
    result.alternativeChecks?.length ? `alternativeChecks:\n${result.alternativeChecks.map((check) => `- ${check}`).join('\n')}` : '',
    result.ok ? '' : '自动验证命令未通过，不能把编译/运行/测试标记为完成。',
  ].filter(Boolean).join('\n');
}

function formatBlockedAutoValidationFeedback(result: AutoValidationResult): string {
  return [
    '[auto_validation: blocked]',
    `reason=${result.reason ?? 'no-auto-validation-target'}`,
    result.output ? result.output.slice(0, 1600) : '',
    result.risks?.length ? `risks:\n${result.risks.map((risk) => `- ${risk}`).join('\n')}` : '',
    result.alternativeChecks?.length ? `alternativeChecks:\n${result.alternativeChecks.map((check) => `- ${check}`).join('\n')}` : '',
    'QualityGate 阻塞：没有可自动运行的验证目标，不能把结果标记为已验证通过；不要发明 build/test 脚本或用失败命令反复修复。',
  ].filter(Boolean).join('\n');
}

const FORMAL_PROJECT_DOC_REASON_LABELS: Record<string, string> = {
  'unresolved-project-facts': '未落定的项目事实（待确认/待分配/建议范围等）',
  'missing-source-fact-matrix': '源项目事实矩阵',
  'missing-concrete-protocol-facts': '协议/通讯数值事实',
  'missing-remote-controller-interface-doc': '遥控器/主控接口 schema、request/response 示例',
  'missing-existing-code-modification-plan': '原有代码修改清单（文件、函数/类、风险、验证方式）',
  'missing-project-wide-communication-chain': '项目级通讯链路证据（uart*_tx/rx_main、TunnelTransport/分片、MAVLink/topic）',
};

const FORMAL_PROJECT_SOURCE_REASON_LABELS: Record<string, string> = {
  'standalone-sample-code': '正式项目中禁止新建孤岛 main/样例入口',
  'unresolved-project-facts': '源码中仍有待确认/待分配/建议范围等未落定事实',
  'missing-validation-hook': '缺少验证钩子/自测入口',
  'invalid-validation-script': '验证脚本语法或变量引用明显损坏',
  'validation-references-missing-artifact': '验证脚本仍引用已删除或缺失的本轮产物',
};

function readWrittenMarkdownFilesForQuality(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
): { paths: string[]; content: string } {
  const root = nodePath.resolve(workspaceRootFsPath);
  const seen = new Set<string>();
  const paths: string[] = [];
  const parts: string[] = [];
  for (const file of writtenFiles) {
    if (!/\.md$/i.test(file.path) && !/\.md$/i.test(file.basename)) continue;
    const absPath = nodePath.resolve(nodePath.isAbsolute(file.path) ? file.path : nodePath.join(root, file.path));
    if (!isInsideWorkspacePath(absPath, root)) continue;
    try {
      if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) continue;
      const content = fs.readFileSync(absPath, 'utf8');
      const relPath = nodePath.relative(root, absPath).replace(/\\/g, '/');
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      paths.push(relPath);
      parts.push(content);
    } catch {
      // Ignore transient read failures here; the normal file-check validation
      // still records the lower-level write/read problem.
    }
  }
  return { paths, content: parts.join('\n\n') };
}

function readWrittenSourceFilesForQuality(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
): { files: Array<{ path: string; content: string; action?: string; exists?: boolean }> } {
  const root = nodePath.resolve(workspaceRootFsPath);
  const seen = new Set<string>();
  const files: Array<{ path: string; content: string; action?: string; exists?: boolean }> = [];
  for (const file of writtenFiles) {
    if (!/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|sh|bash|py)$/i.test(file.path) && !/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|sh|bash|py)$/i.test(file.basename)) continue;
    const absPath = nodePath.resolve(nodePath.isAbsolute(file.path) ? file.path : nodePath.join(root, file.path));
    if (!isInsideWorkspacePath(absPath, root)) continue;
    const relPath = nodePath.relative(root, absPath).replace(/\\/g, '/');
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    try {
      if (!fs.existsSync(absPath)) {
        files.push({ path: relPath, content: '', action: file.action, exists: false });
        continue;
      }
      if (fs.statSync(absPath).isDirectory()) continue;
      files.push({
        path: relPath,
        content: fs.readFileSync(absPath, 'utf8'),
        action: file.action,
        exists: true,
      });
    } catch {
      // Ignore transient reads; normal validation still records lower-level failures.
    }
  }
  return { files };
}

function evaluateFormalProjectMarkdownQuality(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
  userPrompt: string,
): AgentAutoValidationResult | undefined {
  const baseline = assessFormalProjectDocumentQuality('', userPrompt);
  if (!baseline.required) return undefined;

  const markdown = readWrittenMarkdownFilesForQuality(writtenFiles, workspaceRootFsPath);
  if (markdown.paths.length === 0) return undefined;
  const quality = assessFormalProjectDocumentQuality(markdown.content, userPrompt);
  if (!quality.required || quality.ok) return undefined;

  const missing = quality.reasons.map(reason => FORMAL_PROJECT_DOC_REASON_LABELS[reason] ?? reason);
  const summary = `正式项目 Markdown 质量门禁未通过：缺少${missing.join('、')}。`;
  const feedbackForAI = [
    '[formal_project_markdown_quality]',
    `files=${markdown.paths.join(', ')}`,
    summary,
    '请继续调用 read_file/grep_search 精确补证据，并用 create_file/write_file/replace_in_file 修正文档；需要把源项目事实矩阵、项目级通讯链路、接口 request/response schema 示例和原有代码修改清单落实到交付物中。',
    '协议/通讯事实必须来自源码或接口文档中的具体常量、topic、payload_type、命令号、字段名、超时/分片/重试数值；不要用 100、128 字节这类未从项目证据中证明的默认值。',
    'JSON 示例必须使用标准 Markdown 三反引号代码块，例如 ```json。',
    '完成摘要只能引用修正后的真实文件内容，不能把不合格草稿标记完成。',
  ].filter(Boolean).join('\n');
  return {
    feedbackForAI,
    qualityGate: {
      status: 'fail',
      summary,
      risks: missing.map(item => `缺少${item}`),
      evidenceRefs: markdown.paths.map(path => `file:${path}`),
      requiredActions: [
        '补齐源项目事实矩阵、通讯链路、接口示例和原有代码修改清单后重新验证。',
      ],
    },
  };
}

function evaluateFormalProjectSourceQuality(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
  userPrompt: string,
): AgentAutoValidationResult | undefined {
  const baseline = assessFormalProjectDocumentQuality('', userPrompt);
  if (!baseline.required) return undefined;

  const source = readWrittenSourceFilesForQuality(writtenFiles, workspaceRootFsPath);
  if (source.files.length === 0) return undefined;
  const quality = assessFormalProjectSourceQuality(source.files, userPrompt);
  if (!quality.required || quality.ok) return undefined;

  const missing = quality.reasons.map(reason => FORMAL_PROJECT_SOURCE_REASON_LABELS[reason] ?? reason);
  const summary = `正式项目源码质量门禁未通过：${missing.join('、')}。`;
  const feedbackForAI = [
    '[formal_project_source_quality]',
    `files=${source.files.map(file => file.path).join(', ')}`,
    summary,
    'A 类正式项目代码必须嵌入既有主流程/模块边界；除非用户明确要求新增独立可执行程序，不要新建 proc_*_main.cpp、main() 或只为自洽存在的样例入口。',
    '如果用户要求自闭环验证，必须补齐验证钩子：例如 *_validation.*、verify_*.sh、static_assert/assert 或明确的 validate/self_test 入口，并说明它如何覆盖接口、协议和集成边界。',
    '验证脚本本身必须先可执行：Shell 脚本要通过 bash -n，并保留正确的 $变量、${数组} 和 $(命令替换)；不要把坏脚本的重复运行结果标记为验证通过。',
    '验证脚本引用的本轮源码/测试产物必须仍然存在；删除或改名文件时要在同一轮同步更新验证脚本，并重新执行完整验证。',
    '请改为读取既有入口、调度、通讯和构建锚点，输出需要修改的原有文件/函数/类，并把新增代码设计为可被既有主流程接入的模块。',
  ].join('\n');
  return {
    feedbackForAI,
    qualityGate: {
      status: 'fail',
      summary,
      risks: missing.map(item => item),
      evidenceRefs: (quality.offendingPaths.length ? quality.offendingPaths : source.files.map(file => file.path))
        .map(path => `file:${path}`),
      requiredActions: [
        '删除或改造孤岛入口/样例代码，补齐既有工程集成锚点和验证钩子后重新验证。',
      ],
    },
  };
}

function combineFormalProjectQualityResults(
  results: Array<AgentAutoValidationResult | undefined>,
): AgentAutoValidationResult | undefined {
  const present = results.filter((result): result is AgentAutoValidationResult => !!result);
  if (present.length === 0) return undefined;
  const gates = present.map(result => result.qualityGate).filter((gate): gate is NonNullable<AgentAutoValidationResult['qualityGate']> => !!gate);
  const status = gates.some(gate => gate.status === 'fail')
    ? 'fail'
    : gates.some(gate => gate.status === 'blocked')
      ? 'blocked'
      : 'pass';
  return {
    feedbackForAI: present.map(result => result.feedbackForAI).filter(Boolean).join('\n\n'),
    qualityGate: gates.length > 0
      ? {
        status,
        summary: gates.map(gate => gate.summary).filter(Boolean).join('；'),
        risks: gates.flatMap(gate => gate.risks ?? []),
        evidenceRefs: gates.flatMap(gate => gate.evidenceRefs ?? []),
        ...(selectStickyFailureDiagnosis(gates) ? { failureDiagnosis: selectStickyFailureDiagnosis(gates) } : {}),
        alternativeChecks: gates.flatMap(gate => gate.alternativeChecks ?? []),
        requiredActions: gates.flatMap(gate => gate.requiredActions ?? []),
      }
      : undefined,
  };
}

function isExplicitContentWriteRequest(prompt: string): boolean {
  return /(?:内容为|内容是|写入内容|文件内容|content\s*(?:is|:|=)|with\s+content)/i.test(prompt || '');
}

function buildExactContentRepairBlockedReason(result: AutoValidationResult): string {
  return [
    '用户指定了精确文件内容，自动验证未通过；DevSeek 已保留用户指定内容，不能擅自改写为通过验证的其他内容。',
    `验证原因: ${result.reason ?? 'validation-failed'}`,
    result.command ? `验证命令: ${result.command}` : '',
    result.exitCode !== undefined ? `exitCode: ${result.exitCode ?? 'null'}` : '',
  ].filter(Boolean).join('\n');
}

function validationEvidenceRef(status: 'passed' | 'failed' | 'blocked', result: AutoValidationResult): string {
  return `validation:${status}:${result.command || result.reason || 'unknown'}`;
}

function selectStickyFailureDiagnosis(
  gates: Array<NonNullable<AgentAutoValidationResult['qualityGate']>>,
): FailureDiagnosis | undefined {
  return gates.find(gate => gate.status !== 'pass' && gate.failureDiagnosis)?.failureDiagnosis;
}

function buildAutoValidationQualityGate(
  result: AutoValidationResult,
  changedPaths: string[] = [],
): NonNullable<AgentAutoValidationResult['qualityGate']> {
  if (result.status === 'blocked' || result.ran === false) {
    const evidenceRef = validationEvidenceRef('blocked', result);
    return {
      status: 'blocked',
      summary: `QualityGate 阻塞：${result.reason || 'validation-blocked'}。`,
      evidenceRefs: [evidenceRef],
      failureDiagnosis: buildValidationFailureDiagnosis({
        status: 'blocked',
        changedPaths,
        command: result.command,
        exitCode: result.exitCode,
        output: result.output,
        reason: result.reason || 'validation-blocked',
        mode: result.mode,
        evidenceRef,
      }),
      risks: result.risks?.length
        ? result.risks
        : ['没有自动验证证据，不能证明变更后的行为正确。'],
      alternativeChecks: result.alternativeChecks?.length
        ? result.alternativeChecks
        : ['人工检查变更文件内容是否符合用户请求。'],
      requiredActions: ['补充可运行验证，或由用户明确接受剩余风险。'],
    };
  }

  if (result.ok) {
    return {
      status: 'pass',
      summary: `QualityGate 通过：${result.command || '自动验证'} 已通过。`,
      evidenceRefs: [validationEvidenceRef('passed', result)],
      risks: result.risks ?? [],
      alternativeChecks: result.alternativeChecks ?? [],
    };
  }

  const evidenceRef = validationEvidenceRef('failed', result);
  return {
    status: 'fail',
    summary: `QualityGate 未通过：自动验证失败（exitCode=${result.exitCode ?? 'null'}）。`,
    evidenceRefs: [evidenceRef],
    failureDiagnosis: buildValidationFailureDiagnosis({
      status: 'failed',
      changedPaths,
      command: result.command,
      exitCode: result.exitCode,
      output: result.output,
      reason: result.reason,
      mode: result.mode,
      evidenceRef,
    }),
    risks: [
      ...(result.risks || []),
      '自动验证命令失败，不能把任务标记为完成。',
    ],
    alternativeChecks: result.alternativeChecks || [],
    requiredActions: ['修复自动验证失败后重新运行 QualityGate。'],
  };
}

export async function runAgentAutoValidationForWrites(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
  userPrompt: string,
  callbacks: AgentAutoValidationCallbacks,
  cppValidationPolicy: CppValidationPolicy,
  options: AgentAutoValidationOptions = {},
): Promise<AgentAutoValidationResult> {
  const changedPaths = workspaceRelativeValidationPaths(writtenFiles, workspaceRootFsPath);
  if (changedPaths.length === 0 || callbacks.signal?.aborted) return {};
  const evidenceOperationId = nextAutoValidationOperationId(changedPaths);

  const validationService = options.validationService ?? new ValidationService({
    commandRunner: callbacks.onValidationCommand,
  });
  try {
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'started',
      evidenceOperationId,
      title: '自动验证写入结果',
      detail: changedPaths.join('\n'),
    });
    const qualityWrittenFiles = options.qualityWrittenFiles ?? writtenFiles;
    const result = await validationService.validateWorkspaceChanges({
      rootFsPath: workspaceRootFsPath,
      changedPaths,
      requestPrompt: userPrompt,
      cppValidationPolicy,
    });
    const formalProjectQuality = combineFormalProjectQualityResults([
      evaluateFormalProjectMarkdownQuality(
        qualityWrittenFiles,
        workspaceRootFsPath,
        userPrompt,
      ),
      evaluateFormalProjectSourceQuality(
        qualityWrittenFiles,
        workspaceRootFsPath,
        userPrompt,
      ),
    ]);
    if (!result) {
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: formalProjectQuality ? 'failed' : 'skipped',
        evidenceOperationId,
        title: formalProjectQuality ? '正式项目质量门禁未通过' : '未识别到自动验证目标',
        detail: [changedPaths.join('\n'), formalProjectQuality?.feedbackForAI].filter(Boolean).join('\n\n').slice(0, 1200),
      });
      if (formalProjectQuality?.qualityGate) {
        await emitAutoValidationQualityGateStatus(callbacks, evidenceOperationId, formalProjectQuality.qualityGate);
      }
      return formalProjectQuality ?? {};
    }
    if (result.status === 'blocked' || result.ran === false) {
      const feedbackForAI = formatBlockedAutoValidationFeedback(result);
      const qualityGate = formalProjectQuality?.qualityGate ?? buildAutoValidationQualityGate(result, changedPaths);
      await callbacks.onAgentStatus({
        type: 'agentStatus',
        phase: 'validate',
        state: formalProjectQuality ? 'failed' : 'skipped',
        evidenceOperationId,
        title: formalProjectQuality ? '正式项目质量门禁未通过' : '自动验证阻塞',
        detail: [feedbackForAI, formalProjectQuality?.feedbackForAI].filter(Boolean).join('\n\n').slice(0, 1200),
      });
      await emitAutoValidationQualityGateStatus(callbacks, evidenceOperationId, qualityGate);
      return {
        feedbackForAI: [feedbackForAI, formalProjectQuality?.feedbackForAI].filter(Boolean).join('\n\n'),
        qualityGate,
      };
    }
    callbacks.onToolActivity?.('terminal', `自动验证: ${result.command}`);
    const feedbackForAI = formatAutoValidationFeedback(result);
    const repairBlockedReason = !result.ok && isExplicitContentWriteRequest(userPrompt)
      ? buildExactContentRepairBlockedReason(result)
      : undefined;
    const finalFeedbackForAI = [feedbackForAI, repairBlockedReason, formalProjectQuality?.feedbackForAI]
      .filter(Boolean)
      .join('\n\n');
    const finalQualityGate = formalProjectQuality?.qualityGate ?? buildAutoValidationQualityGate(result, changedPaths);
    const validationPassed = result.ok && !formalProjectQuality;
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: validationPassed ? 'completed' : 'failed',
      evidenceOperationId,
      title: validationPassed
        ? '自动验证通过'
        : formalProjectQuality
          ? '正式项目质量门禁未通过'
          : '自动验证失败',
      detail: finalFeedbackForAI.slice(0, 1200),
    });
    await emitAutoValidationQualityGateStatus(callbacks, evidenceOperationId, finalQualityGate);
    return {
      evidence: validationResultToTerminalEvidence(result),
      feedbackForAI: finalFeedbackForAI,
      repairBlockedReason,
      qualityGate: finalQualityGate,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await callbacks.onAgentStatus({
      type: 'agentStatus',
      phase: 'validate',
      state: 'failed',
      evidenceOperationId,
      title: '自动验证异常',
      detail: message,
    });
    return {
      evidence: {
        command: 'automatic workspace validation',
        kind: 'other',
        ok: false,
        exitCode: null,
        detail: `自动验证异常：${message}`,
      },
      feedbackForAI: `自动验证异常：${message}\n自动验证命令未通过，不能把编译/运行/测试标记为完成。`,
    };
  }
}
