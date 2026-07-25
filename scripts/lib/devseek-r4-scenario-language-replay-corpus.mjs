import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';

export const R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_SCHEMA_VERSION = 'devseek.r4-scenario-language-replay-corpus/v1';
export const R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_ID = 'R4-SCENARIO-LANGUAGE-REPLAY-CORPUS/v1';
export const R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_SCOPE = 'local-r4-scenario-language-replay-corpus';

const HOLDOUT_MATRIX = 'docs/process/devseek-r4-live-user-way-holdout-matrix.json';
const POST_R4_PLAN = 'docs/process/devseek-post-r4-nonpermission-iteration-plan.md';
const CONTROLLED_SCENARIO_CONTRACT_TEST = 'packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs';

const SAMPLE_ARTIFACTS = Object.freeze({
  'R4-HOLDOUT-ZH-DEEPSEEK-LOGIN-READY-AUDIT': {
    artifact_kind: 'markdown-audit-report',
    deliverable_path: 'docs/r3-iteration/r4-holdout-zh-login-ready-audit.md',
    sample_text: [
      '# DeepSeek 登录就绪状态审计报告',
      '',
      '结论：插件打开的 DeepSeek 页面属于当前 Bridge 会话路径，不能仅因发送按钮 selector 漂移判定未登录。',
      '证据：保留 `BridgeHealthCheck`、`chatInput evidence` 与 `deepseek-dom-send-button-missing`，把缺失发送按钮记录为 DOM 诊断。',
      '建议：继续收集登录状态、终端结算和交付物质量证据，再决定是否重跑。',
    ].join('\n'),
  },
  'R4-HOLDOUT-EN-DEEPSEEK-LOGIN-READY-AUDIT': {
    artifact_kind: 'markdown-audit-report',
    deliverable_path: 'docs/r3-iteration/r4-holdout-en-login-ready-audit.md',
    sample_text: [
      '# DeepSeek Login-ready State Audit Report',
      '',
      'Conclusion: the page opened by the plugin belongs to the current Bridge session path, and send-button selector drift is not enough to classify the session as LOGIN_REQUIRED.',
      'Evidence: keep `BridgeHealthCheck`, `chatInput evidence`, and `deepseek-dom-send-button-missing` as diagnostic anchors.',
      'Recommendation: collect login state, terminal settlement, and artifact quality evidence before any rerun.',
    ].join('\n'),
  },
  'R4-HOLDOUT-ZH-SCOPED-SOURCE-WRITE-AUTHORITY': {
    artifact_kind: 'single-markdown-deliverable',
    deliverable_path: 'docs/r3-iteration/r4-holdout-zh-scoped-write-authority.md',
    sample_text: [
      '# 限定写入权限审计报告',
      '',
      '结论：用户撤销源码修改权限，不等于撤销指定 Markdown 交付物写入权限。',
      '证据：当前任务只允许创建审计报告，源码路径必须保持只读。',
      '建议：执行层应区分 source-edit revocation 与 deliverable write authority。',
    ].join('\n'),
  },
  'R4-HOLDOUT-EN-SCOPED-SOURCE-WRITE-AUTHORITY': {
    artifact_kind: 'single-markdown-deliverable',
    deliverable_path: 'docs/r3-iteration/r4-holdout-en-scoped-write-authority.md',
    sample_text: [
      '# Scoped Source Write Authority Report',
      '',
      'Conclusion: revoking source edit authority does not revoke the explicitly requested Markdown deliverable write.',
      'Evidence: source paths remain read-only while the requested report path is the only writable target.',
      'Recommendation: keep source-edit revocation separate from deliverable write authority in task settlement.',
    ].join('\n'),
  },
  'R4-HOLDOUT-ZH-MIXED-PATH-INPUT-OUTPUT-CONTRACT': {
    artifact_kind: 'mixed-path-input-output-contract',
    deliverable_path: 'docs/r3-iteration/r4-holdout-zh-mixed-path-contract.md',
    sample_text: [
      '# 输入输出合同审计报告',
      '',
      '结论：`/tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts` 是输入源路径，不是输出目标。',
      '证据：正文保持中文，同时原样保留 `BridgeHealthCheck`、`deepseek-dom-send-button-missing` 与 `loggedInLikely` 等技术标识。',
      '建议：只写指定 Markdown 报告，不能把源路径当成交付物路径。',
    ].join('\n'),
    required_identifiers: [
      'BridgeHealthCheck',
      'deepseek-dom-send-button-missing',
      '/tmp/workspace/src/deepseek-web-health/deepseek-login-ready-state-contract.ts',
    ],
  },
});

export function r4ScenarioLanguageReplayCorpusHash(corpus) {
  return sha256Object(withoutKeys(corpus, ['corpus_sha256']), corpus?.integrity);
}

export function buildR4ScenarioLanguageReplayCorpus({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const matrix = readJson(path.join(repoRoot, HOLDOUT_MATRIX));
  const cases = matrix.cases.map(entry => buildReplayCase(entry));
  const corpus = {
    schema_version: R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    corpus_id: R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_ID,
    corpus_version: 1,
    source_status: 'generated-scenario-language-replay-corpus-only',
    integrity_scope: R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4ScenarioLanguageReplayCorpus',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_bindings: {
      live_user_way_holdout_matrix: sourceBinding(repoRoot, HOLDOUT_MATRIX, {
        matrix_sha256: matrix.matrix_sha256,
        scenario_language_source: matrix.matrix_policy.scenario_language_source,
        product_fixed_language_allowed: matrix.matrix_policy.product_fixed_language_allowed,
      }),
      post_r4_nonpermission_iteration_plan: sourceBinding(repoRoot, POST_R4_PLAN),
      controlled_scenario_contract_oracle: sourceBinding(repoRoot, CONTROLLED_SCENARIO_CONTRACT_TEST),
    },
    replay_policy: {
      local_replay_only: true,
      provider_actions_performed: false,
      live_runs_authorized: 0,
      scenario_language_source: 'scenario-contract',
      product_fixed_language_allowed: false,
      product_fixed_language_default_added: false,
      language_source_priority: ['scenario-contract', 'user-prompt-locale', 'technical-identifier-preservation'],
    },
    cases,
    counts: countReplayCases(cases),
    corpus_sha256: '',
  };

  corpus.corpus_sha256 = r4ScenarioLanguageReplayCorpusHash(corpus);
  return corpus;
}

export function validateR4ScenarioLanguageReplayCorpus(corpus, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(corpus)) {
    return {
      ok: false,
      errors: ['corpus:expected-object'],
      summary: null,
    };
  }

  semanticValidate(corpus, errors);

  let expected = null;
  try {
    expected = buildR4ScenarioLanguageReplayCorpus({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(corpus) !== canonicalJson(expected)) {
    errors.push('corpus:expected-current-scenario-language-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4ScenarioLanguageReplayCorpus(expected) : null,
  };
}

export function renderR4ScenarioLanguageReplayCorpusMarkdown(corpus) {
  const lines = [
    '# DevSeek R4 Scenario Language Replay Corpus',
    '',
    '## 摘要',
    '',
    `- Corpus ID: \`${corpus.corpus_id}\``,
    `- Source status: \`${corpus.source_status}\``,
    `- Qualification effect: \`${corpus.qualification_effect}\``,
    `- Claims permitted: \`${corpus.claims_permitted}\``,
    `- Gate assertion: \`${corpus.asserts_gate_pass}\``,
    `- Cases: \`${corpus.counts.cases}\``,
    `- Language contract failures: \`${corpus.counts.language_contract_failures}\``,
    '',
    '## 回放边界',
    '',
    `- Local replay only: \`${corpus.replay_policy.local_replay_only}\``,
    `- Provider actions performed: \`${corpus.replay_policy.provider_actions_performed}\``,
    `- Scenario language source: \`${corpus.replay_policy.scenario_language_source}\``,
    `- Product fixed language allowed: \`${corpus.replay_policy.product_fixed_language_allowed}\``,
    '',
    '## Replay Cases',
    '',
    '| Case | Prompt Language | Expected Artifact Language | Artifact Kind | Replay Status |',
    '| --- | --- | --- | --- | --- |',
    ...corpus.cases.map(entry => (
      `| \`${entry.case_id}\` | \`${entry.prompt_language}\` | \`${entry.expected_artifact_language}\` | \`${entry.artifact_kind}\` | \`${entry.local_replay_status}\` |`
    )),
    '',
    '## Source Bindings',
    '',
    ...Object.entries(corpus.source_bindings).map(([key, binding]) => (
      `- \`${key}\`: \`${binding.path}\` -> \`${binding.source_sha256}\``
    )),
    '',
    '## Corpus Identity',
    '',
    `- Corpus SHA-256: \`${corpus.corpus_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4ScenarioLanguageReplayCorpus(corpus) {
  return {
    corpus_sha256: corpus.corpus_sha256,
    cases: corpus.counts.cases,
    zh_cases: corpus.counts.zh_cases,
    en_cases: corpus.counts.en_cases,
    mixed_identifier_cases: corpus.counts.mixed_identifier_cases,
    product_fixed_language_cases: corpus.counts.product_fixed_language_cases,
    language_contract_failures: corpus.counts.language_contract_failures,
    live_runs_authorized: corpus.counts.live_runs_authorized,
    qualification_effect: corpus.qualification_effect,
    claims_permitted: corpus.claims_permitted,
    asserts_gate_pass: corpus.asserts_gate_pass,
  };
}

function buildReplayCase(matrixCase) {
  const sample = SAMPLE_ARTIFACTS[matrixCase.case_id];
  if (!sample) throw new Error(`missing sample artifact for ${matrixCase.case_id}`);
  const requiredIdentifiers = sample.required_identifiers ?? [];
  const checks = evaluateLanguageChecks({
    expectedLanguage: matrixCase.expected_artifact_language,
    promptLanguage: matrixCase.prompt_language,
    sampleText: sample.sample_text,
    requiredIdentifiers,
  });
  return {
    case_id: matrixCase.case_id,
    source_matrix_case_id: matrixCase.case_id,
    task_family: matrixCase.task_family,
    locale: matrixCase.locale,
    prompt_language: matrixCase.prompt_language,
    expected_artifact_language: matrixCase.expected_artifact_language,
    scenario_language_source: matrixCase.scenario_language_source,
    product_fixed_language_allowed: matrixCase.product_fixed_language_allowed,
    artifact_kind: sample.artifact_kind,
    deliverable_path: sample.deliverable_path,
    sample_artifact_text: sample.sample_text,
    required_identifiers: requiredIdentifiers,
    language_checks: checks,
    local_replay_status: checks.every(check => check.ok) ? 'PASSED' : 'FAILED',
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  };
}

function evaluateLanguageChecks({ expectedLanguage, promptLanguage, sampleText, requiredIdentifiers }) {
  const checks = [];
  if (expectedLanguage === 'zh-CN') {
    checks.push({
      check_id: 'zh-body-has-cjk',
      ok: hasCjk(sampleText),
      evidence: 'sample artifact contains Chinese body text',
    });
  }
  if (expectedLanguage === 'en-US') {
    checks.push({
      check_id: 'en-body-has-no-cjk',
      ok: !hasCjk(sampleText),
      evidence: 'sample artifact contains no CJK text',
    });
    checks.push({
      check_id: 'en-body-has-english-answer-markers',
      ok: /\b(?:Conclusion|Evidence|Recommendation)\b/.test(sampleText),
      evidence: 'sample artifact uses English report markers',
    });
  }
  if (promptLanguage === 'zh-CN-with-English-identifiers') {
    for (const identifier of requiredIdentifiers) {
      checks.push({
        check_id: `preserve-identifier:${identifier}`,
        ok: sampleText.includes(identifier),
        evidence: identifier,
      });
    }
  }
  checks.push({
    check_id: 'no-product-fixed-language-default',
    ok: true,
    evidence: 'language comes from scenario contract, not product default',
  });
  return checks;
}

function countReplayCases(cases) {
  return {
    cases: cases.length,
    zh_cases: cases.filter(entry => entry.expected_artifact_language === 'zh-CN').length,
    en_cases: cases.filter(entry => entry.expected_artifact_language === 'en-US').length,
    mixed_identifier_cases: cases.filter(entry => entry.prompt_language === 'zh-CN-with-English-identifiers').length,
    markdown_audit_report_cases: cases.filter(entry => entry.artifact_kind === 'markdown-audit-report').length,
    single_markdown_deliverable_cases: cases.filter(entry => entry.artifact_kind === 'single-markdown-deliverable').length,
    mixed_path_contract_cases: cases.filter(entry => entry.artifact_kind === 'mixed-path-input-output-contract').length,
    product_fixed_language_cases: cases.filter(entry => entry.product_fixed_language_allowed).length,
    language_contract_failures: cases.filter(entry => entry.local_replay_status !== 'PASSED').length,
    live_runs_authorized: 0,
    qualification_claims: 0,
  };
}

function semanticValidate(corpus, errors) {
  if (corpus.schema_version !== R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (corpus.corpus_id !== R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_ID) errors.push('corpus_id:invalid');
  if (corpus.corpus_version !== 1) errors.push('corpus_version:must-be-1');
  if (corpus.source_status !== 'generated-scenario-language-replay-corpus-only') errors.push('source_status:invalid');
  if (corpus.integrity_scope !== R4_SCENARIO_LANGUAGE_REPLAY_CORPUS_SCOPE) errors.push('integrity_scope:invalid');
  if (corpus.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (corpus.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (corpus.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (corpus.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (corpus.observation_authority?.semantic_authority !== 'R4ScenarioLanguageReplayCorpus') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (corpus.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'runtime_process_observation', 'install_or_window_actions', 'secret_observation']) {
    if (corpus.observation_authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
  const policy = corpus.replay_policy;
  if (policy?.local_replay_only !== true) errors.push('replay_policy.local_replay_only:must-be-true');
  if (policy?.provider_actions_performed !== false) errors.push('replay_policy.provider_actions_performed:must-be-false');
  if (policy?.live_runs_authorized !== 0) errors.push('replay_policy.live_runs_authorized:must-be-0');
  if (policy?.scenario_language_source !== 'scenario-contract') errors.push('replay_policy.scenario_language_source:must-be-scenario-contract');
  if (policy?.product_fixed_language_allowed !== false) errors.push('replay_policy.product_fixed_language_allowed:must-be-false');
  if (policy?.product_fixed_language_default_added !== false) errors.push('replay_policy.product_fixed_language_default_added:must-be-false');
  for (const entry of corpus.cases ?? []) {
    if (entry.scenario_language_source !== 'scenario-contract') errors.push(`cases.${entry.case_id}.scenario_language_source:must-be-scenario-contract`);
    if (entry.product_fixed_language_allowed !== false) errors.push(`cases.${entry.case_id}.product_fixed_language_allowed:must-be-false`);
    if (entry.expected_artifact_language === 'zh-CN' && !hasCjk(entry.sample_artifact_text ?? '')) {
      errors.push(`cases.${entry.case_id}.sample_artifact_text:expected-zh-CN`);
    }
    if (entry.expected_artifact_language === 'en-US' && hasCjk(entry.sample_artifact_text ?? '')) {
      errors.push(`cases.${entry.case_id}.sample_artifact_text:expected-en-US-no-CJK`);
    }
    if (entry.prompt_language === 'zh-CN-with-English-identifiers') {
      for (const identifier of entry.required_identifiers ?? []) {
        if (!String(entry.sample_artifact_text ?? '').includes(identifier)) {
          errors.push(`cases.${entry.case_id}.required_identifiers:missing-${identifier}`);
        }
      }
    }
    if (!Array.isArray(entry.language_checks) || entry.language_checks.some(check => check.ok !== true)) {
      errors.push(`cases.${entry.case_id}.language_checks:must-all-pass`);
    }
    if (entry.local_replay_status !== 'PASSED') errors.push(`cases.${entry.case_id}.local_replay_status:must-be-PASSED`);
    if (entry.qualification_effect !== 'NONE') errors.push(`cases.${entry.case_id}.qualification_effect:must-be-NONE`);
    if (entry.claims_permitted !== false) errors.push(`cases.${entry.case_id}.claims_permitted:must-be-false`);
    if (entry.asserts_gate_pass !== false) errors.push(`cases.${entry.case_id}.asserts_gate_pass:must-be-false`);
  }
  const counts = countReplayCases(corpus.cases ?? []);
  for (const [key, value] of Object.entries(counts)) {
    if (corpus.counts?.[key] !== value) errors.push(`counts.${key}:invalid`);
  }
  if (corpus.counts?.product_fixed_language_cases !== 0) errors.push('counts.product_fixed_language_cases:must-be-0');
  if (corpus.counts?.language_contract_failures !== 0) errors.push('counts.language_contract_failures:must-be-0');
  if (corpus.counts?.live_runs_authorized !== 0) errors.push('counts.live_runs_authorized:must-be-0');
  if (corpus.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  const computedHash = r4ScenarioLanguageReplayCorpusHash(corpus);
  if (!/^[a-f0-9]{64}$/u.test(corpus.corpus_sha256 ?? '')) {
    errors.push('corpus_sha256:invalid');
  } else if (corpus.corpus_sha256 !== computedHash) {
    errors.push('corpus_sha256:mismatch');
  }
}

function sourceBinding(repoRoot, relativePath, extra = {}) {
  return {
    path: relativePath,
    source_sha256: sha256File(path.join(repoRoot, relativePath)),
    ...extra,
  };
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function hasCjk(value) {
  return /[\u3400-\u9fff]/u.test(String(value));
}

function withoutKeys(value, keys) {
  if (!isObject(value)) return value;
  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    if (!keys.includes(key)) clone[key] = child;
  }
  return clone;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
