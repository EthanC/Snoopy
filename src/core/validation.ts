import {
  DEFAULT_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  type WatchInput,
} from './types.ts';

export class ValidationError extends Error {}

const USERNAME_PATTERN = /^[a-z0-9_-]{3,20}$/i;
const SUBREDDIT_PATTERN = /^[a-z0-9_]{2,21}$/i;
const MAX_SUBREDDIT_FILTER_LENGTH = 5_000;
const MAX_SUBREDDIT_FILTERS = 100;
const MAX_WEBHOOK_URL_LENGTH = 2_048;
const WEBHOOK_PATH_PATTERN =
  /^\/api(?:\/v\d+)?\/webhooks\/\d{17,20}\/[A-Za-z0-9._-]{40,512}$/;
const WEBHOOK_HOSTS = new Set(['discord.com', 'canary.discord.com']);

export function normalizeUsername(input: string): string {
  const username = input
    .trim()
    .replace(/^\/?u\//i, '')
    .toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw new ValidationError(
      'Enter a valid Reddit username using 3-20 letters, numbers, underscores, or hyphens.'
    );
  }
  return username;
}

export function normalizeSubreddits(input: string | undefined): string[] {
  if (!input?.trim()) return [];
  if (input.length > MAX_SUBREDDIT_FILTER_LENGTH) {
    throw new ValidationError('Subreddit filters are too long.');
  }

  const names = input
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((name) => name.replace(/^\/?r\//i, '').toLowerCase());

  const invalid = names.find((name) => !SUBREDDIT_PATTERN.test(name));
  if (invalid) {
    throw new ValidationError(`Invalid subreddit: ${invalid}`);
  }

  const unique = [...new Set(names)].sort();
  if (unique.length > MAX_SUBREDDIT_FILTERS) {
    throw new ValidationError(
      `Use no more than ${MAX_SUBREDDIT_FILTERS} subreddit filters per activity type.`
    );
  }
  return unique;
}

export function normalizeWebhookUrl(input: string): string {
  if (input.length > MAX_WEBHOOK_URL_LENGTH) {
    throw new ValidationError('Discord webhook URL is too long.');
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ValidationError('Enter a valid Discord webhook URL.');
  }

  if (
    url.protocol !== 'https:' ||
    !WEBHOOK_HOSTS.has(url.hostname.toLowerCase()) ||
    url.port !== '' ||
    url.username ||
    url.password ||
    url.hash ||
    !WEBHOOK_PATH_PATTERN.test(url.pathname)
  ) {
    throw new ValidationError('Use an HTTPS Discord webhook from Discord.');
  }

  const unsupportedParameter = [...url.searchParams.keys()].find(
    (name) => !['thread_id', 'with_components'].includes(name)
  );
  if (unsupportedParameter) {
    throw new ValidationError(
      `Unsupported Discord webhook URL parameter: ${unsupportedParameter}`
    );
  }

  const threadIds = url.searchParams.getAll('thread_id');
  if (
    threadIds.length > 1 ||
    (threadIds[0] !== undefined && !/^\d{17,20}$/.test(threadIds[0]))
  ) {
    throw new ValidationError('Discord thread_id must be a Discord ID.');
  }

  url.search = '';
  if (threadIds[0]) url.searchParams.set('thread_id', threadIds[0]);
  url.searchParams.set('with_components', 'true');

  return url.toString();
}

export function redactWebhookUrl(input: string): string {
  try {
    const url = new URL(input);
    const parts = url.pathname.split('/');
    const id = parts.at(-2) ?? '';
    return `${url.hostname}/api/webhooks/${id}/***`;
  } catch {
    return '[invalid webhook]';
  }
}

export function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function parseInterval(value: unknown): number {
  const interval =
    value === undefined ? DEFAULT_INTERVAL_SECONDS : Number(value);
  if (
    !Number.isInteger(interval) ||
    interval < MIN_INTERVAL_SECONDS ||
    interval > MAX_INTERVAL_SECONDS
  ) {
    throw new ValidationError(
      `Update interval must be a whole number from ${MIN_INTERVAL_SECONDS} to ${MAX_INTERVAL_SECONDS} seconds.`
    );
  }
  return interval;
}

type RawWatchInput = {
  username?: unknown;
  webhookUrl?: unknown;
  notificationsEnabled?: unknown;
  postsEnabled?: unknown;
  commentsEnabled?: unknown;
  postSubreddits?: unknown;
  commentSubreddits?: unknown;
  intervalSeconds?: unknown;
};

export function parseWatchInput(
  raw: RawWatchInput,
  requireWebhook: boolean
): WatchInput {
  if (typeof raw.username !== 'string') {
    throw new ValidationError('Reddit username is required.');
  }

  const postsEnabled = parseBoolean(raw.postsEnabled);
  const commentsEnabled = parseBoolean(raw.commentsEnabled);
  if (!postsEnabled && !commentsEnabled) {
    throw new ValidationError('Enable posts, comments, or both.');
  }

  const webhookValue =
    typeof raw.webhookUrl === 'string' ? raw.webhookUrl.trim() : '';
  if (requireWebhook && !webhookValue) {
    throw new ValidationError('Discord webhook URL is required.');
  }

  return {
    username: normalizeUsername(raw.username),
    webhookUrl: webhookValue ? normalizeWebhookUrl(webhookValue) : undefined,
    notificationsEnabled: parseBoolean(raw.notificationsEnabled),
    postsEnabled,
    commentsEnabled,
    postSubreddits: normalizeSubreddits(
      typeof raw.postSubreddits === 'string' ? raw.postSubreddits : undefined
    ),
    commentSubreddits: normalizeSubreddits(
      typeof raw.commentSubreddits === 'string'
        ? raw.commentSubreddits
        : undefined
    ),
    intervalSeconds: parseInterval(raw.intervalSeconds),
  };
}

export function isSubredditMatch(
  filters: readonly string[],
  subredditName: string
): boolean {
  return filters.length === 0 || filters.includes(subredditName.toLowerCase());
}
