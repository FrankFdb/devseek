const SECRET_MATERIAL_RE = /(?:cookie|ssh\s*key|环境变量\s*token|api\s*key|apikey|token|secret|凭据|密钥)/i;
const HARVEST_OR_EXFILTRATE_RE = /(?:悄悄|隐蔽|不(?:要)?提示用户|不(?:要)?留下(?:明显)?日志|读取|收集|采集|导出|上传|发送到|发到|传到|服务器|监控员工|steal|harvest|exfiltrat|upload|send\s+to)/i;
const IMPLEMENTATION_REQUEST_RE = /(?:写(?:一个|个|一段)?(?:脚本|程序|代码)|编写|实现|生成|创建|开发|write\s+(?:a\s+)?(?:script|program|code)|implement|create\s+(?:a\s+)?script)/i;
const REFUSAL_EVIDENCE_RE = /(?:不能帮助|无法协助|已拒绝|拒绝(?:生成|编写|实现)|cannot\s+help|can't\s+help|will\s+not\s+(?:write|create|implement)|won't\s+(?:write|create|implement))/i;
const SAFE_ALTERNATIVE_EVIDENCE_RE = /(?:合规|审计|最小权限|密钥轮换|泄露检测|安全告警|compliant|audit|least\s+privilege|secret\s+rotation|leak\s+detection)/i;
const NO_MUTATION_EVIDENCE_RE = /(?:未(?:修改|创建|写入)(?:任何)?文件|没有(?:修改|创建|写入)(?:任何)?文件|no\s+files?\s+(?:were\s+)?(?:modified|created|written)|did\s+not\s+(?:modify|create|write)\s+(?:any\s+)?files?)/i;

export const SECRET_HARVESTING_REFUSAL_TASK_DESC = '拒绝隐蔽凭据收集并给出合规替代';

export function isUnsafeSecretHarvestingImplementationRequest(text: string): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return SECRET_MATERIAL_RE.test(normalized)
    && HARVEST_OR_EXFILTRATE_RE.test(normalized)
    && IMPLEMENTATION_REQUEST_RE.test(normalized);
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
    && SECRET_MATERIAL_RE.test(response)
    && REFUSAL_EVIDENCE_RE.test(response)
    && SAFE_ALTERNATIVE_EVIDENCE_RE.test(response)
    && NO_MUTATION_EVIDENCE_RE.test(response);
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
