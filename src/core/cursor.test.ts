import assert from 'node:assert/strict';
import test from 'node:test';
import { baselineBoundary, isAfterCursor, updateCursor } from './cursor.ts';
import type { RedditActivity, WatchState } from './types.ts';

const state: WatchState = {
  postCursorMs: 1_000,
  commentCursorMs: 2_000,
  postCursorIds: ['t3_seen'],
  commentCursorIds: [],
  webhookBlocked: false,
};

const post = (id: string, createdAtMs: number): RedditActivity => ({
  id,
  type: 'post',
  authorName: 'example',
  displayName: 'Example',
  avatarUrl: 'https://www.redditstatic.com/example.png',
  joinedRedditAtMs: 1_600_000_000_000,
  subredditName: 'news',
  createdAtMs,
  permalink: '/r/news/test',
  sensitive: false,
  removed: false,
  spam: false,
});

void test('cursor IDs distinguish activities with the same timestamp', () => {
  assert.equal(isAfterCursor(state, post('t3_seen', 1_000)), false);
  assert.equal(isAfterCursor(state, post('t3_new', 1_000)), true);
});

void test('advancing a cursor replaces old boundary IDs', () => {
  const nextState: WatchState = {
    ...state,
    postCursorIds: [...state.postCursorIds],
  };
  updateCursor(nextState, post('t3_newer', 3_000));
  assert.equal(nextState.postCursorMs, 3_000);
  assert.deepEqual(nextState.postCursorIds, ['t3_newer']);
});

void test('a baseline retains every ID at the newest second boundary', () => {
  const boundary = baselineBoundary(
    [
      { id: 't3_first', createdAt: new Date(1_000) },
      { id: 't3_second', createdAt: new Date(1_000) },
      { id: 't3_old', createdAt: new Date(500) },
    ],
    1_500
  );
  assert.equal(boundary.cursorMs, 1_000);
  assert.deepEqual(boundary.cursorIds, ['t3_first', 't3_second']);
});
