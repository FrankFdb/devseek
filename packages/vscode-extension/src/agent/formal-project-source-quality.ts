import { assessFormalProjectDocumentQuality } from './formal-project-document-quality';

export interface FormalProjectSourceFile {
  path: string;
  content: string;
  action?: string;
  exists?: boolean;
}

export interface FormalProjectSourceQuality {
  required: boolean;
  ok: boolean;
  hasStandaloneSampleCode: boolean;
  hasUnresolvedProjectFacts: boolean;
  hasValidationHook: boolean;
  requiresValidationHook: boolean;
  hasInvalidValidationScript: boolean;
  hasMissingValidationArtifact: boolean;
  offendingPaths: string[];
  reasons: string[];
}

const SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|sh|bash|py)$/i;
const STANDALONE_MAIN_RE = /\b(?:int|auto)\s+main\s*\(/;
const PROC_APP_RE = /\bclass\s+Proc[A-Za-z0-9_]*App\b|\bProc[A-Za-z0-9_]*App::instance\s*\(/;
const EXPLICIT_NEW_EXECUTABLE_RE = /(?:新增|新建|创建|实现).{0,40}(?:独立进程|新进程|可执行程序|命令行|CLI|daemon|service|main\s*函数|入口程序|add_executable)|(?:独立进程|新进程|可执行程序|命令行|CLI|daemon|service|main\s*函数|入口程序).{0,40}(?:新增|新建|创建|实现)/i;
const UNRESOLVED_SOURCE_FACT_RE = /(?:(?:待确认|待分配|待定|建议范围|后续确认|TODO|TBD|FIXME).{0,100}(?:注入点|命令号|command|MAV_CMD|topic|通道|通讯|通信|接口|schema|字段|文件|函数|类|路径|集成点)|(?:注入点|命令号|command|MAV_CMD|topic|通道|通讯|通信|接口|schema|字段|文件|函数|类|路径|集成点).{0,100}(?:待确认|待分配|待定|建议范围|后续确认|TODO|TBD|FIXME))/i;
const VALIDATION_REQUIRED_RE = /(?:自闭环|测试|验证|单体|单元|编译|运行|self.?loop|test|verify|validation|compile|build)/i;
const VALIDATION_HOOK_RE = /(?:assert\s*\(|static_assert|EXPECT_|ASSERT_|self.?test|SelfTest|verify|validate|validation|单元测试|自测|验证)/i;
const VALIDATION_FILE_RE = /(?:^|\/)(?:tests?|selftests?|__tests__)(?:\/|$)|(?:test|spec|selftest|verify|validation)/i;
const SHELL_SOURCE_RE = /\.(?:sh|bash)$/i;
const BROKEN_SHELL_VALIDATION_RE = new RegExp([
  String.raw`\b[A-Z][A-Z0-9_]*=\s*\([^)$\n]*(?:dirname|date|pwd|wc|grep|sed|find|cat)\b`,
  String.raw`\b(?:JSON_COUNT|LINES)\s*=\s*[A-Z_][A-Z0-9_]*"`,
  String.raw`(?:^|\n)\s*(?:for|if|while)\b[^\n]*"\{[A-Za-z_][A-Za-z0-9_]*\[@\]\}"`,
  String.raw`(?:^|\n)\s*(?:test|\[|grep|sed|wc|cat|bash|chmod)\b[^\n]*"(?:SCRIPT_DIR|PROJECT_ROOT|DOC|f|JSON_COUNT|LINES)\b`,
  String.raw`(?:^|\n)\s*echo\s+"[^"\n]*(?:\(date\)|\b[fl]:|\bJSON_COUNT\b|\bLINES\b)`,
].join('|'), 'i');

export function assessFormalProjectSourceQuality(
  files: FormalProjectSourceFile[],
  promptText = '',
): FormalProjectSourceQuality {
  const prompt = String(promptText || '');
  const required = assessFormalProjectDocumentQuality('', prompt).required;
  const sourceFiles = files.filter(file => SOURCE_EXT_RE.test(file.path || ''));
  if (!required || sourceFiles.length === 0) {
    return {
      required,
      ok: true,
      hasStandaloneSampleCode: false,
      hasUnresolvedProjectFacts: false,
      hasValidationHook: false,
      requiresValidationHook: false,
      hasInvalidValidationScript: false,
      hasMissingValidationArtifact: false,
      offendingPaths: [],
      reasons: [],
    };
  }

  const allowsNewExecutable = EXPLICIT_NEW_EXECUTABLE_RE.test(prompt);
  const requiresValidationHook = VALIDATION_REQUIRED_RE.test(prompt);
  const existingSourceFiles = sourceFiles.filter(file => file.exists !== false);
  const missingSourceFiles = sourceFiles.filter(file => file.exists === false);
  const validationHookFiles = existingSourceFiles.filter(file => (
    VALIDATION_FILE_RE.test(file.path || '')
    || VALIDATION_HOOK_RE.test(file.content || '')
  ));
  const invalidValidationScriptPaths = validationHookFiles
    .filter(file => SHELL_SOURCE_RE.test(file.path || ''))
    .filter(file => BROKEN_SHELL_VALIDATION_RE.test(file.content || ''))
    .map(file => file.path);
  const missingValidationArtifactPaths = validationHookFiles
    .filter(file => SHELL_SOURCE_RE.test(file.path || ''))
    .filter(file => missingSourceFiles.some(missing => validationScriptReferencesArtifact(file.content, missing.path)))
    .map(file => file.path);
  const hasValidationHook = validationHookFiles
    .some(file => !invalidValidationScriptPaths.includes(file.path) && !missingValidationArtifactPaths.includes(file.path));
  const standaloneSamplePaths = existingSourceFiles
    .filter(file => (file.action || '').toLowerCase() !== 'modify')
    .filter(file => {
      const content = file.content || '';
      return !allowsNewExecutable
        && (STANDALONE_MAIN_RE.test(content) || PROC_APP_RE.test(content));
    })
    .map(file => file.path);
  const unresolvedFactPaths = existingSourceFiles
    .filter(file => UNRESOLVED_SOURCE_FACT_RE.test(file.content || ''))
    .map(file => file.path);
  const offendingPaths = [...new Set([
    ...standaloneSamplePaths,
    ...unresolvedFactPaths,
    ...invalidValidationScriptPaths,
    ...missingValidationArtifactPaths,
  ])];
  const reasons = [
    standaloneSamplePaths.length > 0 ? 'standalone-sample-code' : '',
    unresolvedFactPaths.length > 0 ? 'unresolved-project-facts' : '',
    invalidValidationScriptPaths.length > 0 ? 'invalid-validation-script' : '',
    missingValidationArtifactPaths.length > 0 ? 'validation-references-missing-artifact' : '',
    requiresValidationHook && !hasValidationHook ? 'missing-validation-hook' : '',
  ].filter(Boolean);

  return {
    required,
    ok: reasons.length === 0,
    hasStandaloneSampleCode: standaloneSamplePaths.length > 0,
    hasUnresolvedProjectFacts: unresolvedFactPaths.length > 0,
    hasValidationHook,
    requiresValidationHook,
    hasInvalidValidationScript: invalidValidationScriptPaths.length > 0,
    hasMissingValidationArtifact: missingValidationArtifactPaths.length > 0,
    offendingPaths,
    reasons,
  };
}

function validationScriptReferencesArtifact(scriptContent: string, artifactPath: string): boolean {
  const normalizedPath = String(artifactPath || '').replace(/\\/g, '/');
  const basename = normalizedPath.split('/').pop() || '';
  if (!basename) return false;
  return scriptContent.includes(normalizedPath)
    || scriptContent.includes(basename);
}
