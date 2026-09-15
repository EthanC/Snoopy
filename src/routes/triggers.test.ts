import assert from 'node:assert/strict';
import test from 'node:test';
import { redis } from '@devvit/web/server';
import { triggers } from './triggers.ts';

const webhook = `https://discord.com/api/webhooks/12345678901234567/${'a'.repeat(64)}`;

void test('forwards app upgrades regardless of the configured log level', async (t) => {
  let payload = '';
  t.mock.method(console, 'info', () => undefined);
  t.mock.method(redis, 'hGetAll', async () => ({
    level: 'error',
    webhookUrl: webhook,
  }));
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: URL | RequestInfo, init?: RequestInit) => {
      payload = String(init?.body);
      return new Response('{}', { status: 200 });
    }
  );

  const response = await triggers.request('/on-app-upgrade', {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  const content = JSON.parse(payload).content as string;
  assert.match(content, /"level":"info","event":"app_upgraded"/);
});

void test('does not forward app upgrades when upgrade events are disabled', async (t) => {
  let requests = 0;
  t.mock.method(console, 'info', () => undefined);
  t.mock.method(redis, 'hGetAll', async () => ({
    level: 'info',
    webhookUrl: webhook,
    upgradeEventsEnabled: '0',
  }));
  t.mock.method(globalThis, 'fetch', async () => {
    requests += 1;
    return new Response('{}', { status: 200 });
  });

  const response = await triggers.request('/on-app-upgrade', {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  assert.equal(requests, 0);
});
