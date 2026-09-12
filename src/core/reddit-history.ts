import {
  context,
  reddit,
  type Comment,
  type Listing,
  type Post,
} from '@devvit/web/server';
import {
  UsersDefinition,
  type Users,
} from '@devvit/protos/types/devvit/plugin/redditapi/users/users_svc.js';
import { getDevvitConfig } from '@devvit/shared-types/server/get-devvit-config.js';
import {
  REDDIT_HISTORY_LIMIT,
  REDDIT_HISTORY_PAGE_SIZE,
  type ActivityType,
  type RedditActivity,
  type WatchConfig,
  type WatchProfile,
  type WatchState,
} from './types.ts';
import { baselineBoundary } from './cursor.ts';

export const DEFAULT_AVATAR_URL =
  'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png';

// The public User model omits iconImg, so read it from the same Reddit API response.
export const redditUserProfile = {
  async getAvatarUrl(username: string): Promise<string | undefined> {
    const response = await getDevvitConfig()
      .use<Users>(UsersDefinition)
      .UserAbout({ username }, context.metadata);
    return response.data?.iconImg;
  },
};

export type HistoryFetchResult = {
  activities: RedditActivity[];
  failedTypes: ActivityType[];
  saturatedTypes: ActivityType[];
};

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

class DeadlineError extends Error {}

async function beforeDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number
): Promise<T> {
  const remainingMs = deadlineMs - Date.now();
  if (remainingMs <= 0) {
    void promise.catch(() => undefined);
    throw new DeadlineError('Reddit request timed out.');
  }

  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new DeadlineError('Reddit request timed out.')),
      remainingMs
    );
    void promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(
          error instanceof Error ? error : new Error('Reddit request failed.')
        );
      }
    );
  });
}

async function settle<T>(
  promise: Promise<T>,
  deadlineMs?: number
): Promise<Settled<T>> {
  try {
    return {
      ok: true,
      value:
        deadlineMs === undefined
          ? await promise
          : await beforeDeadline(promise, deadlineMs),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

function cachedProfile(config: WatchConfig): WatchProfile {
  return {
    displayName: config.profileDisplayName || config.displayUsername,
    avatarUrl: config.profileAvatarUrl || DEFAULT_AVATAR_URL,
    bio: config.profileBio,
    joinedAtMs: config.profileJoinedAtMs || config.createdAtMs,
    nsfw: config.profileNsfw,
  };
}

function mapPost(post: Post, profile: WatchProfile): RedditActivity {
  return {
    id: post.id,
    type: 'post',
    authorName: post.authorName,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    joinedRedditAtMs: profile.joinedAtMs,
    sensitive: profile.nsfw || post.nsfw || post.quarantined || post.spoiler,
    removed: post.removed,
    spam: post.spam,
    subredditName: post.subredditName,
    createdAtMs: post.createdAt.getTime(),
    title: post.title,
    body: post.body,
    url: post.url,
    permalink: post.permalink,
  };
}

function mapComment(comment: Comment, profile: WatchProfile): RedditActivity {
  return {
    id: comment.id,
    type: 'comment',
    authorName: comment.authorName,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    joinedRedditAtMs: profile.joinedAtMs,
    sensitive: profile.nsfw,
    removed: comment.removed,
    spam: comment.spam,
    subredditName: comment.subredditName,
    createdAtMs: comment.createdAt.getTime(),
    body: comment.body,
    permalink: comment.permalink,
    parentId: comment.parentId,
    postId: comment.postId,
  };
}

export function activityFromPost(
  post: Post,
  config: WatchConfig
): RedditActivity {
  return mapPost(post, cachedProfile(config));
}

export function activityFromComment(
  comment: Comment,
  config: WatchConfig
): RedditActivity {
  return mapComment(comment, cachedProfile(config));
}

function postListing(config: WatchConfig): Listing<Post> {
  return reddit.getPostsByUser({
    username: config.displayUsername,
    sort: 'new',
    timeframe: 'all',
    limit: REDDIT_HISTORY_LIMIT + 1,
    pageSize: REDDIT_HISTORY_PAGE_SIZE,
  });
}

function commentListing(config: WatchConfig): Listing<Comment> {
  return reddit.getCommentsByUser({
    username: config.displayUsername,
    sort: 'new',
    timeframe: 'all',
    limit: REDDIT_HISTORY_LIMIT + 1,
    pageSize: REDDIT_HISTORY_PAGE_SIZE,
  });
}

async function nextListingItem<T>(
  iterator: AsyncIterator<T>,
  deadlineMs?: number
): Promise<IteratorResult<T>> {
  const next = iterator.next();
  return deadlineMs === undefined
    ? await next
    : await beforeDeadline(next, deadlineMs);
}

export async function collectSince<T extends { createdAt: Date }>(
  listing: AsyncIterable<T>,
  cursorMs: number,
  deadlineMs?: number
): Promise<T[]> {
  const items: T[] = [];
  const iterator = listing[Symbol.asyncIterator]();
  while (true) {
    const next = await nextListingItem(iterator, deadlineMs);
    if (next.done) break;
    if (next.value.createdAt.getTime() < cursorMs) break;
    items.push(next.value);
  }
  return items;
}

async function collectNewestBoundary<T extends { createdAt: Date }>(
  listing: Listing<T>,
  deadlineMs?: number
): Promise<T[]> {
  const items: T[] = [];
  const iterator = listing[Symbol.asyncIterator]();
  let newestMs: number | undefined;
  while (true) {
    const next = await nextListingItem(iterator, deadlineMs);
    if (next.done) break;
    const createdAtMs = next.value.createdAt.getTime();
    newestMs ??= createdAtMs;
    if (createdAtMs < newestMs) break;
    items.push(next.value);
  }
  return items;
}

export async function fetchRedditHistory(
  config: WatchConfig,
  state: WatchState,
  deadlineMs?: number
): Promise<HistoryFetchResult> {
  const [userResult, avatarResult, postsResult, commentsResult] =
    await Promise.all([
      settle(reddit.getUserByUsername(config.displayUsername), deadlineMs),
      settle(
        redditUserProfile.getAvatarUrl(config.displayUsername),
        deadlineMs
      ),
      settle(
        config.postsEnabled
          ? collectSince(postListing(config), state.postCursorMs, deadlineMs)
          : Promise.resolve([]),
        deadlineMs
      ),
      settle(
        config.commentsEnabled
          ? collectSince(
              commentListing(config),
              state.commentCursorMs,
              deadlineMs
            )
          : Promise.resolve([]),
        deadlineMs
      ),
    ]);

  const fallback = cachedProfile(config);
  const user = userResult.ok ? userResult.value : undefined;
  const profile: WatchProfile = {
    displayName: user?.displayName || fallback.displayName,
    avatarUrl:
      (avatarResult.ok ? avatarResult.value : undefined) || fallback.avatarUrl,
    bio: user?.about.trim() || fallback.bio,
    joinedAtMs: user?.createdAt.getTime() || fallback.joinedAtMs,
    // Unknown profile state is treated as sensitive rather than exposing media.
    nsfw: userResult.ok && user ? Boolean(user.nsfw) : true,
  };

  const posts = postsResult.ok ? postsResult.value : [];
  const comments = commentsResult.ok ? commentsResult.value : [];
  const failedTypes: ActivityType[] = [];
  if (config.postsEnabled && !postsResult.ok) failedTypes.push('post');
  if (config.commentsEnabled && !commentsResult.ok) failedTypes.push('comment');
  const saturatedTypes: ActivityType[] = [];
  if (posts.length > REDDIT_HISTORY_LIMIT) saturatedTypes.push('post');
  if (comments.length > REDDIT_HISTORY_LIMIT) saturatedTypes.push('comment');

  const activities = [
    ...(saturatedTypes.includes('post') ? [] : posts)
      .filter((post) => post.createdAt.getTime() >= state.postCursorMs)
      .map((post) => mapPost(post, profile)),
    ...(saturatedTypes.includes('comment') ? [] : comments)
      .filter((comment) => comment.createdAt.getTime() >= state.commentCursorMs)
      .map((comment) => mapComment(comment, profile)),
  ].sort(
    (left, right) =>
      left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id)
  );

  return { activities, failedTypes, saturatedTypes };
}

export async function establishBaseline(
  config: WatchConfig,
  snapshotAtMs: number,
  deadlineMs?: number
): Promise<WatchState> {
  const [posts, comments] = await Promise.all([
    config.postsEnabled
      ? collectNewestBoundary(postListing(config), deadlineMs)
      : Promise.resolve([]),
    config.commentsEnabled
      ? collectNewestBoundary(commentListing(config), deadlineMs)
      : Promise.resolve([]),
  ]);
  const post = baselineBoundary(posts, snapshotAtMs);
  const comment = baselineBoundary(comments, snapshotAtMs);
  return {
    postCursorMs: post.cursorMs,
    commentCursorMs: comment.cursorMs,
    postCursorIds: post.cursorIds,
    commentCursorIds: comment.cursorIds,
    webhookBlocked: false,
  };
}

export async function resolveCommentParent(
  activity: RedditActivity,
  deadlineMs?: number
): Promise<RedditActivity> {
  if (activity.type !== 'comment' || !activity.parentId) return activity;
  const parentId = activity.parentId;

  const fallback: RedditActivity = {
    ...activity,
    parentAuthorName: '[deleted]',
    parentType: parentId.startsWith('t1_') ? 'comment' : 'post',
    parentPermalink: activity.permalink,
    sensitive: true,
  };

  const resolveParent = async (): Promise<RedditActivity> => {
    if (parentId.startsWith('t1_')) {
      const [parent, post] = await Promise.all([
        reddit.getCommentById(parentId as `t1_${string}`),
        activity.postId
          ? reddit.getPostById(activity.postId as `t3_${string}`)
          : Promise.resolve(undefined),
      ]);
      return {
        ...activity,
        parentAuthorName: parent.authorName,
        parentType: 'comment',
        parentPermalink: parent.permalink,
        sensitive:
          activity.sensitive ||
          !post ||
          post.nsfw ||
          post.quarantined ||
          post.spoiler,
      };
    }

    const parent = await reddit.getPostById(parentId as `t3_${string}`);
    return {
      ...activity,
      parentAuthorName: parent.authorName,
      parentType: 'post',
      parentPermalink: parent.permalink,
      sensitive:
        activity.sensitive ||
        parent.nsfw ||
        parent.quarantined ||
        parent.spoiler,
    };
  };

  try {
    return deadlineMs === undefined
      ? await resolveParent()
      : await beforeDeadline(resolveParent(), deadlineMs);
  } catch {
    return fallback;
  }
}
