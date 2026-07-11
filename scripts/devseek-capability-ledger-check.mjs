#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  buildMilestoneManifest,
  readJson,
  renderCapabilityLedgerMarkdown,
  renderMilestoneManifestMarkdown,
  validateCapabilityLedger,
  validateLocalSourceRefs,
  validateMilestoneProfiles,
} from './lib/devseek-capability-ledger.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const write = process.argv.includes('--write');
const paths = {
  ledger: path.join(repoRoot, 'docs/process/devseek-capability-ledger.json'),
  ledgerSchema: path.join(repoRoot, 'docs/process/devseek-capability-ledger.schema.json'),
  profiles: path.join(repoRoot, 'docs/process/devseek-milestone-profiles.json'),
  profilesSchema: path.join(repoRoot, 'docs/process/devseek-milestone-profiles.schema.json'),
  manifestSchema: path.join(repoRoot, 'docs/process/devseek-capability-work-manifest.schema.json'),
  ledgerView: path.join(repoRoot, 'docs/process/generated/devseek-capability-ledger.md'),
  r1Manifest: path.join(repoRoot, 'docs/process/generated/r1-minimal-capability-manifest.json'),
  r1View: path.join(repoRoot, 'docs/process/generated/r1-minimal-capability-manifest.md'),
};

const ledger = readJson(paths.ledger);
const profilesDocument = readJson(paths.profiles);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const errors = [
  ...validateWithSchema(ajv, readJson(paths.ledgerSchema), ledger, 'capability-ledger'),
  ...validateWithSchema(ajv, readJson(paths.profilesSchema), profilesDocument, 'milestone-profiles'),
];
const ledgerResult = validateCapabilityLedger(ledger, {
  expectedCount: 76,
  expectedDependencyEdges: 138,
});
const profileResult = validateMilestoneProfiles(profilesDocument, ledger);
const sourceRefResult = validateLocalSourceRefs(ledger, repoRoot);
errors.push(...ledgerResult.errors, ...profileResult.errors, ...sourceRefResult.errors);
let manifest;

if (errors.length === 0) {
  const profile = profilesDocument.profiles.find(item => item.profile_id === 'R1-MINIMAL-SEAM/v1');
  if (!profile) errors.push('profiles:missing-R1-MINIMAL-SEAM/v1');
  else {
    try {
      manifest = buildMilestoneManifest(ledger, profile, profilesDocument.claim_profiles);
    } catch (error) {
      errors.push(String(error?.message || error));
    }
  }
}

if (manifest) {
  errors.push(...validateWithSchema(ajv, readJson(paths.manifestSchema), manifest, 'work-manifest'));
  const generated = new Map([
    [paths.ledgerView, renderCapabilityLedgerMarkdown(ledger)],
    [paths.r1Manifest, `${JSON.stringify(manifest, null, 2)}\n`],
    [paths.r1View, renderMilestoneManifestMarkdown(manifest)],
  ]);
  for (const [filePath, expected] of generated) {
    if (write) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, expected, 'utf8');
      continue;
    }
    if (!fs.existsSync(filePath)) errors.push(`generated:missing-${path.relative(repoRoot, filePath)}`);
    else if (fs.readFileSync(filePath, 'utf8') !== expected) errors.push(`generated:stale-${path.relative(repoRoot, filePath)}`);
  }
}

const report = {
  ok: errors.length === 0,
  ledger: ledgerResult.summary,
  profiles: profileResult.summary,
  r1: manifest ? manifest.counts : null,
  errors,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

function validateWithSchema(ajv, schema, value, label) {
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    return [`schema:${label}:compile:${error.message}`];
  }
  if (validate(value)) return [];
  return (validate.errors ?? []).map(error => (
    `schema:${label}:${error.instancePath || '/'}:${error.message}`
  ));
}
