import {
  buildSecretHarvestingRefusalTaskContract,
  buildCodingKernelTaskContract,
  isUnsafeSecretHarvestingImplementationRequest,
  type CodingKernelTaskContract,
  type CodingTaskMode,
} from '@devseek-netai/shared';

const RELEASE_REQUEST_RE = /(?:\brelease\b|\bpublish\b|\bpackage\b|\bdeploy\b|发布|发版|打包|部署)/iu;
const REVIEW_REQUEST_RE = /(?:\breview\b|\baudit\b|\binspect\b|\banaly[sz]e\b|审查|审计|检查|分析)/iu;
const CHANGE_REQUEST_RE = /(?:\badd\b|\bcreate\b|\bwrite\b|\bimplement\b|\bfix\b|\brepair\b|\brecover(?:y)?\b|\bmodify\b|\bupdate\b|\brefactor\b|\bapply\b|\bpatch\b|添加|新增|创建|编写|实现|修复|恢复|修改|更新|重构|应用|打补丁)/iu;
const NON_MUTATING_REQUEST_RE = /(?:\breview\b|\baudit\b|\binspect\b|\banaly[sz]e\b|\bexplain\b|\bdescribe\b|\bhow\b|\bwhy\b|\bwhat\b|审查|审计|检查|分析|解释|说明|如何|为什么|什么)/iu;
const MUTATION_VERB_PATTERN = '(release|publish|package|deploy|add|create|write|implement|fix|repair|recover(?:y)?|modify|update|refactor|apply|patch|发布|发版|打包|部署|添加|新增|创建|编写|实现|修复|恢复|修改|更新|重构|应用|打补丁)';
const EXPLICIT_MUTATION_LEAD_RE = new RegExp(`^\\s*(?:(?:please|kindly)\\s+|(?:can|could|would)\\s+you\\s+|请|麻烦(?:你)?)*${MUTATION_VERB_PATTERN}`, 'iu');
const EXPLICIT_MUTATION_FOLLOW_UP_RE = new RegExp(`(?:\\band\\b|\\bthen\\b|\\balso\\b|[,;，；]|并(?:且)?|然后|同时)\\s*(?:(?:please|kindly)\\s+|请)?${MUTATION_VERB_PATTERN}`, 'iu');
export function buildCliCodingKernelTaskContract(
  prompt: string,
  contextFiles: readonly string[],
): CodingKernelTaskContract {
  if (isUnsafeSecretHarvestingImplementationRequest(prompt)) {
    return buildSecretHarvestingRefusalTaskContract('cli');
  }
  const mode = classifyCliTaskMode(prompt);
  const mutating = mode === 'change' || mode === 'release';
  return buildCodingKernelTaskContract({
    goal: prompt,
    mode,
    include: contextFiles,
    deliverables: mutating
      ? [
          { id: 'source-change', kind: 'source-change' },
          { id: 'verification-result', kind: 'verification-result' },
        ]
      : [{ id: 'response', kind: 'report' }],
    constraints: mutating
      ? ['Keep workspace effects inside the selected root.', 'Verify applicable changes before completion.']
      : ['Do not mutate the workspace without an explicit change request.'],
    acceptance: mutating
      ? [
          { id: 'requested-outcome', statement: 'The requested workspace outcome is applied.' },
          { id: 'verified', statement: 'Applicable verification passes before completion.' },
        ]
      : [{ id: 'grounded-response', statement: 'The response addresses the request without unauthorized effects.' }],
    provenanceRefs: ['user-prompt', 'surface:cli'],
  });
}

function classifyCliTaskMode(prompt: string): CodingTaskMode {
  if (NON_MUTATING_REQUEST_RE.test(prompt)) {
    const explicitMutation = EXPLICIT_MUTATION_LEAD_RE.exec(prompt)
      ?? EXPLICIT_MUTATION_FOLLOW_UP_RE.exec(prompt);
    if (!explicitMutation) return REVIEW_REQUEST_RE.test(prompt) ? 'review' : 'explain';
    return RELEASE_REQUEST_RE.test(explicitMutation[1]) ? 'release' : 'change';
  }
  if (RELEASE_REQUEST_RE.test(prompt)) return 'release';
  if (CHANGE_REQUEST_RE.test(prompt)) return 'change';
  return 'explain';
}
