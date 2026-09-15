import assert from 'node:assert/strict';
import test from 'node:test';
import {
  reddit,
  redis,
  runWithContext,
  type Comment,
  type Post,
} from '@devvit/web/server';
import { menu } from './menu.ts';

const webhook = `https://discord.com/api/webhooks/12345678901234567/${'a'.repeat(64)}`;
const configFields = {
  username: 'example_user',
  displayUsername: 'Example_User',
  profileDisplayName: 'Example User',
  profileAvatarUrl: 'https://www.redditstatic.com/example.png',
  profileBio: 'Example bio',
  profileJoinedAtMs: '1600000000000',
  profileNsfw: '0',
  webhookUrl: webhook,
  notificationsEnabled: '0',
  postsEnabled: '0',
  commentsEnabled: '0',
  postSubreddits: 'elsewhere',
  commentSubreddits: 'elsewhere',
  intervalSeconds: '60',
  createdAtMs: '100',
  updatedAtMs: '100',
};

void test('manually sends selected posts and comments and marks them processed', async (t) => {
  const post = {
    id: 't3_selected',
    authorName: 'Example_User',
    createdAt: new Date(1_700_000_000_000),
    nsfw: false,
    quarantined: false,
    spoiler: false,
    removed: false,
    spam: false,
    subredditName: 'news',
    title: 'Selected post',
    body: 'Post body',
    permalink: '/r/news/comments/selected/',
  } as unknown as Post;
  const parent = {
    ...post,
    id: 't3_parent',
    authorName: 'Parent_User',
    permalink: '/r/news/comments/parent/',
  } as unknown as Post;
  const comment = {
    id: 't1_selected',
    authorName: 'Example_User',
    createdAt: new Date(1_700_000_001_000),
    removed: false,
    spam: false,
    subredditName: 'news',
    body: 'Selected comment',
    permalink: '/r/news/comments/parent/selected/',
    parentId: parent.id,
    postId: parent.id,
  } as unknown as Comment;
  const seenIds: string[] = [];
  const payloads: string[] = [];
  let lockToken = '';

  t.mock.method(
    reddit,
    'getCurrentUser',
    async () =>
      ({
        getModPermissionsForSubreddit: async () => ['all'],
      }) as never
  );
  t.mock.method(reddit, 'getPostById', async (id: `t3_${string}`) =>
    id === parent.id ? parent : post
  );
  t.mock.method(reddit, 'getCommentById', async () => comment);
  t.mock.method(redis, 'set', async (_key: string, value: string) => {
    lockToken = value;
    return 'OK';
  });
  t.mock.method(redis, 'get', async () => lockToken);
  t.mock.method(redis, 'del', async () => 1);
  t.mock.method(redis, 'hGetAll', async (key: string) =>
    key.includes(':watch:')
      ? configFields
      : {
          postCursorMs: '0',
          commentCursorMs: '0',
          postCursorIds: '',
          commentCursorIds: '',
          webhookBlocked: '1',
        }
  );
  t.mock.method(redis, 'hSet', async () => 1);
  t.mock.method(
    redis,
    'zAdd',
    async (_key: string, entry: { member: string; score: number }) => {
      seenIds.push(entry.member);
      return 1;
    }
  );
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: URL | RequestInfo, init?: RequestInit) => {
      payloads.push(String(init?.body));
      return new Response('{}', { status: 200 });
    }
  );

  for (const ids of [
    { postId: post.id, commentId: undefined },
    { postId: parent.id, commentId: comment.id },
  ] as const) {
    const response = await runWithContext(
      {
        appName: 'snoopy-app',
        appSlug: 'snoopy-app',
        appVersion: '1.0.0',
        loid: undefined,
        postData: undefined,
        snoovatar: undefined,
        subredditId: 't5_test',
        subredditName: 'test',
        userId: 't2_mod',
        username: 'mod',
        metadata: {},
        ...ids,
      },
      async () => await menu.request('/send-notification', { method: 'POST' })
    );

    assert.deepEqual(await response.json(), {
      showToast: {
        text: 'Sent the notification for u/Example_User.',
        appearance: 'success',
      },
    });
  }

  assert.deepEqual(seenIds, [post.id, comment.id]);
  assert.match(payloads[0] ?? '', /Selected post/);
  assert.match(payloads[1] ?? '', /Selected comment/);
  assert.match(payloads[0] ?? '', /\[r\/test\]/);
  assert.match(payloads[1] ?? '', /\[r\/test\]/);
  assert.match(
    JSON.parse(payloads[1] ?? '').components[0].components[1].content,
    /Parent\\_User/
  );
});
