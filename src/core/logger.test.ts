import assert from 'node:assert/strict';
import test from 'node:test';
import { redis } from '@devvit/web/server';
import { formatLogMessage, forwardLogEntry } from './logger.ts';

const webhook = `https://discord.com/api/webhooks/12345678901234567/${'a'.repeat(64)}`;

void test('forwards only entries at or above the configured level', async (t) => {
  const payloads: string[] = [];
  t.mock.method(redis, 'hGetAll', async () => ({
    level: 'warn',
    webhookUrl: webhook,
  }));
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: URL | RequestInfo, init?: RequestInit) => {
      payloads.push(String(init?.body));
      return new Response('{}', { status: 200 });
    }
  );

  await forwardLogEntry('info', '{"level":"info"}');
  await forwardLogEntry('warn', '{"level":"warn"}');
  await forwardLogEntry('error', '{"level":"error"}');

  assert.equal(payloads.length, 2);
  assert.equal(
    JSON.parse(payloads[0] ?? '').content,
    '```json\n{"level":"warn"}\n```'
  );
  assert.equal(
    JSON.parse(payloads[1] ?? '').content,
    '```json\n{"level":"error"}\n```'
  );
});

void test('keeps fenced log messages within Discord content limits', () => {
  const message = formatLogMessage(`{"value":"${'x'.repeat(2_100)}"}`);

  assert.equal(message.length, 2_000);
  assert.match(message, /^```json\n/);
  assert.match(message, /\.\.\.\n```$/);
});
