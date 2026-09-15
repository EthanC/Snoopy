import assert from 'node:assert/strict';
import test from 'node:test';
import { reddit, redis, runWithContext } from '@devvit/web/server';
import { forms } from './forms.ts';

const webhook = `https://discord.com/api/webhooks/12345678901234567/${'a'.repeat(64)}`;
const requestContext = {
  appName: 'snoopy-app',
  appSlug: 'snoopy-app',
  appVersion: '1.0.0',
  commentId: undefined,
  loid: undefined,
  postData: undefined,
  postId: undefined,
  snoovatar: undefined,
  subredditId: 't5_test',
  subredditName: 'test',
  userId: 't2_mod',
  username: 'mod',
  metadata: {},
} as const;

void test('saves and removes the optional logging configuration', async (t) => {
  let lockToken = '';
  let stored: Record<string, string> | undefined;
  let verificationRequests = 0;
  t.mock.method(
    reddit,
    'getCurrentUser',
    async () =>
      ({
        getModPermissionsForSubreddit: async () => ['all'],
      }) as never
  );
  t.mock.method(redis, 'set', async (_key: string, value: string) => {
    lockToken = value;
    return 'OK';
  });
  t.mock.method(redis, 'get', async () => lockToken);
  t.mock.method(redis, 'hGetAll', async () => stored ?? {});
  t.mock.method(
    redis,
    'hSet',
    async (_key: string, fields: Record<string, string>) => {
      stored = fields;
      return 1;
    }
  );
  t.mock.method(redis, 'del', async (key: string) => {
    if (key === 'snoopy:logging') stored = undefined;
    return 1;
  });
  t.mock.method(globalThis, 'fetch', async () => {
    verificationRequests += 1;
    return new Response('{}', { status: 200 });
  });

  const saveResponse = await runWithContext(requestContext, async () =>
    forms.request('/configure-logging', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        level: ['error'],
        upgradeEventsEnabled: false,
        webhookUrl: webhook,
      }),
    })
  );
  assert.deepEqual(await saveResponse.json(), {
    showToast: {
      text: 'Discord logging set to error.',
      appearance: 'success',
    },
  });
  assert.deepEqual(stored, {
    level: 'error',
    webhookUrl: `${webhook}?with_components=true`,
    upgradeEventsEnabled: '0',
  });
  assert.equal(verificationRequests, 1);

  const removeResponse = await runWithContext(requestContext, async () =>
    forms.request('/configure-logging', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: ['info'], webhookUrl: '' }),
    })
  );
  assert.deepEqual(await removeResponse.json(), {
    showToast: {
      text: 'Discord logging is disabled.',
      appearance: 'success',
    },
  });
  assert.equal(stored, undefined);
  assert.equal(verificationRequests, 1);
});
