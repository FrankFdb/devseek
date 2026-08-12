const CPP_SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;
const CPP_SOURCE_IN_OUTPUT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)(?::|\b)/i;
const CPP_LINE_ONE_STRUCTURAL_ERROR_RE =
  /(?:^|\n)[^\n]*(?:\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx):1(?::\d+)?:|line\s+1)[^\n]*(?:error:|fatal error:)[^\n]*(?:expected\s+unqualified-id|does\s+not\s+name\s+a\s+type|expected\s+declaration|expected\s+initializer\s+before)/i;
const CPP_STRUCTURAL_ERROR_RE =
  /(?:error:|fatal error:)[^\n]*(?:expected\s+unqualified-id|does\s+not\s+name\s+a\s+type|expected\s+declaration|expected\s+initializer\s+before)/i;
const CPP_STD_MEMBER_MISSING_RE =
  /(?:error:|fatal error:)[^\n]*(?:['‘`]([A-Za-z_]\w*)['’`]?\s+is\s+not\s+a\s+member\s+of\s+['‘`]?std['’`]?|std\s*::\s*([A-Za-z_]\w*)[^\n]*(?:has\s+not\s+been\s+declared|was\s+not\s+declared|not\s+declared))/gi;

const CPP_STD_SYMBOL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  bad_alloc: 'new',
  function: 'functional',
  greater: 'functional',
  invalid_argument: 'stdexcept',
  isfinite: 'cmath',
  isnan: 'cmath',
  isinf: 'cmath',
  logic_error: 'stdexcept',
  make_unique: 'memory',
  nullopt: 'optional',
  optional: 'optional',
  out_of_range: 'stdexcept',
  runtime_error: 'stdexcept',
  shared_ptr: 'memory',
  unique_ptr: 'memory',
  vector: 'vector',
});

export interface StructuralCompileFailureInput {
  output?: string;
  changedPaths?: readonly string[];
  failureFiles?: readonly string[];
}

export function isCppStructuralCompileFailure(input: StructuralCompileFailureInput): boolean {
  const output = input.output || '';
  if (!output.trim()) return false;
  const paths = [...(input.changedPaths ?? []), ...(input.failureFiles ?? [])];
  const hasCppPathContext = paths.some(path => CPP_SOURCE_EXT_RE.test(path || ''))
    || CPP_SOURCE_IN_OUTPUT_RE.test(output);
  if (!hasCppPathContext) return false;
  return CPP_LINE_ONE_STRUCTURAL_ERROR_RE.test(output)
    || CPP_STRUCTURAL_ERROR_RE.test(output);
}

export function buildStructuralCompileFailureRecoveryProtocol(
  input: StructuralCompileFailureInput,
): string {
  const protocols = [
    buildCppMissingStandardHeaderRecoveryProtocol(input),
    buildCppStructuralTranslationUnitRecoveryProtocol(input),
  ].filter(Boolean);
  return protocols.join('\n');
}

function buildCppStructuralTranslationUnitRecoveryProtocol(
  input: StructuralCompileFailureInput,
): string {
  if (!isCppStructuralCompileFailure(input)) return '';
  const affected = Array.from(new Set(
    [...(input.failureFiles ?? []), ...(input.changedPaths ?? [])]
      .filter(path => CPP_SOURCE_EXT_RE.test(path || '')),
  ));
  return [
    '结构性编译失败恢复要求：',
    affected.length
      ? `- 受影响 C/C++ 源码：${affected.join('、')}。`
      : '- 失败输出指向 C/C++ 源码结构错误。',
    '- 这类错误通常表示完整翻译单元被函数体片段覆盖，或丢失 include/namespace/class/function 等结构锚点。',
    '- 下一轮不要进入独立需求审查，不要反复 read_file 同一坏源码，也不要从头重做任务。',
    '- 先读取失败源码、对应头文件和最小测试入口；如果文件只剩 if/return/赋值等片段，必须恢复完整文件结构，或在完整文件中用 replace_in_file 精确替换函数内部逻辑。',
    '- 先运行针对首个编译错误的小 case，再运行项目既有验证作为大 case 回归。',
  ].join('\n');
}

function buildCppMissingStandardHeaderRecoveryProtocol(
  input: StructuralCompileFailureInput,
): string {
  const output = input.output || '';
  if (!output.trim()) return '';
  const paths = [...(input.changedPaths ?? []), ...(input.failureFiles ?? [])];
  const hasCppPathContext = paths.some(path => CPP_SOURCE_EXT_RE.test(path || ''))
    || CPP_SOURCE_IN_OUTPUT_RE.test(output);
  if (!hasCppPathContext) return '';
  const hints = findMissingCppStandardHeaderHints(output);
  if (hints.length === 0) return '';
  return [
    'C++ 标准库头文件缺失恢复要求：',
    ...hints.map(hint => `- 编译器提示 std::${hint.symbol} 不可用；该符号通常需要 #include <${hint.header}>。`),
    '- 下一轮只做最小 include 修复：先 read_file 读取失败源码和对应头文件的 include 区域，再用 replace_in_file 添加缺失标准头。',
    '- 不要重写完整实现、不要进入独立需求审查、不要从头重做任务；添加 include 后先运行触发该错误的编译小 case，再运行项目既有验证。',
  ].join('\n');
}

function findMissingCppStandardHeaderHints(output: string): Array<{ symbol: string; header: string }> {
  const hints: Array<{ symbol: string; header: string }> = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  CPP_STD_MEMBER_MISSING_RE.lastIndex = 0;
  while ((match = CPP_STD_MEMBER_MISSING_RE.exec(output)) !== null) {
    const symbol = (match[1] || match[2] || '').trim();
    const header = CPP_STD_SYMBOL_HEADERS[symbol];
    if (!header || seen.has(`${symbol}:${header}`)) continue;
    seen.add(`${symbol}:${header}`);
    hints.push({ symbol, header });
  }
  return hints;
}
