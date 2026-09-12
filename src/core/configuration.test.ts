import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeWatchRevision,
  encodeWatchRevision,
  isCurrentRevision,
  updateStateForEdit,
  updateWatchConfig,
} from './configuration.ts';
import type { WatchConfig, WatchInput, WatchState } from './types.ts';

const config: WatchConfig = {
  username: 'example_user',
  displayUsername: 'Example_User',
  profileDisplayName: 'Example User',
  profileAvatarUrl:
    'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png',
  profileJoinedAtMs: 1_600_000_000_000,
  profileNsfw: false,
  webhookUrl: 'https://discord.com/api/webhooks/12345678901234567/token',
  notificationsEnabled: true,
  postsEnabled: true,
  commentsEnabled: true,
  postSubreddits: [],
  commentSubreddits: [],
  intervalSeconds: 60,
  createdAtMs: 100,
  updatedAtMs: 100,
};

const state: WatchState = {
  postCursorMs: 200,
  commentCursorMs: 300,
  postCursorIds: ['t3_previous'],
  commentCursorIds: ['t1_previous'],
  lastError: 'old failure',
  webhookBlocked: true,
};

function input(overrides: Partial<WatchInput> = {}): WatchInput {
  return {
    username: config.username,
    notificationsEnabled: true,
    postsEnabled: true,
    commentsEnabled: true,
    postSubreddits: ['news'],
    commentSubreddits: [],
    intervalSeconds: 120,
    ...overrides,
  };
}

void test('ordinary edits retain activity cursors', () => {
  const next = updateWatchConfig(config, input(), 1_000);
  const nextState = updateStateForEdit(config, next, state, false, 1_000);
  assert.equal(nextState.postCursorMs, 200);
  assert.equal(nextState.commentCursorMs, 300);
  assert.deepEqual(nextState.postCursorIds, ['t3_previous']);
});

void test('enabling a type establishes a new type baseline', () => {
  const previous = { ...config, commentsEnabled: false };
  const next = updateWatchConfig(previous, input(), 1_000);
  const nextState = updateStateForEdit(previous, next, state, false, 1_000);
  assert.equal(nextState.postCursorMs, 200);
  assert.equal(nextState.commentCursorMs, 1_000);
  assert.deepEqual(nextState.commentCursorIds, []);
});

void test('enabled types retain fetched baseline boundary IDs', () => {
  const previous = { ...config, commentsEnabled: false };
  const next = updateWatchConfig(previous, input(), 1_000);
  const nextState = updateStateForEdit(previous, next, state, false, 1_000, {
    postCursorMs: 900,
    postCursorIds: ['t3_boundary'],
    commentCursorMs: 800,
    commentCursorIds: ['t1_first', 't1_second'],
    webhookBlocked: false,
  });
  assert.equal(nextState.postCursorMs, 200);
  assert.equal(nextState.commentCursorMs, 800);
  assert.deepEqual(nextState.commentCursorIds, ['t1_first', 't1_second']);
});

void test('re-enabling notifications establishes fresh baselines', () => {
  const previous = { ...config, notificationsEnabled: false };
  const next = updateWatchConfig(previous, input(), 1_000);
  const nextState = updateStateForEdit(previous, next, state, false, 1_000);
  assert.equal(nextState.postCursorMs, 1_000);
  assert.equal(nextState.commentCursorMs, 1_000);
});

void test('changing a webhook clears its operational block', () => {
  const next = updateWatchConfig(
    config,
    input({ webhookUrl: 'https://example.invalid' }),
    1_000
  );
  const nextState = updateStateForEdit(config, next, state, true, 1_000);
  assert.equal(nextState.webhookBlocked, false);
  assert.equal(nextState.lastError, undefined);
});

void test('watch revisions reject stale and malformed form submissions', () => {
  const revision = decodeWatchRevision(encodeWatchRevision(config));
  assert.ok(revision);
  assert.equal(isCurrentRevision(config, revision), true);
  assert.equal(
    isCurrentRevision({ ...config, updatedAtMs: 101 }, revision),
    false
  );
  assert.equal(decodeWatchRevision('example_user|100|not-a-number'), undefined);
  assert.equal(decodeWatchRevision('example_user|100|100|extra'), undefined);
});
