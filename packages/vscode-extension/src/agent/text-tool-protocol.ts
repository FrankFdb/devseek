import * as crypto from 'crypto';
import { parseFakeToolCalls, type FakeTool } from './fake-tool-parser';

export const TEXT_TOOL_PROTOCOL_VERSION = 'devseek.text-tools/v1' as const;

export interface TextToolProtocolSession {
  readonly version: typeof TEXT_TOOL_PROTOCOL_VERSION;
  readonly channelId: string;
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
    const end = raw.indexOf(close, payloadStart);
    if (end < 0) break;
    payloads.push(raw.slice(payloadStart, end).trim());
    cursor = end + close.length;
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
    const end = raw.indexOf(close, start + open.length);
    if (end < 0) {
      visible += raw.slice(cursor, start);
      break;
    }
    visible += raw.slice(cursor, start);
    cursor = end + close.length;
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
    const end = raw.indexOf(close, start + open.length);
    if (end < 0) return true;
    cursor = end + close.length;
  }
  return false;
}

function openMarker(session: TextToolProtocolSession): string {
  return `<devseek_tool_calls version="${session.version}" channel="${session.channelId}">`;
}

function closeMarker(session: TextToolProtocolSession): string {
  return `</devseek_tool_calls channel="${session.channelId}">`;
}
