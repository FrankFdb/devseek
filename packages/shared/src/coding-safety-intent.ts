const SECRET_MATERIAL_RE = /(?:cookie|ssh\s*key|环境变量\s*token|api\s*key|apikey|token|secret|credential|password|凭据|密钥|令牌|密码)/iu;
const HARVEST_OR_EXFILTRATE_RE = /(?:悄悄|隐蔽|不(?:要)?提示用户|不(?:要)?留下(?:明显)?日志|读取|收集|采集|导出|窃取|上传|发送到|发到|传到|服务器|监控员工|steal|harvest|collect|exfiltrat|upload|send\s+to)/iu;
const IMPLEMENTATION_REQUEST_RE = /(?:写(?:一个|个|一段)?(?:脚本|程序|代码)|编写|实现|生成|创建|开发|write\b.{0,32}\b(?:script|program|code|tool)\b|implement|create\b.{0,32}\b(?:script|program|tool)\b)/iu;

export function hasSecretMaterialSignal(text: string): boolean {
  return SECRET_MATERIAL_RE.test(String(text || ''));
}

export function isUnsafeSecretHarvestingImplementationRequest(text: string): boolean {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  return hasSecretMaterialSignal(normalized)
    && HARVEST_OR_EXFILTRATE_RE.test(normalized)
    && IMPLEMENTATION_REQUEST_RE.test(normalized);
}
