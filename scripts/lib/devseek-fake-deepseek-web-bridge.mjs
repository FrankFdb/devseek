import { createServer } from 'node:http';
import {
  DEEPSEEK_WEB_CONNECTOR_CAPABILITIES,
  DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION,
} from '../../packages/shared/dist/index.js';

const REPLACEMENT_DELTA_PREFIX = '\u0000RESET\u0000';

export async function withFakeDeepSeekWebBridge(responder, fn) {
  const seenBodies = [];
  const requestCounts = { status: 0, cancel: 0, chat: 0 };
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/status') {
      requestCounts.status += 1;
      sendJson(res, {
        idle: true,
        queueLength: 0,
        browserReady: true,
        loggedInLikely: true,
        connector: {
          protocolVersion: DEEPSEEK_WEB_CONNECTOR_PROTOCOL_VERSION,
          provider: 'deepseek-web',
          capabilities: DEEPSEEK_WEB_CONNECTOR_CAPABILITIES,
          maxAttempts: 2,
          activeRequestCount: 0,
        },
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/cancel') {
      requestCounts.cancel += 1;
      const requestId = String(req.headers['x-devseek-target-operation-id'] || '').trim();
      sendJson(res, {
        ok: true,
        decision: 'accepted',
        ...(requestId ? { requestId } : {}),
      });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/chat') {
      res.writeHead(404).end();
      return;
    }

    requestCounts.chat += 1;
    readJsonBody(req, res, body => {
      seenBodies.push(body);
      const response = responder(body);
      if (body.stream === false) {
        sendJson(res, { content: response.content });
        return;
      }
      sendStream(res, req, response);
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fake Bridge did not expose a TCP port');
    await fn({ port: address.port, seenBodies, requestCounts });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function readJsonBody(req, res, receive) {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try {
      receive(raw ? JSON.parse(raw) : {});
    } catch (error) {
      sendJson(res, { error: String(error?.message || error) }, 400);
    }
  });
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function sendStream(res, req, response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  setTimeout(() => {
    const content = String(response.content ?? '');
    const first = content.slice(0, Math.max(1, Math.floor(content.length / 2)));
    const deltas = content.length > 1 ? [first, content] : [content];
    const requestId = String(req.headers['x-devseek-operation-id'] || 'fake-bridge-chat');
    for (const [index, delta] of deltas.entries()) {
      res.write(`data: ${JSON.stringify({
        protocolVersion: 'devseek.deepseek-web-stream/v1',
        requestId,
        sequence: index + 1,
        event: 'delta',
        delta: `${REPLACEMENT_DELTA_PREFIX}${delta}`,
        done: false,
      })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({
      protocolVersion: 'devseek.deepseek-web-stream/v1',
      requestId,
      sequence: deltas.length + 1,
      event: 'done',
      delta: '',
      done: true,
    })}\n\n`);
    res.end();
  }, response.delayMs ?? 0);
}
