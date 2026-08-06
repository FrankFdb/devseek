import type { CodingCompletionAcceptanceDecision } from './coding-completion';
import {
  buildCodingKernelTaskContract,
  type CodingKernelSurface,
  type CodingKernelTaskContract,
} from './coding-kernel';
import type { CodingOrientationDecision } from './coding-orientation';
import {
  hasSecretMaterialSignal,
  isUnsafeSecretHarvestingImplementationRequest,
} from './coding-safety-intent';
export { isUnsafeSecretHarvestingImplementationRequest } from './coding-safety-intent';

const REFUSAL_EVIDENCE_RE = /(?:不能帮助|无法协助|已拒绝|拒绝(?:生成|编写|实现)|cannot\s+help|can't\s+help|will\s+not\s+(?:write|create|implement)|won't\s+(?:write|create|implement))/iu;
const SAFE_ALTERNATIVE_EVIDENCE_RE = /(?:合规|审计|最小权限|密钥轮换|泄露检测|安全告警|compliant|audit|least\s+privilege|secret\s+rotation|leak\s+detection)/iu;
const NO_MUTATION_EVIDENCE_RE = /(?:未(?:修改|创建|写入)(?:任何)?文件|没有(?:修改|创建|写入)(?:任何)?文件|no\s+files?\s+(?:were\s+)?(?:modified|created|written)|did\s+not\s+(?:modify|create|write)\s+(?:any\s+)?files?)/iu;

export const CODING_SECRET_HARVESTING_POLICY_REF = 'policy:secret-harvesting' as const;
export const SECRET_HARVESTING_REFUSAL_TASK_DESC = '拒绝隐蔽凭据收集并给出合规替代';

export const CODING_SECRET_HARVESTING_REFUSAL_ACCEPTANCE = Object.freeze([
  Object.freeze({ id: 'a-refusal', statement: 'The unsafe implementation is explicitly refused.' }),
  Object.freeze({ id: 'a-alternative', statement: 'A compliant security alternative is offered.' }),
  Object.freeze({ id: 'a-no-mutation', statement: 'No user file is created or modified.' }),
]);

export function buildSecretHarvestingRefusalTaskContract(
  surface: CodingKernelSurface,
  orientation?: CodingOrientationDecision,
): CodingKernelTaskContract {
  return buildCodingKernelTaskContract({
    goal: 'Refuse unsafe secret harvesting and provide a safe alternative without changing the workspace.',
    mode: 'explain',
    ...(orientation ? { orientation } : {}),
    exclude: ['**/*'],
    deliverables: [{ id: 'safe-response', kind: 'report' }],
    constraints: ['no-work-tools', 'no-workspace-mutation'],
    acceptance: CODING_SECRET_HARVESTING_REFUSAL_ACCEPTANCE,
    provenanceRefs: ['user-prompt', `surface:${surface}`, CODING_SECRET_HARVESTING_POLICY_REF],
  });
}

export function isSecretHarvestingRefusalTaskContract(
  contract: CodingKernelTaskContract,
): boolean {
  const acceptanceIds = new Set(contract.acceptance.map(criterion => criterion.id));
  return contract.mode === 'explain'
    && contract.provenanceRefs.includes(CODING_SECRET_HARVESTING_POLICY_REF)
    && CODING_SECRET_HARVESTING_REFUSAL_ACCEPTANCE.every(criterion => acceptanceIds.has(criterion.id));
}

export function hasUnsafeSecretHarvestingRefusalEvidence(
  requestText: string,
  responseText: string,
  runtime: { workToolUsed?: boolean; changedFileCount?: number } = {},
): boolean {
  const response = String(responseText || '').replace(/\s+/g, ' ').trim();
  return isUnsafeSecretHarvestingImplementationRequest(requestText)
    && runtime.workToolUsed !== true
    && (runtime.changedFileCount ?? 0) === 0
    && hasSecretMaterialSignal(response)
    && REFUSAL_EVIDENCE_RE.test(response)
    && SAFE_ALTERNATIVE_EVIDENCE_RE.test(response)
    && NO_MUTATION_EVIDENCE_RE.test(response);
}

export function buildSecretHarvestingRefusalAcceptanceEvidence(): CodingCompletionAcceptanceDecision[] {
  return [
    { criterionId: 'a-refusal', status: 'passed', evidenceRefs: ['response:explicit-refusal'] },
    { criterionId: 'a-alternative', status: 'passed', evidenceRefs: ['response:safe-alternative'] },
    { criterionId: 'a-no-mutation', status: 'passed', evidenceRefs: ['workspace:no-mutation'] },
  ];
}

export function buildUnsafeSecretHarvestingRefusalMessage(): string {
  return [
    '不能帮助编写悄悄读取或上传浏览器 cookie、SSH key 或 token 的脚本。',
    '',
    '这类请求会隐蔽收集并外传敏感凭据，可能伤害用户、员工和组织安全。',
    '',
    '我可以改为帮助你设计合规日志审计、最小权限监控、告警规则、资产盘点或员工设备管理方案，并保留透明授权和审计记录。',
    '',
    '未修改文件。',
  ].join('\n');
}
