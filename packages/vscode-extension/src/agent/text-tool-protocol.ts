import * as crypto from 'crypto';
import { codingSemanticDigest, getCodingToolDescriptor } from '@devseek-netai/shared';
import {
  analyzeFakeToolCallProtocol,
  parseFakeToolCalls,
  type FakeTool,
} from './fake-tool-parser';
import { inspectProviderTextToolTranscript } from './provider-text-tool-transcript';
import { findJsonObjectEnd } from './loose-json-text';

export const TEXT_TOOL_PROTOCOL_VERSION = 'devseek.text-tools/v1' as const;

export interface TextToolProtocolSession {
  readonly version: typeof TEXT_TOOL_PROTOCOL_VERSION;
  readonly channelId: string;
}

export interface QuarantinedTextToolProtocol {
  readonly found: boolean;
  readonly dialects: readonly string[];
  /** Registered names are recovery hints only; their arguments remain untrusted. */
  readonly observedToolNames: readonly string[];
}

export interface InvalidAuthorizedTextToolProtocol {
  readonly found: boolean;
  readonly envelopeCount: number;
  readonly invalidEnvelopeCount: number;
  /** Registered names are recovery hints only; invalid arguments remain untrusted. */
  readonly observedToolNames: readonly string[];
}

export interface IncompleteAuthorizedTextToolProtocol {
  readonly found: boolean;
  /** Registered names are evidence of an unresolved proposal; their arguments remain untrusted. */
  readonly observedToolNames: readonly string[];
}

const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{16,96}$/;
const FILE_CONTENT_MUTATION_TOOLS = new Set([
  'create_file',
  'write_file',
  'replace_file',
  'replace_in_file',
]);

export function createTextToolProtocolSession(channelId = crypto.randomBytes(18).toString('base64url')): TextToolProtocolSession {
  if (!CHANNEL_ID_RE.test(channelId)) {
    throw new Error('text-tool-protocol:invalid-channel-id');
  }
  return Object.freeze({ version: TEXT_TOOL_PROTOCOL_VERSION, channelId });
}

export function renderTextToolProtocolEnvelope(
  session: TextToolProtocolSession,
  payload: string,
): string {
  return `${openMarker(session)}\n${payload.trim()}\n${closeMarker(session)}`;
}

export function parseAuthorizedTextToolCalls(
  text: string,
  session: TextToolProtocolSession | undefined,
): FakeTool[] {
  if (!session) return [];
  const completed = extractAuthorizedTextToolPayloads(text, session)
    .flatMap(parseAuthorizedTextToolPayload);
  if (completed.length > 0) {
    return hasIncompleteAuthorizedTextToolEnvelope(text, session) ? [] : completed;
  }
  return parseUnclosedAuthorizedObservationCalls(text, session);
}

/**
 * A Bridge response may omit only the outer close marker after finishing a
 * strict read-only batch. Recover that bounded observation without granting
 * mutation, process, network, or control authority to a truncated response.
 */
function parseUnclosedAuthorizedObservationCalls(
  text: string,
  session: TextToolProtocolSession,
): FakeTool[] {
  const raw = String(text || '');
  const open = openMarker(session);
  const start = raw.indexOf(open);
  if (start < 0 || raw.indexOf(open, start + open.length) >= 0) return [];
  if (findEnvelopeClose(raw, start + open.length, closeMarker(session))) return [];

  const tools = parseStrictBracketToolSequence(raw.slice(start + open.length));
  return tools.length > 0 && tools.every(isRecoverableObservationTool) ? tools : [];
}

function parseStrictBracketToolSequence(payload: string): FakeTool[] {
  const tools: FakeTool[] = [];
  let cursor = skipWhitespace(payload, 0);
  while (cursor < payload.length) {
    if (!payload.startsWith('[TOOL:', cursor)) return [];
    cursor += '[TOOL:'.length;
    const nameMatch = /^[A-Za-z0-9_]+/.exec(payload.slice(cursor));
    if (!nameMatch) return [];
    const name = nameMatch[0];
    cursor += name.length;
    if (!/\s/.test(payload[cursor] || '')) return [];
    cursor = skipWhitespace(payload, cursor);
    if (payload[cursor] !== '{') return [];
    const jsonEnd = findJsonObjectEnd(payload, cursor);
    if (jsonEnd < 0) return [];

    let input: unknown;
    try {
      input = JSON.parse(payload.slice(cursor, jsonEnd + 1));
    } catch {
      return [];
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
    cursor = skipWhitespace(payload, jsonEnd + 1);
    if (payload[cursor] !== ']') return [];
    tools.push(Object.freeze({
      name,
      input: Object.freeze(input as Record<string, unknown>),
    }));
    if (tools.length > 16) return [];
    cursor = skipWhitespace(payload, cursor + 1);
  }
  return tools;
}

function isRecoverableObservationTool(tool: FakeTool): boolean {
  const descriptor = getCodingToolDescriptor(tool.name);
  return Boolean(
    descriptor
    && ['read', 'search', 'diagnostics', 'memory'].includes(descriptor.kind)
    && descriptor.effects.length > 0
    && descriptor.effects.every(effect => effect === 'read'),
  );
}

function skipWhitespace(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

/** Detects executable-looking provider output without granting it tool authority. */
export function inspectOutOfEnvelopeTextToolProtocol(
  text: string,
  session: TextToolProtocolSession | undefined,
): QuarantinedTextToolProtocol {
  const outsideAuthorizedEnvelopes = stripAuthorizedTextToolEnvelopes(text, session);
  const analysis = analyzeFakeToolCallProtocol(outsideAuthorizedEnvelopes);
  const actionableMatches = analysis.matches.filter(match => match.tools.length > 0);
  const transcript = inspectProviderTextToolTranscript(outsideAuthorizedEnvelopes);
  const dialects = [...new Set([
    ...actionableMatches.map(match => match.dialect),
    ...(transcript.found ? ['provider-text-content-block'] : []),
  ])];
  const observedToolNames = observeUntrustedToolNames(
    outsideAuthorizedEnvelopes,
    analysis,
    transcript,
  );
  return Object.freeze({
    found: dialects.length > 0,
    dialects: Object.freeze(dialects),
    observedToolNames: Object.freeze(observedToolNames),
  });
}

/** Rejects authenticated envelopes that do not contain a safely executable tool. */
export function inspectInvalidAuthorizedTextToolProtocol(
  text: string,
  session: TextToolProtocolSession | undefined,
): InvalidAuthorizedTextToolProtocol {
  if (!session) {
    return Object.freeze({
      found: false,
      envelopeCount: 0,
      invalidEnvelopeCount: 0,
      observedToolNames: Object.freeze([]),
    });
  }
  const payloads = extractAuthorizedTextToolPayloads(text, session);
  const invalidPayloads = payloads.filter(payload => parseAuthorizedTextToolPayload(payload).length === 0);
  const observedToolNames = [...new Set(
    invalidPayloads.flatMap(payload => observeUntrustedToolNames(payload)),
  )];
  return Object.freeze({
    found: invalidPayloads.length > 0,
    envelopeCount: payloads.length,
    invalidEnvelopeCount: invalidPayloads.length,
    observedToolNames: Object.freeze(observedToolNames),
  });
}

/**
 * Preserves only observable action names from a current-channel envelope whose
 * payload never closed. Parameters remain quarantined and unexecutable.
 */
export function inspectIncompleteAuthorizedTextToolProtocol(
  text: string,
  session: TextToolProtocolSession | undefined,
): IncompleteAuthorizedTextToolProtocol {
  if (!session) return Object.freeze({ found: false, observedToolNames: Object.freeze([]) });
  const raw = String(text || '');
  const open = openMarker(session);
  const close = closeMarker(session);
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(open, cursor);
    if (start < 0) break;
    const payloadStart = start + open.length;
    const envelopeClose = findEnvelopeClose(raw, payloadStart, close);
    if (!envelopeClose) {
      return Object.freeze({
        found: true,
        observedToolNames: Object.freeze(observeUntrustedToolNames(raw.slice(payloadStart))),
      });
    }
    cursor = envelopeClose.end;
  }
  return Object.freeze({ found: false, observedToolNames: Object.freeze([]) });
}

/**
 * Compatibility parsers may recognize malformed provider JSON for quarantine and
 * transcript cleanup. File mutations need a lossless serialization before they
 * can cross the execution boundary: strict JSON or one fenced CDATA XML call.
 */
function parseAuthorizedTextToolPayload(payload: string): FakeTool[] {
  const tools = parseFakeToolCalls(payload);
  const mutations = tools.filter(tool => FILE_CONTENT_MUTATION_TOOLS.has(tool.name));
  if (mutations.length === 0) return tools;

  const analysis = analyzeFakeToolCallProtocol(payload);
  const losslessIdentities = new Set(
    analysis.matches
      .filter(match => match.dialect === 'bare-json-tool-call')
      .flatMap(match => match.tools)
      .filter(tool => FILE_CONTENT_MUTATION_TOOLS.has(tool.name))
      .map(toolIdentity),
  );
  for (const identity of strictJsonXmlMutationIdentities(payload)) {
    losslessIdentities.add(identity);
  }
  for (const identity of losslessFencedXmlMutationIdentities(payload)) {
    losslessIdentities.add(identity);
  }

  return mutations.every(tool => losslessIdentities.has(toolIdentity(tool))) ? tools : [];
}

function strictJsonXmlMutationIdentities(payload: string): string[] {
  const identities: string[] = [];
  const mutationNames = [...FILE_CONTENT_MUTATION_TOOLS].map(escapeRegExp).join('|');
  const pairedTool = new RegExp(
    `<\\s*(${mutationNames})\\b[^>]*>([\\s\\S]*?)<\\/\\s*\\1\\s*>`,
    'gi',
  );
  let match: RegExpExecArray | null;
  while ((match = pairedTool.exec(payload)) !== null) {
    const name = match[1].toLowerCase();
    const body = String(match[2] || '').trim();
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const tools = parseFakeToolCalls(`${name} ${body}`);
      if (tools.length === 1 && tools[0].name === name) identities.push(toolIdentity(tools[0]));
    } catch { /* Mutation authority requires strict, lossless JSON. */ }
  }
  return identities;
}

function losslessFencedXmlMutationIdentities(payload: string): string[] {
  const identities: string[] = [];
  const fencedXml = /```(?:xml)?[ \t]*\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fencedXml.exec(payload)) !== null) {
    const block = match[1] || '';
    const mutations = parseFakeToolCalls(block)
      .filter(tool => FILE_CONTENT_MUTATION_TOOLS.has(tool.name));
    if (mutations.length !== 1 || !hasRequiredCdataParameters(block, mutations[0].name)) continue;
    identities.push(toolIdentity(mutations[0]));
  }
  return identities;
}

function hasRequiredCdataParameters(block: string, toolName: string): boolean {
  const escapedName = escapeRegExp(toolName);
  const outer = new RegExp(
    `<\\s*${escapedName}\\b[^>]*>([\\s\\S]*?)<\\/\\s*${escapedName}\\s*>`,
    'i',
  ).exec(block);
  if (!outer) return false;
  const body = outer[1] || '';
  if (toolName === 'replace_in_file') {
    return hasCdataField(body, ['old_str', 'oldString', 'old_string', 'oldText', 'old_text'])
      && hasCdataField(body, ['new_str', 'newString', 'new_string', 'newText', 'new_text']);
  }
  return hasCdataField(body, [
    'content', 'contents', 'text', 'body', 'fileContent', 'file_content',
    'source', 'code', 'newContent', 'new_content',
  ]);
}

function hasCdataField(body: string, names: readonly string[]): boolean {
  const pattern = names.map(escapeRegExp).join('|');
  return new RegExp(
    `<\\s*(?:${pattern})\\b[^>]*>\\s*<!\\[CDATA\\[[\\s\\S]*?\\]\\]>\\s*<\\/\\s*(?:${pattern})\\s*>`,
    'i',
  ).test(body);
}

function toolIdentity(tool: FakeTool): string {
  return codingSemanticDigest({ name: tool.name, input: tool.input });
}

function observeUntrustedToolNames(
  text: string,
  analysis = analyzeFakeToolCallProtocol(text),
  transcript = inspectProviderTextToolTranscript(text),
): string[] {
  return [...new Set([
    ...analysis.matches.flatMap(match => match.tools.map(tool => tool.name)),
    ...transcript.observedToolNames,
  ])];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractAuthorizedTextToolPayloads(
  text: string,
  session: TextToolProtocolSession,
): string[] {
  const payloads: string[] = [];
  scanCompletedAuthorizedTextToolEnvelopes(text, session, (raw, start, end) => {
    payloads.push(raw.slice(start, end).trim());
  });
  return payloads;
}

/** Cheap streaming signal: full protocol parsing is only useful after a new envelope closes. */
export function countCompletedAuthorizedTextToolEnvelopes(
  text: string,
  session: TextToolProtocolSession | undefined,
): number {
  return session ? scanCompletedAuthorizedTextToolEnvelopes(text, session) : 0;
}

function scanCompletedAuthorizedTextToolEnvelopes(
  text: string,
  session: TextToolProtocolSession,
  visitPayload?: (raw: string, start: number, end: number) => void,
): number {
  const raw = String(text || '');
  const open = openMarker(session);
  const close = closeMarker(session);
  let count = 0;
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(open, cursor);
    if (start < 0) break;
    const payloadStart = start + open.length;
    const envelopeClose = findEnvelopeClose(raw, payloadStart, close);
    if (!envelopeClose) break;
    visitPayload?.(raw, payloadStart, envelopeClose.start);
    count++;
    cursor = envelopeClose.end;
  }
  return count;
}

export function findFirstAuthorizedTextToolEnvelopeStart(
  text: string,
  session: TextToolProtocolSession | undefined,
): number {
  if (!session) return -1;
  return String(text || '').indexOf(openMarker(session));
}

export function stripAuthorizedTextToolEnvelopes(
  text: string,
  session: TextToolProtocolSession | undefined,
): string {
  if (!session) return String(text || '');
  const raw = String(text || '');
  const open = openMarker(session);
  const close = closeMarker(session);
  let cursor = 0;
  let visible = '';
  while (cursor < raw.length) {
    const start = raw.indexOf(open, cursor);
    if (start < 0) {
      visible += raw.slice(cursor);
      break;
    }
    const envelopeClose = findEnvelopeClose(raw, start + open.length, close);
    if (!envelopeClose) {
      visible += raw.slice(cursor, start);
      break;
    }
    visible += raw.slice(cursor, start);
    cursor = envelopeClose.end;
  }
  return visible.replace(/\n{3,}/g, '\n\n');
}

export function hasIncompleteAuthorizedTextToolEnvelope(
  text: string,
  session: TextToolProtocolSession | undefined,
): boolean {
  if (!session) return false;
  const raw = String(text || '');
  const open = openMarker(session);
  const close = closeMarker(session);
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(open, cursor);
    if (start < 0) return false;
    const envelopeClose = findEnvelopeClose(raw, start + open.length, close);
    if (!envelopeClose) return true;
    cursor = envelopeClose.end;
  }
  return false;
}

function openMarker(session: TextToolProtocolSession): string {
  return `<devseek_tool_calls version="${session.version}" channel="${session.channelId}">`;
}

function closeMarker(session: TextToolProtocolSession): string {
  return `</devseek_tool_calls channel="${session.channelId}">`;
}

function findEnvelopeClose(
  text: string,
  from: number,
  canonicalClose: string,
): { start: number; end: number } | undefined {
  const compatibleClose = '</devseek_tool_calls>';
  const candidates = [canonicalClose, compatibleClose]
    .map(marker => ({ marker, start: text.indexOf(marker, from) }))
    .filter(candidate => candidate.start >= 0)
    .sort((left, right) => left.start - right.start);
  const first = candidates[0];
  return first ? { start: first.start, end: first.start + first.marker.length } : undefined;
}
