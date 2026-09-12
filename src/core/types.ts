export const DEFAULT_INTERVAL_SECONDS = 60;
export const MIN_INTERVAL_SECONDS = 60;
export const MAX_INTERVAL_SECONDS = 86_400;
export const POLL_ACTIVITY_BATCH_SIZE = 20;
export const REDDIT_HISTORY_LIMIT = 1_000;
export const REDDIT_HISTORY_PAGE_SIZE = 100;
export const SEEN_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const SEEN_MAX_PER_USER = 5_000;

export type WatchConfig = {
  username: string;
  displayUsername: string;
  profileDisplayName: string;
  profileAvatarUrl: string;
  profileBio?: string | undefined;
  profileJoinedAtMs: number;
  profileNsfw: boolean;
  webhookUrl: string;
  notificationsEnabled: boolean;
  postsEnabled: boolean;
  commentsEnabled: boolean;
  postSubreddits: string[];
  commentSubreddits: string[];
  intervalSeconds: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type WatchProfile = {
  displayName: string;
  avatarUrl: string;
  bio?: string | undefined;
  joinedAtMs: number;
  nsfw: boolean;
};

export type WatchState = {
  postCursorMs: number;
  commentCursorMs: number;
  postCursorIds: string[];
  commentCursorIds: string[];
  lastPollAtMs?: number | undefined;
  lastSuccessAtMs?: number | undefined;
  lastError?: string | undefined;
  webhookBlocked: boolean;
};

export type ActivityType = 'post' | 'comment';

export type RedditActivity = {
  id: string;
  type: ActivityType;
  authorName: string;
  displayName: string;
  avatarUrl: string;
  bio?: string | undefined;
  joinedRedditAtMs: number;
  sensitive: boolean;
  removed: boolean;
  spam: boolean;
  subredditName: string;
  createdAtMs: number;
  title?: string | undefined;
  body?: string | undefined;
  url?: string | undefined;
  permalink: string;
  parentId?: string | undefined;
  postId?: string | undefined;
  parentAuthorName?: string | undefined;
  parentType?: ActivityType | undefined;
  parentPermalink?: string | undefined;
};

export type WatchInput = {
  username: string;
  webhookUrl?: string | undefined;
  notificationsEnabled: boolean;
  postsEnabled: boolean;
  commentsEnabled: boolean;
  postSubreddits: string[];
  commentSubreddits: string[];
  intervalSeconds: number;
};
