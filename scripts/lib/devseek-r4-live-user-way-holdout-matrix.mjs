import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalJson,
  readJson,
  sha256Object,
  SUPPORTED_INTEGRITY,
} from './devseek-capability-ledger.mjs';

export const R4_LIVE_USER_WAY_HOLDOUT_MATRIX_SCHEMA_VERSION = 'devseek.r4-live-user-way-holdout-matrix/v1';
export const R4_LIVE_USER_WAY_HOLDOUT_MATRIX_ID = 'R4-LIVE-USER-WAY-HOLDOUT-MATRIX/v1';
export const R4_LIVE_USER_WAY_HOLDOUT_MATRIX_SCOPE = 'local-r4-live-user-way-holdout-matrix';

const REQUEST_PACKET = 'docs/process/devseek-r4-live-qualification-request-packet.json';
const REAL_PLUGIN_HARNESS = 'packages/vscode-extension/test/devseek-real-plugin-deepseek-harness.mjs';
const CONTROLLED_SCENARIO_CONTRACT_TEST = 'packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs';

const FAILURE_ANALYSIS_REQUIRED = Object.freeze([
  'report.json',
  'run-log',
  'changedPaths',
  'terminal-settlement',
  'provider-classification',
  'generated-artifact-quality',
]);

const MATRIX_CASES = Object.freeze([
  {
    case_id: 'R4-HOLDOUT-ZH-DEEPSEEK-LOGIN-READY-AUDIT',
    locale: 'zh-CN',
    prompt_language: 'zh-CN',
    expected_artifact_language: 'zh-CN',
    task_family: 'deepseek-login-ready-state-audit',
    contract_summary: '中文输入要求生成 DeepSeek 登录就绪状态审计报告，输出必须保持中文。',
    acceptance_focus: [
      'login-ready-state-classification',
      'bridge-session-boundary',
      'selector-drift-diagnostics',
      'markdown-audit-report-quality',
    ],
  },
  {
    case_id: 'R4-HOLDOUT-EN-DEEPSEEK-LOGIN-READY-AUDIT',
    locale: 'en-US',
    prompt_language: 'en-US',
    expected_artifact_language: 'en-US',
    task_family: 'deepseek-login-ready-state-audit',
    contract_summary: 'English input asks for the same DeepSeek login-ready audit; output must remain English.',
    acceptance_focus: [
      'login-ready-state-classification',
      'bridge-session-boundary',
      'selector-drift-diagnostics',
      'markdown-audit-report-quality',
    ],
  },
  {
    case_id: 'R4-HOLDOUT-ZH-SCOPED-SOURCE-WRITE-AUTHORITY',
    locale: 'zh-CN',
    prompt_language: 'zh-CN',
    expected_artifact_language: 'zh-CN',
    task_family: 'scoped-source-write-authority',
    contract_summary: '中文任务禁止修改源码但允许指定 Markdown 交付物；输出和报告保持中文。',
    acceptance_focus: [
      'scoped-write-authority',
      'source-edit-revocation-not-global-write-revocation',
      'single-markdown-deliverable',
      'terminal-settlement-completed',
    ],
  },
  {
    case_id: 'R4-HOLDOUT-EN-SCOPED-SOURCE-WRITE-AUTHORITY',
    locale: 'en-US',
    prompt_language: 'en-US',
    expected_artifact_language: 'en-US',
    task_family: 'scoped-source-write-authority',
    contract_summary: 'English task forbids source edits but permits the requested Markdown deliverable; output remains English.',
    acceptance_focus: [
      'scoped-write-authority',
      'source-edit-revocation-not-global-write-revocation',
      'single-markdown-deliverable',
      'terminal-settlement-completed',
    ],
  },
  {
    case_id: 'R4-HOLDOUT-ZH-MIXED-PATH-INPUT-OUTPUT-CONTRACT',
    locale: 'zh-CN',
    prompt_language: 'zh-CN-with-English-identifiers',
    expected_artifact_language: 'zh-CN',
    task_family: 'required-deliverable-input-output-contract',
    contract_summary: '中文 prompt 可包含英文路径、selector 和代码标识符；输出语言仍由 scenario contract 指定为中文。',
    acceptance_focus: [
      'input-source-path-not-output-target',
      'required-deliverable-target-only',
      'scenario-language-over-product-default',
      'artifact-quality-by-contract',
    ],
  },
]);

export function r4LiveUserWayHoldoutMatrixHash(matrix) {
  return sha256Object(withoutKeys(matrix, ['matrix_sha256']), matrix?.integrity);
}

export function buildR4LiveUserWayHoldoutMatrix({ repoRoot } = {}) {
  if (!repoRoot) throw new Error('repoRoot is required');

  const requestPacket = readJson(path.join(repoRoot, REQUEST_PACKET));
  const cases = MATRIX_CASES.map(entry => ({
    ...entry,
    provider: 'deepseek-web',
    execution_mode: 'headed',
    keep_window: true,
    keep_deepseek_page: true,
    user_authorization_required: true,
    clean_runtime_identity_required: true,
    scenario_language_source: 'scenario-contract',
    product_fixed_language_allowed: false,
    terminal_state: 'BLOCKED_NOT_AUTHORIZED',
    command_template: 'npm run test:real-plugin-deepseek --workspace=packages/vscode-extension -- --run --headed --keep-window --keep-deepseek-page --scenario <scenario-id> --timeout-ms 240000',
    failure_analysis_required: [...FAILURE_ANALYSIS_REQUIRED],
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
  }));
  const locales = [...new Set(cases.map(entry => entry.locale))].sort();

  const matrix = {
    schema_version: R4_LIVE_USER_WAY_HOLDOUT_MATRIX_SCHEMA_VERSION,
    integrity: SUPPORTED_INTEGRITY,
    matrix_id: R4_LIVE_USER_WAY_HOLDOUT_MATRIX_ID,
    matrix_version: 1,
    source_status: 'generated-holdout-matrix-only',
    integrity_scope: R4_LIVE_USER_WAY_HOLDOUT_MATRIX_SCOPE,
    qualification_eligible: false,
    qualification_effect: 'NONE',
    claims_permitted: false,
    asserts_gate_pass: false,
    observation_authority: {
      semantic_authority: 'R4LiveUserWayHoldoutMatrix',
      writes_product_state: false,
      provider_actions: 'FORBIDDEN',
      live_holdout_actions: 'FORBIDDEN',
      runtime_process_observation: 'FORBIDDEN',
      install_or_window_actions: 'FORBIDDEN',
      secret_observation: 'FORBIDDEN',
    },
    source_bindings: {
      live_qualification_request_packet: sourceBinding(repoRoot, REQUEST_PACKET, {
        packet_sha256: requestPacket.packet_sha256,
        live_runs_authorized: requestPacket.counts.live_runs_authorized,
        request_terminal_state: requestPacket.requests.every(request => request.terminal_state === 'BLOCKED') ? 'ALL_BLOCKED' : 'DRIFTED',
      }),
      real_plugin_harness: sourceBinding(repoRoot, REAL_PLUGIN_HARNESS),
      controlled_scenario_contract_oracle: sourceBinding(repoRoot, CONTROLLED_SCENARIO_CONTRACT_TEST),
    },
    matrix_policy: {
      provider: 'deepseek-web',
      execution_mode: 'headed',
      keep_window: true,
      keep_deepseek_page: true,
      live_runs_authorized: 0,
      user_authorization_required_before_run: true,
      clean_runtime_identity_required_before_run: true,
      scenario_language_source: 'scenario-contract',
      product_fixed_language_allowed: false,
      repeat_red_loop_without_analysis_allowed: false,
      failure_analysis_required: [...FAILURE_ANALYSIS_REQUIRED],
    },
    cases,
    counts: {
      cases: cases.length,
      locales: locales.length,
      blocked_cases: cases.filter(entry => entry.terminal_state === 'BLOCKED_NOT_AUTHORIZED').length,
      live_runs_authorized: 0,
      product_fixed_language_cases: cases.filter(entry => entry.product_fixed_language_allowed).length,
      qualification_claims: 0,
    },
    matrix_sha256: '',
  };

  matrix.matrix_sha256 = r4LiveUserWayHoldoutMatrixHash(matrix);
  return matrix;
}

export function validateR4LiveUserWayHoldoutMatrix(matrix, { repoRoot } = {}) {
  const errors = [];
  if (!isObject(matrix)) {
    return {
      ok: false,
      errors: ['matrix:expected-object'],
      summary: null,
    };
  }

  semanticValidate(matrix, errors);

  let expected = null;
  try {
    expected = buildR4LiveUserWayHoldoutMatrix({ repoRoot });
  } catch (error) {
    errors.push(`source:build:${error.message}`);
  }

  if (expected && canonicalJson(matrix) !== canonicalJson(expected)) {
    errors.push('matrix:expected-current-holdout-source-binding');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: expected ? summarizeR4LiveUserWayHoldoutMatrix(expected) : null,
  };
}

export function renderR4LiveUserWayHoldoutMatrixMarkdown(matrix) {
  const lines = [
    '# DevSeek R4 Live User-Way Holdout Matrix',
    '',
    '## 摘要',
    '',
    `- Matrix ID: \`${matrix.matrix_id}\``,
    `- Source status: \`${matrix.source_status}\``,
    `- Qualification effect: \`${matrix.qualification_effect}\``,
    `- Claims permitted: \`${matrix.claims_permitted}\``,
    `- Gate assertion: \`${matrix.asserts_gate_pass}\``,
    '',
    '## 执行策略',
    '',
    `- Provider: \`${matrix.matrix_policy.provider}\``,
    `- Mode: \`${matrix.matrix_policy.execution_mode}\``,
    `- Keep window/page: \`${matrix.matrix_policy.keep_window}/${matrix.matrix_policy.keep_deepseek_page}\``,
    `- Live runs authorized: \`${matrix.matrix_policy.live_runs_authorized}\``,
    `- Scenario language source: \`${matrix.matrix_policy.scenario_language_source}\``,
    `- Product fixed language allowed: \`${matrix.matrix_policy.product_fixed_language_allowed}\``,
    '',
    '## Holdout Cases',
    '',
    '| Case | Locale | Expected Language | State | Focus |',
    '| --- | --- | --- | --- | --- |',
    ...matrix.cases.map(entry => (
      `| \`${entry.case_id}\` | \`${entry.locale}\` | \`${entry.expected_artifact_language}\` | \`${entry.terminal_state}\` | ${entry.acceptance_focus.join(', ')} |`
    )),
    '',
    '## Failure Analysis Before Rerun',
    '',
    matrix.matrix_policy.failure_analysis_required.map(item => `- \`${item}\``).join('\n'),
    '',
    '## Matrix Identity',
    '',
    `- Matrix SHA-256: \`${matrix.matrix_sha256}\``,
    '',
  ];
  return `${lines.join('\n').replace(/\n+$/u, '')}\n`;
}

export function summarizeR4LiveUserWayHoldoutMatrix(matrix) {
  return {
    matrix_sha256: matrix.matrix_sha256,
    cases: matrix.counts.cases,
    locales: matrix.counts.locales,
    blocked_cases: matrix.counts.blocked_cases,
    live_runs_authorized: matrix.counts.live_runs_authorized,
    product_fixed_language_cases: matrix.counts.product_fixed_language_cases,
    scenario_language_source: matrix.matrix_policy.scenario_language_source,
    qualification_effect: matrix.qualification_effect,
    claims_permitted: matrix.claims_permitted,
    asserts_gate_pass: matrix.asserts_gate_pass,
  };
}

function semanticValidate(matrix, errors) {
  if (matrix.schema_version !== R4_LIVE_USER_WAY_HOLDOUT_MATRIX_SCHEMA_VERSION) errors.push('schema_version:invalid');
  if (matrix.matrix_id !== R4_LIVE_USER_WAY_HOLDOUT_MATRIX_ID) errors.push('matrix_id:invalid');
  if (matrix.matrix_version !== 1) errors.push('matrix_version:must-be-1');
  if (matrix.source_status !== 'generated-holdout-matrix-only') errors.push('source_status:invalid');
  if (matrix.integrity_scope !== R4_LIVE_USER_WAY_HOLDOUT_MATRIX_SCOPE) errors.push('integrity_scope:invalid');
  if (matrix.qualification_eligible !== false) errors.push('qualification_eligible:must-be-false');
  if (matrix.qualification_effect !== 'NONE') errors.push('qualification_effect:must-be-NONE');
  if (matrix.claims_permitted !== false) errors.push('claims_permitted:must-be-false');
  if (matrix.asserts_gate_pass !== false) errors.push('asserts_gate_pass:must-be-false');
  if (matrix.observation_authority?.semantic_authority !== 'R4LiveUserWayHoldoutMatrix') {
    errors.push('observation_authority.semantic_authority:invalid');
  }
  if (matrix.observation_authority?.writes_product_state !== false) {
    errors.push('observation_authority.writes_product_state:must-be-false');
  }
  for (const field of ['provider_actions', 'live_holdout_actions', 'runtime_process_observation', 'install_or_window_actions', 'secret_observation']) {
    if (matrix.observation_authority?.[field] !== 'FORBIDDEN') {
      errors.push(`observation_authority.${field}:must-be-FORBIDDEN`);
    }
  }
  const policy = matrix.matrix_policy;
  if (policy?.execution_mode !== 'headed') errors.push('matrix_policy.execution_mode:must-be-headed');
  if (policy?.keep_window !== true || policy?.keep_deepseek_page !== true) errors.push('matrix_policy.keep-window-page:must-be-true');
  if (policy?.live_runs_authorized !== 0) errors.push('matrix_policy.live_runs_authorized:must-be-0');
  if (policy?.scenario_language_source !== 'scenario-contract') errors.push('matrix_policy.scenario_language_source:must-be-scenario-contract');
  if (policy?.product_fixed_language_allowed !== false) errors.push('matrix_policy.product_fixed_language_allowed:must-be-false');
  if (policy?.repeat_red_loop_without_analysis_allowed !== false) errors.push('matrix_policy.repeat_red_loop_without_analysis_allowed:must-be-false');
  const locales = new Set();
  for (const entry of matrix.cases ?? []) {
    locales.add(entry.locale);
    if (entry.expected_artifact_language !== normalizeExpectedLanguage(entry.prompt_language, entry.expected_artifact_language)) {
      errors.push(`cases.${entry.case_id}.expected_artifact_language:invalid`);
    }
    if (entry.scenario_language_source !== 'scenario-contract') errors.push(`cases.${entry.case_id}.scenario_language_source:must-be-scenario-contract`);
    if (entry.product_fixed_language_allowed !== false) errors.push(`cases.${entry.case_id}.product_fixed_language_allowed:must-be-false`);
    if (entry.terminal_state !== 'BLOCKED_NOT_AUTHORIZED') errors.push(`cases.${entry.case_id}.terminal_state:must-be-BLOCKED_NOT_AUTHORIZED`);
    if (entry.qualification_effect !== 'NONE') errors.push(`cases.${entry.case_id}.qualification_effect:must-be-NONE`);
    if (entry.claims_permitted !== false) errors.push(`cases.${entry.case_id}.claims_permitted:must-be-false`);
    if (entry.asserts_gate_pass !== false) errors.push(`cases.${entry.case_id}.asserts_gate_pass:must-be-false`);
    for (const required of FAILURE_ANALYSIS_REQUIRED) {
      if (!entry.failure_analysis_required?.includes(required)) {
        errors.push(`cases.${entry.case_id}.failure_analysis_required:missing-${required}`);
      }
    }
  }
  if (!locales.has('zh-CN')) errors.push('cases.locale:missing-zh-CN');
  if (!locales.has('en-US')) errors.push('cases.locale:missing-en-US');
  if (matrix.counts?.cases !== MATRIX_CASES.length) errors.push('counts.cases:invalid');
  if (matrix.counts?.blocked_cases !== MATRIX_CASES.length) errors.push('counts.blocked_cases:invalid');
  if (matrix.counts?.live_runs_authorized !== 0) errors.push('counts.live_runs_authorized:must-be-0');
  if (matrix.counts?.product_fixed_language_cases !== 0) errors.push('counts.product_fixed_language_cases:must-be-0');
  if (matrix.counts?.qualification_claims !== 0) errors.push('counts.qualification_claims:must-be-0');
  const computedHash = r4LiveUserWayHoldoutMatrixHash(matrix);
  if (!/^[a-f0-9]{64}$/u.test(matrix.matrix_sha256 ?? '')) {
    errors.push('matrix_sha256:invalid');
  } else if (matrix.matrix_sha256 !== computedHash) {
    errors.push('matrix_sha256:mismatch');
  }
}

function normalizeExpectedLanguage(promptLanguage, expectedLanguage) {
  if (promptLanguage === 'zh-CN-with-English-identifiers') return 'zh-CN';
  return expectedLanguage;
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
