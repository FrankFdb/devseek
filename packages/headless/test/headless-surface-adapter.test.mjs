import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessSurfaceAdapter } from '../dist/index.js';

test('HeadlessSurfaceAdapter exposes canonical command and callback conformance', () => {
  const adapter = new HeadlessSurfaceAdapter();
  const command = adapter.toChatCommand({ prompt: ' inspect repo ', commandId: 'headless-command' });
  const receipt = adapter.conformance();

  assert.equal(command.version, 'devseek.agent-command/v1');
  assert.equal(command.surface, 'headless');
  assert.equal(command.request.prompt, 'inspect repo');
  assert.equal(receipt.surface, 'headless');
  assert.deepEqual(receipt.eventDelivery, {
    channel: 'callback',
    ordering: 'serialized',
    backpressure: 'awaited',
  });
});

test('HeadlessSurfaceAdapter serializes concurrent event delivery and preserves sink failure', async () => {
  const observed = [];
  let releaseFirst;
  const firstBlocked = new Promise(resolve => { releaseFirst = resolve; });
  const adapter = new HeadlessSurfaceAdapter({
    async eventSink(event) {
      observed.push(`start:${event.eventId}`);
      if (event.eventId === 'first') await firstBlocked;
      observed.push(`end:${event.eventId}`);
    },
  });

  const first = adapter.renderEvent({ type: 'task.cancelled', eventId: 'first', timestamp: 1 });
  const second = adapter.renderEvent({ type: 'task.cancelled', eventId: 'second', timestamp: 2 });
  await Promise.resolve();
  assert.deepEqual(observed, ['start:first']);
  releaseFirst();
  await Promise.all([first, second]);
  await adapter.flush();
  assert.deepEqual(observed, ['start:first', 'end:first', 'start:second', 'end:second']);

  const failed = new HeadlessSurfaceAdapter({ eventSink() { throw new Error('sink failed'); } });
  await assert.rejects(
    failed.renderEvent({ type: 'task.cancelled', eventId: 'failed', timestamp: 3 }),
    /sink failed/u,
  );
  await assert.rejects(failed.flush(), /sink failed/u);
});
