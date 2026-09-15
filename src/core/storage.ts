import { redis } from '@devvit/web/server';
import {
  LOG_LEVELS,
  SEEN_MAX_PER_USER,
  SEEN_RETENTION_SECONDS,
  type LoggingConfig,
  type WatchConfig,
  type WatchState,
} from './types.ts';

const WATCHLIST_KEY = 'snoopy:watchlist';
const DUE_KEY = 'snoopy:due';
const configKey = (username: string) => `snoopy:watch:${username}`;
const stateKey = (username: string) => `snoopy:state:${username}`;
const seenKey = (username: string) => `snoopy:seen:${username}`;
const lockKey = (username: string) => `snoopy:lock:${username}`;
const CONFIG_LOCK_KEY = 'snoopy:lock:configuration';
const LOGGING_CONFIG_KEY = 'snoopy:logging';

const bool = (value: boolean) => (value ? '1' : '0');
const parseBool = (value: string | undefined) => value === '1';
const parseNumber = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export async function getWatch(
  username: string
): Promise<WatchConfig | undefined> {
  const fields = await redis.hGetAll(configKey(username));
  if (!fields.username || !fields.webhookUrl) return undefined;

  return {
    username: fields.username,
    displayUsername: fields.displayUsername ?? fields.username,
    profileDisplayName:
      fields.profileDisplayName ?? fields.displayUsername ?? fields.username,
    profileAvatarUrl:
      fields.profileAvatarUrl ??
      'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png',
    profileBio: fields.profileBio || undefined,
    profileJoinedAtMs: parseNumber(
      fields.profileJoinedAtMs,
      parseNumber(fields.createdAtMs)
    ),
    profileNsfw: parseBool(fields.profileNsfw),
    webhookUrl: fields.webhookUrl,
    notificationsEnabled: parseBool(fields.notificationsEnabled),
    postsEnabled: parseBool(fields.postsEnabled),
    commentsEnabled: parseBool(fields.commentsEnabled),
    postSubreddits: fields.postSubreddits?.split('\n').filter(Boolean) ?? [],
    commentSubreddits:
      fields.commentSubreddits?.split('\n').filter(Boolean) ?? [],
    intervalSeconds: parseNumber(fields.intervalSeconds, 60),
    createdAtMs: parseNumber(fields.createdAtMs),
    updatedAtMs: parseNumber(fields.updatedAtMs),
  };
}

export async function listWatches(): Promise<WatchConfig[]> {
  const members = await redis.zRange(WATCHLIST_KEY, 0, -1, { by: 'rank' });
  const watches = await Promise.all(
    members.map(({ member }) => getWatch(member))
  );
  return watches.filter((watch): watch is WatchConfig => watch !== undefined);
}

export async function getLoggingConfig(): Promise<LoggingConfig | undefined> {
  const fields = await redis.hGetAll(LOGGING_CONFIG_KEY);
  if (
    !fields.webhookUrl ||
    !(LOG_LEVELS as readonly string[]).includes(fields.level ?? '')
  ) {
    return undefined;
  }
  return {
    level: fields.level as LoggingConfig['level'],
    webhookUrl: fields.webhookUrl,
    upgradeEventsEnabled:
      fields.upgradeEventsEnabled === undefined
        ? true
        : parseBool(fields.upgradeEventsEnabled),
  };
}

export async function saveLoggingConfig(config: LoggingConfig): Promise<void> {
  await redis.hSet(LOGGING_CONFIG_KEY, {
    level: config.level,
    webhookUrl: config.webhookUrl,
    upgradeEventsEnabled: bool(config.upgradeEventsEnabled),
  });
}

export async function removeLoggingConfig(): Promise<void> {
  await redis.del(LOGGING_CONFIG_KEY);
}

function configFields(config: WatchConfig): Record<string, string> {
  return {
    username: config.username,
    displayUsername: config.displayUsername,
    profileDisplayName: config.profileDisplayName,
    profileAvatarUrl: config.profileAvatarUrl,
    profileBio: config.profileBio ?? '',
    profileJoinedAtMs: String(config.profileJoinedAtMs),
    profileNsfw: bool(config.profileNsfw),
    webhookUrl: config.webhookUrl,
    notificationsEnabled: bool(config.notificationsEnabled),
    postsEnabled: bool(config.postsEnabled),
    commentsEnabled: bool(config.commentsEnabled),
    postSubreddits: config.postSubreddits.join('\n'),
    commentSubreddits: config.commentSubreddits.join('\n'),
    intervalSeconds: String(config.intervalSeconds),
    createdAtMs: String(config.createdAtMs),
    updatedAtMs: String(config.updatedAtMs),
  };
}

function stateFields(state: WatchState): Record<string, string> {
  return {
    postCursorMs: String(state.postCursorMs),
    commentCursorMs: String(state.commentCursorMs),
    postCursorIds: state.postCursorIds.join('\n'),
    commentCursorIds: state.commentCursorIds.join('\n'),
    lastPollAtMs:
      state.lastPollAtMs === undefined ? '' : String(state.lastPollAtMs),
    lastSuccessAtMs:
      state.lastSuccessAtMs === undefined ? '' : String(state.lastSuccessAtMs),
    lastError: state.lastError ?? '',
    webhookBlocked: bool(state.webhookBlocked),
  };
}

export async function saveWatchWithState(
  config: WatchConfig,
  state: WatchState,
  dueAtMs?: number
): Promise<void> {
  const configStorageKey = configKey(config.username);
  const stateStorageKey = stateKey(config.username);
  const txn = await redis.watch(
    configStorageKey,
    stateStorageKey,
    WATCHLIST_KEY
  );
  await txn.multi();
  await txn.hSet(configStorageKey, configFields(config));
  await txn.hSet(stateStorageKey, stateFields(state));
  await txn.zAdd(WATCHLIST_KEY, { member: config.username, score: 0 });
  if (dueAtMs === undefined) await txn.zRem(DUE_KEY, [config.username]);
  else await txn.zAdd(DUE_KEY, { member: config.username, score: dueAtMs });
  if ((await txn.exec()) === null)
    throw new Error('Configuration changed concurrently. Try again.');
}

export async function removeWatch(username: string): Promise<void> {
  const configStorageKey = configKey(username);
  const stateStorageKey = stateKey(username);
  const seenStorageKey = seenKey(username);
  const txn = await redis.watch(
    configStorageKey,
    stateStorageKey,
    seenStorageKey,
    WATCHLIST_KEY
  );
  await txn.multi();
  await txn.zRem(WATCHLIST_KEY, [username]);
  await txn.zRem(DUE_KEY, [username]);
  await txn.del(configStorageKey, stateStorageKey, seenStorageKey);
  if ((await txn.exec()) === null)
    throw new Error('Configuration changed concurrently. Try again.');
}

export async function getState(username: string): Promise<WatchState> {
  const fields = await redis.hGetAll(stateKey(username));
  return {
    postCursorMs: parseNumber(fields.postCursorMs),
    commentCursorMs: parseNumber(fields.commentCursorMs),
    postCursorIds: fields.postCursorIds?.split('\n').filter(Boolean) ?? [],
    commentCursorIds:
      fields.commentCursorIds?.split('\n').filter(Boolean) ?? [],
    lastPollAtMs: fields.lastPollAtMs
      ? parseNumber(fields.lastPollAtMs)
      : undefined,
    lastSuccessAtMs: fields.lastSuccessAtMs
      ? parseNumber(fields.lastSuccessAtMs)
      : undefined,
    lastError: fields.lastError || undefined,
    webhookBlocked: parseBool(fields.webhookBlocked),
  };
}

export async function saveState(
  username: string,
  state: WatchState
): Promise<void> {
  await redis.hSet(stateKey(username), stateFields(state));
}

export async function scheduleWatch(
  username: string,
  dueAtMs: number
): Promise<void> {
  await redis.zAdd(DUE_KEY, { member: username, score: dueAtMs });
}

export async function unscheduleWatch(username: string): Promise<void> {
  await redis.zRem(DUE_KEY, [username]);
}

export async function getDueUsernames(nowMs: number): Promise<string[]> {
  const members = await redis.zRange(DUE_KEY, 0, nowMs, {
    by: 'score',
  });
  return members.map(({ member }) => member);
}

export async function acquirePollLock(
  username: string
): Promise<string | undefined> {
  return acquireLock(lockKey(username));
}

export async function acquireConfigLock(): Promise<string | undefined> {
  return acquireLock(CONFIG_LOCK_KEY);
}

async function acquireLock(key: string): Promise<string | undefined> {
  const nowMs = Date.now();
  const token = `${nowMs}:${crypto.randomUUID()}`;
  const result = await redis.set(key, token, {
    nx: true,
    expiration: new Date(nowMs + 120_000),
  });
  return result === 'OK' ? token : undefined;
}

export async function releasePollLock(
  username: string,
  token: string
): Promise<void> {
  await releaseLock(lockKey(username), token);
}

export async function releaseConfigLock(token: string): Promise<void> {
  await releaseLock(CONFIG_LOCK_KEY, token);
}

async function releaseLock(key: string, token: string): Promise<void> {
  if ((await redis.get(key)) === token) await redis.del(key);
}

export async function isActivitySeen(
  username: string,
  activityId: string
): Promise<boolean> {
  return (await redis.zScore(seenKey(username), activityId)) !== undefined;
}

export async function markActivitySeen(
  username: string,
  activityId: string,
  processedAtMs: number
): Promise<void> {
  await redis.zAdd(seenKey(username), {
    member: activityId,
    score: processedAtMs,
  });
}

export async function cleanupSeen(
  username: string,
  nowMs: number
): Promise<void> {
  const key = seenKey(username);
  await redis.zRemRangeByScore(key, 0, nowMs - SEEN_RETENTION_SECONDS * 1_000);
  const count = await redis.zCard(key);
  if (count > SEEN_MAX_PER_USER) {
    await redis.zRemRangeByRank(key, 0, count - SEEN_MAX_PER_USER - 1);
  }
}

export async function cleanupAllSeen(nowMs: number): Promise<number> {
  const watches = await listWatches();
  await Promise.all(watches.map((watch) => cleanupSeen(watch.username, nowMs)));
  return watches.length;
}
