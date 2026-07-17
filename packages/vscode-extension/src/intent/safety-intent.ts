const SECRET_MATERIAL_RE = /(?:cookie|ssh\s*key|环境变量\s*token|api\s*key|apikey|token|secret|凭据|密钥)/i;
const HARVEST_OR_EXFILTRATE_RE = /(?:悄悄|隐蔽|不(?:要)?提示用户|不(?:要)?留下(?:明显)?日志|读取|收集|采集|导出|上传|发送到|发到|传到|服务器|监控员工|steal|harvest|exfiltrat|upload|send\s+to)/i;
const IMPLEMENTATION_REQUEST_RE = /(?:写(?:一个|个|一段)?(?:脚本|程序|代码)|编写|实现|生成|创建|开发|write\s+(?:a\s+)?(?:script|program|code)|implement|create\s+(?:a\s+)?script)/i;

export const SECRET_HARVESTING_REFUSAL_TASK_DESC = '拒绝隐蔽凭据收集并给出合规替代';

export function isUnsafeSecretHarvestingImplementationRequest(text: string): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return SECRET_MATERIAL_RE.test(normalized)
    && HARVEST_OR_EXFILTRATE_RE.test(normalized)
    && IMPLEMENTATION_REQUEST_RE.test(normalized);
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
