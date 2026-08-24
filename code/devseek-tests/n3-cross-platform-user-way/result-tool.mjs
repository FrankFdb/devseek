#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  buildResultTemplate,
  packetSha256,
  sealEvidenceHashes,
  validatePacket,
  verifyResult,
  verifyResultMatrix,
} from './result-contract.mjs';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const packetPath = path.join(toolRoot, 'cases.json');
const schemaPath = path.join(toolRoot, 'result.schema.json');
const packet = readJson(packetPath);
const packetHash = packetSha256(packetPath);
const packetErrors = validatePacket(packet);
if (packetErrors.length > 0) fail('packet-invalid', packetErrors);

const [command, ...args] = process.argv.slice(2);
const options = parseOptions(args);

if (command === 'packet') {
  assertAllowedOptions(options, []);
  print({
    ok: true,
    packet_id: packet.packet_id,
    packet_sha256: packetHash,
    candidate: packet.candidate,
    platform_profiles: packet.platform_profiles,
    cases: packet.cases.map(item => item.case_id),
    qualification_effect: 'NONE',
  });
} else if (command === 'init') {
  assertAllowedOptions(options, ['--platform', '--output', '--run-id']);
  const platform = requireOption(options, '--platform');
  const output = path.resolve(requireOption(options, '--output'));
  const runId = options.get('--run-id') || defaultRunId(platform);
  if (fs.existsSync(output)) fail('output-exists', [output]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeJsonAtomic(output, buildResultTemplate(packet, packetHash, platform, runId));
  print({ ok: true, command, output, run_id: runId, platform_profile: platform, packet_sha256: packetHash });
} else if (command === 'seal') {
  assertAllowedOptions(options, ['--result']);
  const resultPath = path.resolve(requireOption(options, '--result'));
  const result = readJson(resultPath);
  writeJsonAtomic(resultPath, sealEvidenceHashes(result, resultPath));
  print({ ok: true, command, result: resultPath, evidence_hashes_updated: true });
} else if (command === 'verify') {
  assertAllowedOptions(options, ['--result']);
  const resultPath = path.resolve(requireOption(options, '--result'));
  const result = readJson(resultPath);
  const validateSchema = compileSchema();
  const verification = verifyResult({ packet, packetHash, result, resultPath, validateSchema });
  print(verification);
  process.exitCode = verification.accepted ? 0 : 1;
} else if (command === 'matrix') {
  assertAllowedOptions(options, ['--root']);
  const resultRoot = path.resolve(requireOption(options, '--root'));
  const validateSchema = compileSchema();
  const entries = findMatrixResultPaths(resultRoot).map(resultPath => {
    const result = readJson(resultPath);
    return {
      resultPath,
      verification: verifyResult({ packet, packetHash, result, resultPath, validateSchema }),
    };
  });
  const verification = verifyResultMatrix(packet, entries);
  print(verification);
  process.exitCode = verification.accepted ? 0 : 1;
} else {
  fail('usage', [
    'result-tool.mjs packet',
    'result-tool.mjs init --platform <profile-id> --output <result.json> [--run-id <id>]',
    'result-tool.mjs seal --result <result.json>',
    'result-tool.mjs verify --result <result.json>',
    'result-tool.mjs matrix --root <directory-containing-run-directories>',
  ]);
}

function compileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(readJson(schemaPath));
}

function parseOptions(values) {
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) fail('argument-invalid', [String(key)]);
    if (options.has(key)) fail('argument-duplicate', [key]);
    options.set(key, value);
  }
  return options;
}

function requireOption(options, name) {
  const value = options.get(name);
  if (!value) fail('argument-required', [name]);
  return value;
}

function assertAllowedOptions(options, allowed) {
  const allowedSet = new Set(allowed);
  const unknown = [...options.keys()].filter(key => !allowedSet.has(key));
  if (unknown.length > 0) fail('argument-unsupported', unknown);
}

function defaultRunId(platform) {
  return `n3-${platform}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

function findMatrixResultPaths(root) {
  if (!fs.statSync(root).isDirectory()) fail('matrix-root-not-directory', [root]);
  const paths = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const resultPath = path.join(root, entry.name, 'result.json');
    if (fs.existsSync(resultPath) && fs.statSync(resultPath).isFile()) paths.push(resultPath);
  }
  return paths.sort();
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, filePath);
}

function print(value) {
  console.log(JSON.stringify(value, null, 2));
}

function fail(reason, errors) {
  print({ ok: false, reason, errors });
  process.exit(1);
}
