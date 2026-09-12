import type { ActivityType, RedditActivity, WatchState } from './types';

export function baselineBoundary<T extends { id: string; createdAt: Date }>(
  items: readonly T[],
  snapshotAtMs: number
): { cursorMs: number; cursorIds: string[] } {
  const floorSnapshotMs = Math.floor(snapshotAtMs / 1_000) * 1_000;
  const newestMs = items.reduce(
    (maximum, item) => Math.max(maximum, item.createdAt.getTime()),
    floorSnapshotMs
  );
  return {
    cursorMs: newestMs,
    cursorIds: items
      .filter((item) => item.createdAt.getTime() === newestMs)
      .map((item) => item.id),
  };
}

export function cursorFor(state: WatchState, type: ActivityType): number {
  return type === 'post' ? state.postCursorMs : state.commentCursorMs;
}

export function updateCursor(
  state: WatchState,
  activity: RedditActivity
): void {
  if (activity.type === 'post') {
    if (activity.createdAtMs > state.postCursorMs) {
      state.postCursorMs = activity.createdAtMs;
      state.postCursorIds = [activity.id];
    } else if (activity.createdAtMs === state.postCursorMs) {
      state.postCursorIds = [...new Set([...state.postCursorIds, activity.id])];
    }
  } else if (activity.createdAtMs > state.commentCursorMs) {
    state.commentCursorMs = activity.createdAtMs;
    state.commentCursorIds = [activity.id];
  } else if (activity.createdAtMs === state.commentCursorMs) {
    state.commentCursorIds = [
      ...new Set([...state.commentCursorIds, activity.id]),
    ];
  }
}

export function isAfterCursor(
  state: WatchState,
  activity: RedditActivity
): boolean {
  const cursorMs = cursorFor(state, activity.type);
  const cursorIds =
    activity.type === 'post' ? state.postCursorIds : state.commentCursorIds;
  return (
    activity.createdAtMs > cursorMs ||
    (activity.createdAtMs === cursorMs && !cursorIds.includes(activity.id))
  );
}
