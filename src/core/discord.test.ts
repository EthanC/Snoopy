import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deliverLogToDiscord,
  deliverToDiscord,
  verifyDiscordWebhook,
} from './discord.ts';
import type { RedditActivity } from './types.ts';

const webhook = `https://discord.com/api/webhooks/12345678901234567/${'a'.repeat(64)}`;
const activity: RedditActivity = {
  id: 't1_test',
  type: 'comment',
  authorName: 'Example_User',
  displayName: 'Example Display',
  avatarUrl: 'https://www.redditstatic.com/example.png',
  bio: 'Example user bio',
  joinedRedditAtMs: 1_600_000_000_000,
  subredditName: 'news',
  createdAtMs: 1_700_000_000_000,
  body: '@everyone test comment',
  permalink: '/r/news/comments/test/comment/',
  parentId: 't1_parent',
  parentAuthorName: 'Parent_User',
  parentType: 'comment',
  parentPermalink: '/r/news/comments/test/parent/',
  sensitive: false,
  removed: false,
  spam: false,
};

void test('sends a confirmed webhook message with mentions disabled', async () => {
  let requestUrl = '';
  let requestBody = '';
  const mockFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requestUrl = input.toString();
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  assert.deepEqual(
    await deliverToDiscord(webhook, activity, 'Snoopy', mockFetch),
    {
      ok: true,
    }
  );
  assert.match(requestUrl, /wait=true/);
  assert.match(requestUrl, /with_components=true/);
  const payload = JSON.parse(requestBody);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.flags, 32_768);
  assert.equal(payload.embeds, undefined);
  assert.equal(payload.components[0].type, 17);
  assert.equal(payload.components[0].accent_color, 16_729_344);
  assert.equal(payload.components[0].spoiler, false);
  assert.equal(payload.components[0].components[0].type, 9);
  assert.equal(
    payload.components[0].components[0].accessory.media.url,
    activity.avatarUrl
  );
  assert.match(
    payload.components[0].components[0].components[0].content,
    /Example Display/
  );
  assert.equal(
    payload.components[0].components[0].components[1].content,
    '-# Example user bio'
  );
  assert.equal(
    payload.components[0].components[0].components[2].content,
    '-# Joined Reddit <t:1600000000:R>'
  );
  assert.match(
    payload.components[0].components[1].content,
    /^### Reply to \[u\/Parent\\_User\]\(https:\/\/reddit\.com\/user\/Parent_User\)'s \[comment\]\(https:\/\/reddit\.com\/r\/news\/comments\/test\/parent\/\) in \[r\/news\]\(https:\/\/reddit\.com\/r\/news\):$/
  );
  assert.equal(
    payload.components[0].components[2].content,
    '>>> @everyone test comment'
  );
  assert.equal(
    payload.components[0].components[4].content,
    '-# Posted <t:1700000000:F> (<t:1700000000:R>) [r/Snoopy]'
  );
  assert.equal(payload.components[1].type, 1);
  assert.equal(payload.components[1].components[0].label, 'View on Reddit');
  assert.equal(
    payload.components[1].components[1].url,
    'https://github.com/EthanC/Snoopy'
  );
});

void test('sends logs as confirmed plaintext messages', async () => {
  let requestUrl = '';
  let requestBody = '';
  const mockFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requestUrl = input.toString();
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  assert.equal(
    await deliverLogToDiscord(
      `${webhook}?thread_id=98765432109876543`,
      '```json\n{"level":"warn"}\n```',
      mockFetch
    ),
    true
  );

  const url = new URL(requestUrl);
  assert.equal(url.searchParams.get('wait'), 'true');
  assert.equal(url.searchParams.get('thread_id'), '98765432109876543');
  assert.equal(url.searchParams.has('with_components'), false);
  const payload = JSON.parse(requestBody);
  assert.equal(payload.content, '```json\n{"level":"warn"}\n```');
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.components, undefined);
  assert.equal(payload.embeds, undefined);
});

void test('keeps the joined-date profile component when no bio is available', async () => {
  let requestBody = '';
  const mockFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await deliverToDiscord(
    webhook,
    { ...activity, bio: undefined },
    'Snoopy',
    mockFetch
  );
  const payload = JSON.parse(requestBody);
  assert.equal(payload.components[0].components[0].components.length, 2);
  assert.equal(
    payload.components[0].components[0].components[1].content,
    '-# Joined Reddit <t:1600000000:R>'
  );
});

void test('embeds Reddit Giphy comments without showing the placeholder', async () => {
  let requestBody = '';
  const mockFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await deliverToDiscord(
    webhook,
    {
      ...activity,
      body: '![gif](giphy|YlRks3xm0Lm3IGHSFt)',
      sensitive: true,
    },
    'Snoopy',
    mockFetch
  );
  const components = JSON.parse(requestBody).components[0].components;

  assert.deepEqual(components[3], {
    type: 12,
    items: [
      {
        media: {
          url: 'https://media.giphy.com/media/YlRks3xm0Lm3IGHSFt/giphy.gif',
        },
        description: 'GIF posted by u/Example_User on Reddit.',
        spoiler: true,
      },
    ],
  });
  assert.doesNotMatch(requestBody, /giphy\|/);
  assert.doesNotMatch(requestBody, /No text content/);
});

void test('keeps text components around an inline Reddit Giphy comment', async () => {
  let requestBody = '';
  const mockFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await deliverToDiscord(
    webhook,
    {
      ...activity,
      body: 'Text above\n\n![gif](giphy|YlRks3xm0Lm3IGHSFt)\n\nText below',
    },
    'Snoopy',
    mockFetch
  );
  const components = JSON.parse(requestBody).components[0].components;

  assert.equal(components[2].content, '>>> Text above');
  assert.equal(
    components[3].items[0].media.url,
    'https://media.giphy.com/media/YlRks3xm0Lm3IGHSFt/giphy.gif'
  );
  assert.equal(components[4].content, '>>> Text below');
});

void test('embeds Reddit-hosted images from comment bodies and post URLs', async () => {
  const requestBodies: string[] = [];
  const mockFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBodies.push(String(init?.body));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const previewUrl =
    'https://preview.redd.it/vdyjwdw8z1ph1.png?width=720&format=png&auto=webp&s=b14d4fbce811fba50866d8e72ed562e9935a5530';
  const imageUrl = 'https://i.redd.it/osxebrv9z1ph1.gif';

  await deliverToDiscord(
    webhook,
    { ...activity, body: `Text above\n\n![img](${previewUrl})\n\nText below` },
    'Snoopy',
    mockFetch
  );
  await deliverToDiscord(
    webhook,
    {
      ...activity,
      type: 'post',
      title: 'Image post',
      body: undefined,
      url: imageUrl,
    },
    'Snoopy',
    mockFetch
  );

  const commentComponents = JSON.parse(requestBodies[0] ?? '').components[0]
    .components;
  assert.equal(commentComponents[2].content, '>>> Text above');
  assert.equal(commentComponents[3].items[0].media.url, previewUrl);
  assert.equal(commentComponents[4].content, '>>> Text below');

  const postComponents = JSON.parse(requestBodies[1] ?? '').components[0]
    .components;
  assert.equal(postComponents[2].items[0].media.url, imageUrl);
  assert.equal(
    postComponents[2].items[0].description,
    'Image posted by u/Example_User on Reddit.'
  );
});

void test('includes a post title component only for posts', async () => {
  let requestBody = '';
  const mockFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await deliverToDiscord(
    webhook,
    { ...activity, type: 'post', title: 'Example post title' },
    'Snoopy',
    mockFetch
  );
  const payload = JSON.parse(requestBody);
  assert.equal(
    payload.components[0].components[1].content,
    '### Example post title'
  );
  assert.equal(
    payload.components[0].components[2].content,
    '>>> @everyone test comment'
  );
});

void test('converts Reddit markdown for Discord', async () => {
  let requestBody = '';
  const mockFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const body = [
    '# Heading',
    '',
    '**bold** *italic* ***bolditalic*** ~~strikethrough~~',
    'Before ^(superscript) [link](http://google.com/)',
    '',
    '^(subtext)',
    '',
    '* one',
    '   * two',
    '',
    '>!Reddit Spoilers!<',
    '',
    '> blockquote',
    '',
    '`codeblock`',
    '',
    '|this|is|a|',
    '|:-|:-|:-|',
    '|table|wow|this|',
  ].join('\n');

  await deliverToDiscord(webhook, { ...activity, body }, 'Snoopy', mockFetch);

  assert.equal(
    JSON.parse(requestBody).components[0].components[2].content,
    `>>> ${body
      .replace('^(superscript)', 'superscript')
      .replace('^(subtext)', '-# subtext')
      .replace('>!Reddit Spoilers!<', '||Reddit Spoilers||')}`
  );
});

void test('returns Discord retry timing for a rate limit', async () => {
  const mockFetch = (async () =>
    new Response(JSON.stringify({ retry_after: 12.5 }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  const result = await deliverToDiscord(webhook, activity, 'Snoopy', mockFetch);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.kind, 'retry');
    assert.equal(result.retryAfterSeconds, 12.5);
  }
});

void test('blocks a webhook after a permanent Discord response', async () => {
  const mockFetch = (async () =>
    new Response('', { status: 404 })) as typeof fetch;
  const result = await deliverToDiscord(webhook, activity, 'Snoopy', mockFetch);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'blocked');
});

void test('discards one payload after a payload-specific client error', async () => {
  const mockFetch = (async () =>
    new Response('', { status: 400 })) as typeof fetch;
  const result = await deliverToDiscord(webhook, activity, 'Snoopy', mockFetch);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'discard');
});

void test('blocks a forum webhook until a thread ID is configured', async () => {
  const mockFetch = (async () =>
    new Response(JSON.stringify({ code: 220001 }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
  const result = await deliverToDiscord(webhook, activity, 'Snoopy', mockFetch);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'blocked');
});

void test('retries other Discord client errors', async () => {
  const mockFetch = (async () =>
    new Response('', { status: 408 })) as typeof fetch;
  const result = await deliverToDiscord(webhook, activity, 'Snoopy', mockFetch);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.kind, 'retry');
});

void test('validates a webhook without sending a message', async () => {
  let method = '';
  let redirect = '';
  let hasSignal = false;
  let requestUrl = '';
  const mockFetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requestUrl = input.toString();
    method = init?.method ?? '';
    redirect = init?.redirect ?? '';
    hasSignal = init?.signal instanceof AbortSignal;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await verifyDiscordWebhook(
    `${webhook}?thread_id=98765432109876543`,
    mockFetch
  );
  assert.equal(method, 'GET');
  assert.equal(redirect, 'error');
  assert.equal(hasSignal, true);
  assert.equal(new URL(requestUrl).search, '');
});

void test('budgets markdown text within the component limit', async () => {
  let requestBody = '';
  const mockFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await deliverToDiscord(
    webhook,
    { ...activity, body: '_'.repeat(6_000) },
    'Snoopy',
    mockFetch
  );
  const payload = JSON.parse(requestBody);
  type TextComponent = { content?: string; components?: TextComponent[] };
  const components = payload.components[0].components as TextComponent[];
  const textLength = components.reduce(
    (total, component) =>
      total +
      (component.content?.length ?? 0) +
      (component.components ?? []).reduce(
        (nestedTotal, nested) => nestedTotal + (nested.content?.length ?? 0),
        0
      ),
    0
  );
  assert.ok(textLength <= 4_000);
  assert.match(payload.components[0].components[2].content, /\.\.\.$/);
});

void test('spoilers sensitive activity and strips directional controls', async () => {
  let requestBody = '';
  const mockFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    requestBody = String(init?.body);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  await deliverToDiscord(
    webhook,
    {
      ...activity,
      sensitive: true,
      body: 'safe\u202Ehidden\u0000',
      permalink: 'https://example.invalid/redirected',
    },
    'Snoopy',
    mockFetch
  );
  const payload = JSON.parse(requestBody);
  assert.equal(payload.components[0].spoiler, true);
  assert.equal(payload.components[0].components[0].accessory.spoiler, true);
  assert.equal(payload.components[0].components[3].content, '>>> safehidden');
  assert.equal(
    payload.components[1].components[0].url,
    'https://reddit.com/redirected'
  );
});
