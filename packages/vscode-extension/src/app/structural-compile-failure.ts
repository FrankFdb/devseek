const CPP_SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;
const CPP_SOURCE_IN_OUTPUT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)(?::|\b)/i;
const CPP_LINE_ONE_STRUCTURAL_ERROR_RE =
  /(?:^|\n)[^\n]*(?:\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx):1(?::\d+)?:|line\s+1)[^\n]*(?:error:|fatal error:)[^\n]*(?:expected\s+unqualified-id|does\s+not\s+name\s+a\s+type|expected\s+declaration|expected\s+initializer\s+before)/i;
const CPP_STRUCTURAL_ERROR_RE =
  /(?:error:|fatal error:)[^\n]*(?:expected\s+unqualified-id|does\s+not\s+name\s+a\s+type|expected\s+declaration|expected\s+initializer\s+before)/i;

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
