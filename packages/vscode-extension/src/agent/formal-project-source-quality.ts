import { assessFormalProjectDocumentQuality } from './formal-project-document-quality';

export interface FormalProjectSourceFile {
  path: string;
  content: string;
  action?: string;
}

export interface FormalProjectSourceQuality {
  required: boolean;
  ok: boolean;
  hasStandaloneSampleCode: boolean;
  hasUnresolvedProjectFacts: boolean;
  offendingPaths: string[];
  reasons: string[];
}

const SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;
const STANDALONE_MAIN_RE = /\b(?:int|auto)\s+main\s*\(/;
const PROC_APP_RE = /\bclass\s+Proc[A-Za-z0-9_]*App\b|\bProc[A-Za-z0-9_]*App::instance\s*\(/;
const EXPLICIT_NEW_EXECUTABLE_RE = /(?:新增|新建|创建|实现).{0,40}(?:独立进程|新进程|可执行程序|命令行|CLI|daemon|service|main\s*函数|入口程序|add_executable)|(?:独立进程|新进程|可执行程序|命令行|CLI|daemon|service|main\s*函数|入口程序).{0,40}(?:新增|新建|创建|实现)/i;
const UNRESOLVED_SOURCE_FACT_RE = /(?:(?:待确认|待分配|待定|建议范围|后续确认|TODO|TBD|FIXME).{0,100}(?:注入点|命令号|command|MAV_CMD|topic|通道|通讯|通信|接口|schema|字段|文件|函数|类|路径|集成点)|(?:注入点|命令号|command|MAV_CMD|topic|通道|通讯|通信|接口|schema|字段|文件|函数|类|路径|集成点).{0,100}(?:待确认|待分配|待定|建议范围|后续确认|TODO|TBD|FIXME))/i;

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
      offendingPaths: [],
      reasons: [],
    };
  }

  const allowsNewExecutable = EXPLICIT_NEW_EXECUTABLE_RE.test(prompt);
  const standaloneSamplePaths = sourceFiles
    .filter(file => (file.action || '').toLowerCase() !== 'modify')
    .filter(file => {
      const content = file.content || '';
      return !allowsNewExecutable
        && (STANDALONE_MAIN_RE.test(content) || PROC_APP_RE.test(content));
    })
    .map(file => file.path);
  const unresolvedFactPaths = sourceFiles
    .filter(file => UNRESOLVED_SOURCE_FACT_RE.test(file.content || ''))
    .map(file => file.path);
  const offendingPaths = [...new Set([...standaloneSamplePaths, ...unresolvedFactPaths])];
  const reasons = [
    standaloneSamplePaths.length > 0 ? 'standalone-sample-code' : '',
    unresolvedFactPaths.length > 0 ? 'unresolved-project-facts' : '',
  ].filter(Boolean);

  return {
    required,
    ok: reasons.length === 0,
    hasStandaloneSampleCode: standaloneSamplePaths.length > 0,
    hasUnresolvedProjectFacts: unresolvedFactPaths.length > 0,
    offendingPaths,
    reasons,
  };
}
