import assert from 'node:assert/strict';
import test from 'node:test';
import { reddit, type Post } from '@devvit/web/server';
import {
  collectSince,
  establishBaseline,
  fetchRedditHistory,
  redditUserProfile,
} from './reddit-history.ts';
import { REDDIT_HISTORY_LIMIT, type WatchConfig } from './types.ts';

async function* listing(items: { id: string; createdAt: Date }[]) {
  yield* items;
}

const config = {
  username: 'example_user',
  displayUsername: 'Example_User',
  profileDisplayName: 'Example User',
  profileAvatarUrl: 'https://www.redditstatic.com/example.png',
  profileJoinedAtMs: 1_600_000_000_000,
  profileNsfw: false,
  webhookUrl: `https://discord.com/api/webhooks/12345678901234567/${'a'.repeat(64)}`,
  notificationsEnabled: true,
  postsEnabled: true,
  commentsEnabled: false,
  postSubreddits: [],
  commentSubreddits: [],
  intervalSeconds: 60,
  createdAtMs: 100,
  updatedAtMs: 100,
} satisfies WatchConfig;

void test('history collection stops after passing the cursor', async () => {
  async function* posts() {
    yield { id: 'newest', createdAt: new Date(2_000) };
    yield { id: 'boundary', createdAt: new Date(1_000) };
    yield { id: 'old', createdAt: new Date(500) };
    throw new Error('Older history should not be requested.');
  }
  const items = await collectSince(posts(), 1_000);

  assert.deepEqual(
    items.map((item) => item.id),
    ['newest', 'boundary']
  );
});

void test('baseline collection stops after the newest timestamp', async (t) => {
  async function* posts() {
    yield { id: 't3_first', createdAt: new Date(2_000) };
    yield { id: 't3_second', createdAt: new Date(2_000) };
    yield { id: 't3_old', createdAt: new Date(1_000) };
    throw new Error('Older history should not be requested.');
  }
  t.mock.method(reddit, 'getPostsByUser', () => posts() as never);

  const state = await establishBaseline(config, 1_500);

  assert.equal(state.postCursorMs, 2_000);
  assert.deepEqual(state.postCursorIds, ['t3_first', 't3_second']);
});

void test('saturated history cannot advance the activity cursor', async (t) => {
  const posts = Array.from(
    { length: REDDIT_HISTORY_LIMIT + 1 },
    (_, index) => ({
      id: `t3_${index}`,
      authorName: 'example_user',
      createdAt: new Date(2_000 - index),
      nsfw: false,
      quarantined: false,
      spoiler: false,
      removed: false,
      spam: false,
      subredditName: 'news',
      title: 'Title',
      body: 'Body',
      permalink: `/r/news/comments/${index}`,
    })
  ) as Post[];
  t.mock.method(reddit, 'getPostsByUser', () => listing(posts) as never);
  t.mock.method(reddit, 'getUserByUsername', async () => undefined);
  t.mock.method(redditUserProfile, 'getAvatarUrl', async () => undefined);

  const result = await fetchRedditHistory(config, {
    postCursorMs: 1_000,
    commentCursorMs: 1_000,
    postCursorIds: [],
    commentCursorIds: [],
    webhookBlocked: false,
  });

  assert.deepEqual(result.saturatedTypes, ['post']);
  assert.deepEqual(result.activities, []);
});

void test('history uses the Reddit profile icon instead of a default Snoovatar', async (t) => {
  const profileIcon =
    'https://styles.redditmedia.com/t5_3kjdh/styles/profileIcon_zvoywtf1cfwe1.png';
  const post = {
    id: 't3_new',
    authorName: 'LackingAgoodName',
    createdAt: new Date(2_000),
    nsfw: false,
    quarantined: false,
    spoiler: false,
    removed: false,
    spam: false,
    subredditName: 'news',
    title: 'Title',
    body: 'Body',
    permalink: '/r/news/comments/new',
  } as unknown as Post;
  t.mock.method(reddit, 'getPostsByUser', () => listing([post]) as never);
  t.mock.method(
    reddit,
    'getUserByUsername',
    async () =>
      ({
        displayName: 'LackingAgoodName',
        about: '',
        createdAt: new Date(1_000),
        nsfw: false,
      }) as never
  );
  t.mock.method(redditUserProfile, 'getAvatarUrl', async () => profileIcon);

  const result = await fetchRedditHistory(
    { ...config, displayUsername: 'LackingAgoodName' },
    {
      postCursorMs: 1_000,
      commentCursorMs: 1_000,
      postCursorIds: [],
      commentCursorIds: [],
      webhookBlocked: false,
    }
  );

  assert.equal(result.activities[0]?.avatarUrl, profileIcon);
});
