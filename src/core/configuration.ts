import type {
  WatchConfig,
  WatchInput,
  WatchProfile,
  WatchState,
} from './types';

export type WatchRevision = {
  username: string;
  createdAtMs: number;
  updatedAtMs: number;
};

export function encodeWatchRevision(config: WatchConfig): string {
  return `${config.username}|${config.createdAtMs}|${config.updatedAtMs}`;
}

export function decodeWatchRevision(value: string): WatchRevision | undefined {
  const [username, createdAt, updatedAt, extra] = value.split('|');
  const createdAtMs = Number(createdAt);
  const updatedAtMs = Number(updatedAt);
  if (
    !username ||
    extra !== undefined ||
    !Number.isSafeInteger(createdAtMs) ||
    !Number.isSafeInteger(updatedAtMs)
  ) {
    return undefined;
  }
  return { username, createdAtMs, updatedAtMs };
}

export function isCurrentRevision(
  config: WatchConfig,
  revision: WatchRevision
): boolean {
  return (
    config.username === revision.username &&
    config.createdAtMs === revision.createdAtMs &&
    config.updatedAtMs === revision.updatedAtMs
  );
}

export function createWatchConfig(
  input: WatchInput,
  displayUsername: string,
  profile: WatchProfile,
  nowMs: number
): WatchConfig {
  if (!input.webhookUrl)
    throw new Error('Webhook URL is required for a new watch.');
  return {
    ...input,
    displayUsername,
    profileDisplayName: profile.displayName,
    profileAvatarUrl: profile.avatarUrl,
    profileBio: profile.bio,
    profileJoinedAtMs: profile.joinedAtMs,
    profileNsfw: profile.nsfw,
    webhookUrl: input.webhookUrl,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

export function createInitialState(nowMs: number): WatchState {
  return {
    postCursorMs: nowMs,
    commentCursorMs: nowMs,
    postCursorIds: [],
    commentCursorIds: [],
    webhookBlocked: false,
  };
}

export function updateWatchConfig(
  previous: WatchConfig,
  input: WatchInput,
  nowMs: number
): WatchConfig {
  return {
    ...previous,
    ...input,
    webhookUrl: input.webhookUrl ?? previous.webhookUrl,
    updatedAtMs: nowMs,
  };
}

export function updateStateForEdit(
  previousConfig: WatchConfig,
  nextConfig: WatchConfig,
  previousState: WatchState,
  webhookValidated: boolean,
  nowMs: number,
  baseline?: WatchState
): WatchState {
  const reenabled =
    !previousConfig.notificationsEnabled && nextConfig.notificationsEnabled;
  const resetPosts =
    reenabled || (!previousConfig.postsEnabled && nextConfig.postsEnabled);
  const resetComments =
    reenabled ||
    (!previousConfig.commentsEnabled && nextConfig.commentsEnabled);
  const fallbackCursorMs = Math.floor(nowMs / 1_000) * 1_000;
  return {
    ...previousState,
    postCursorMs: resetPosts
      ? (baseline?.postCursorMs ?? fallbackCursorMs)
      : previousState.postCursorMs,
    postCursorIds: resetPosts
      ? (baseline?.postCursorIds ?? [])
      : previousState.postCursorIds,
    commentCursorMs: resetComments
      ? (baseline?.commentCursorMs ?? fallbackCursorMs)
      : previousState.commentCursorMs,
    commentCursorIds: resetComments
      ? (baseline?.commentCursorIds ?? [])
      : previousState.commentCursorIds,
    lastError: webhookValidated ? undefined : previousState.lastError,
    webhookBlocked: webhookValidated ? false : previousState.webhookBlocked,
  };
}

export function watchNeedsBaseline(
  previousConfig: WatchConfig,
  nextConfig: WatchConfig
): boolean {
  return (
    (!previousConfig.notificationsEnabled && nextConfig.notificationsEnabled) ||
    (!previousConfig.postsEnabled && nextConfig.postsEnabled) ||
    (!previousConfig.commentsEnabled && nextConfig.commentsEnabled)
  );
}
