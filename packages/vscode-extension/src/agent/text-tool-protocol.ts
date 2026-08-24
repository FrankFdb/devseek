import * as crypto from 'crypto';
import {
  analyzeFakeToolCallProtocol,
  parseFakeToolCalls,
  type FakeTool,
} from './fake-tool-parser';

export const TEXT_TOOL_PROTOCOL_VERSION = 'devseek.text-tools/v1' as const;

export interface TextToolProtocolSession {
  readonly version: typeof TEXT_TOOL_PROTOCOL_VERSION;
  readonly channelId: string;
}

export interface QuarantinedTextToolProtocol {
  readonly found: boolean;
  readonly dialects: readonly string[];
}

export interface InvalidAuthorizedTextToolProtocol {
  readonly found: boolean;
  readonly envelopeCount: number;
  readonly invalidEnvelopeCount: number;
}

const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{16,96}$/;

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
  return extractAuthorizedTextToolPayloads(text, session)
    .flatMap(payload => parseFakeToolCalls(payload));
}

/** Detects executable-looking provider output without granting it tool authority. */
export function inspectOutOfEnvelopeTextToolProtocol(
  text: string,
  session: TextToolProtocolSession | undefined,
): QuarantinedTextToolProtocol {
  const outsideAuthorizedEnvelopes = stripAuthorizedTextToolEnvelopes(text, session);
  const analysis = analyzeFakeToolCallProtocol(outsideAuthorizedEnvelopes);
  const dialects = [...new Set(
    analysis.matches
      .filter(match => match.tools.length > 0)
      .map(match => match.dialect),
  )];
  return Object.freeze({
    found: dialects.length > 0,
    dialects: Object.freeze(dialects),
  });
}

/** Rejects authenticated envelopes that do not contain any recognized tool. */
export function inspectInvalidAuthorizedTextToolProtocol(
  text: string,
  session: TextToolProtocolSession | undefined,
): InvalidAuthorizedTextToolProtocol {
  if (!session) {
    return Object.freeze({ found: false, envelopeCount: 0, invalidEnvelopeCount: 0 });
  }
  const payloads = extractAuthorizedTextToolPayloads(text, session);
  const invalidEnvelopeCount = payloads.filter(payload => parseFakeToolCalls(payload).length === 0).length;
  return Object.freeze({
    found: invalidEnvelopeCount > 0,
    envelopeCount: payloads.length,
    invalidEnvelopeCount,
  });
}

export function extractAuthorizedTextToolPayloads(
  text: string,
  session: TextToolProtocolSession,
): string[] {
  const raw = String(text || '');
  const open = openMarker(session);
  const close = closeMarker(session);
  const payloads: string[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(open, cursor);
    if (start < 0) break;
    const payloadStart = start + open.length;
    const envelopeClose = findEnvelopeClose(raw, payloadStart, close);
    if (!envelopeClose) break;
    payloads.push(raw.slice(payloadStart, envelopeClose.start).trim());
    cursor = envelopeClose.end;
  }
  return payloads;
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
