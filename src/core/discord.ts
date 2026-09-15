import type { RedditActivity } from './types';
import { normalizeWebhookUrl } from './validation.ts';

export type DiscordDeliveryResult =
  | { ok: true }
  | {
      ok: false;
      kind: 'retry';
      message: string;
      retryAfterSeconds?: number | undefined;
    }
  | { ok: false; kind: 'blocked' | 'discard'; message: string };

type Fetch = typeof fetch;
const IS_COMPONENTS_V2 = 1 << 15;
const MAX_COMPONENT_TEXT_LENGTH = 4_000;
const GIPHY_COMMENT = /!\[gif\]\(giphy\|([A-Za-z0-9]+)\)/i;
const REDDIT_IMAGE =
  /!\[(?:gif|img)\]\((https:\/\/(?:preview|i)\.redd\.it\/[^\s)?#]+\.(?:gif|jpe?g|png|webp)(?:\?[^\s)]*)?)\)|(https:\/\/(?:preview|i)\.redd\.it\/[^\s)?#]+\.(?:gif|jpe?g|png|webp)(?:\?[^\s)]*)?)/i;
export const DISCORD_TIMEOUT_MS = 10_000;

function sanitizeText(value: string): string {
  const normalized = value.replace(/\r\n?/g, '\n');
  let sanitized = '';
  for (const character of normalized) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint === 10 || (codePoint >= 32 && codePoint !== 127)) {
      sanitized += character;
    }
  }
  return sanitized.replace(/[\u202A-\u202E\u2066-\u2069]/g, '');
}

function escapeMarkdown(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/([`*_{}[\]()<>#+\-.!|>~])/g, '\\$1');
}

function redditToDiscordMarkdown(value: string): string {
  return value
    .replace(/>!([\s\S]*?)!</g, '||$1||')
    .replace(/(^|\n)\^\(([^)\n]*)\)/g, '$1-# $2')
    .replace(/\^\(([^)\n]*)\)/g, '$1');
}

function truncate(
  value: string | undefined,
  limit: number
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (normalized.length <= limit) return normalized;
  let truncated = normalized.slice(0, limit - 3);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}...`;
}

function prepareText(
  value: string | undefined,
  limit: number
): string | undefined {
  if (!value) return undefined;
  return truncate(escapeMarkdown(sanitizeText(value)), limit);
}

function prepareMarkdown(
  value: string | undefined,
  limit: number
): string | undefined {
  if (!value) return undefined;
  return truncate(redditToDiscordMarkdown(sanitizeText(value)), limit);
}

function activityUrl(permalink: string): string {
  const parsed = new URL(permalink, 'https://reddit.com');
  return new URL(
    `${parsed.pathname}${parsed.search}`,
    'https://reddit.com'
  ).toString();
}

async function retryAfterSeconds(
  response: Response
): Promise<number | undefined> {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header;

  try {
    const body = (await response.json()) as { retry_after?: unknown };
    const value = Number(body.retry_after);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

async function discordErrorCode(
  response: Response
): Promise<number | undefined> {
  try {
    const body = (await response.json()) as { code?: unknown };
    const code = Number(body.code);
    return Number.isSafeInteger(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export async function verifyDiscordWebhook(
  webhookUrl: string,
  fetchImpl: Fetch = fetch
): Promise<void> {
  const normalizedUrl = normalizeWebhookUrl(webhookUrl);
  const verificationUrl = new URL(normalizedUrl);
  verificationUrl.search = '';
  let response: Response;
  try {
    response = await fetchImpl(verificationUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
    });
  } catch {
    throw new Error('Discord webhook validation could not reach Discord.');
  }
  if (!response.ok) {
    throw new Error(
      `Discord rejected the webhook with HTTP ${response.status}.`
    );
  }
}

export async function deliverLogToDiscord(
  webhookUrl: string,
  content: string,
  fetchImpl: Fetch = fetch
): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(normalizeWebhookUrl(webhookUrl));
  } catch {
    return false;
  }
  url.searchParams.delete('with_components');
  url.searchParams.set('wait', 'true');

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deliverToDiscord(
  webhookUrl: string,
  activity: RedditActivity,
  sourceSubredditName: string,
  fetchImpl: Fetch = fetch
): Promise<DiscordDeliveryResult> {
  let url: URL;
  try {
    url = new URL(normalizeWebhookUrl(webhookUrl));
  } catch {
    return {
      ok: false,
      kind: 'blocked',
      message:
        'Stored Discord webhook URL is invalid. Edit the webhook to retry.',
    };
  }
  url.searchParams.set('wait', 'true');
  url.searchParams.set('with_components', 'true');

  const timestamp = Math.floor(activity.createdAtMs / 1_000);
  const joinedTimestamp = Math.floor(activity.joinedRedditAtMs / 1_000);
  const profileUrl = `https://reddit.com/user/${encodeURIComponent(activity.authorName)}`;
  const displayName = prepareText(activity.displayName, 200) || 'Reddit user';
  const username =
    prepareText(`u/${activity.authorName}`, 100) || 'u/[deleted]';
  const bio = prepareText(activity.bio, 500);
  const title = prepareText(activity.title, 600);
  const parentUsername =
    prepareText(`u/${activity.parentAuthorName || '[deleted]'}`, 100) ||
    'u/[deleted]';
  const contextContent =
    activity.type === 'post'
      ? title
        ? `### ${title}`
        : undefined
      : `### Reply to [${parentUsername}](https://reddit.com/user/${encodeURIComponent(activity.parentAuthorName || '[deleted]')})'s [${activity.parentType || 'content'}](${activityUrl(activity.parentPermalink || activity.permalink)}) in [r/${escapeMarkdown(activity.subredditName)}](https://reddit.com/r/${encodeURIComponent(activity.subredditName)}):`;
  const headerContent = `# ${displayName} ([${username}](${profileUrl}))`;
  const joinedContent = `-# Joined Reddit <t:${joinedTimestamp}:R>`;
  const timestampContent = `-# Posted <t:${timestamp}:F> (<t:${timestamp}:R>) [r/${escapeMarkdown(sourceSubredditName)}]`;
  const sensitiveContent = activity.sensitive
    ? '-# Sensitive Reddit content. Open only if appropriate for the destination channel.'
    : undefined;
  const giphyMatch =
    activity.type === 'comment'
      ? activity.body?.match(GIPHY_COMMENT)
      : undefined;
  const redditImageMatch =
    activity.body?.match(REDDIT_IMAGE) ??
    (activity.type === 'post' ? activity.url?.match(REDDIT_IMAGE) : undefined);
  const mediaMatch =
    redditImageMatch?.input === activity.body ? redditImageMatch : giphyMatch;
  const mediaUrl = redditImageMatch
    ? redditImageMatch[1] || redditImageMatch[2]
    : giphyMatch
      ? `https://media.giphy.com/media/${giphyMatch[1]}/giphy.gif`
      : undefined;
  const bodyParts =
    mediaMatch?.index === undefined
      ? [activity.body || (mediaUrl ? undefined : 'No text content.')]
      : [
          activity.body?.slice(0, mediaMatch.index),
          activity.body?.slice(mediaMatch.index + mediaMatch[0].length),
        ];
  const fixedLength = [
    headerContent,
    bio ? `-# ${bio}` : undefined,
    joinedContent,
    contextContent,
    sensitiveContent,
    timestampContent,
  ].reduce((total, value) => total + (value?.length ?? 0), 0);
  let bodyBudget = Math.max(
    100,
    MAX_COMPONENT_TEXT_LENGTH -
      fixedLength -
      bodyParts.filter((part) => part?.trim()).length * 4
  );
  const bodyContents = bodyParts.map((part) => {
    if (bodyBudget < 4) return undefined;
    const content = prepareMarkdown(part, bodyBudget);
    bodyBudget -= content?.length ?? 0;
    return content;
  });
  const mediaComponent = mediaUrl
    ? {
        type: 12,
        items: [
          {
            media: { url: mediaUrl },
            description: `${redditImageMatch ? 'Image' : 'GIF'} posted by u/${activity.authorName} on Reddit.`,
            spoiler: activity.sensitive,
          },
        ],
      }
    : undefined;
  const bodyComponents = mediaComponent
    ? [
        ...(bodyContents[0]
          ? [{ type: 10, content: `>>> ${bodyContents[0]}` }]
          : []),
        mediaComponent,
        ...(bodyContents[1]
          ? [{ type: 10, content: `>>> ${bodyContents[1]}` }]
          : []),
      ]
    : bodyContents[0]
      ? [{ type: 10, content: `>>> ${bodyContents[0]}` }]
      : [];
  const containerComponents = [
    {
      type: 9,
      accessory: {
        type: 11,
        media: { url: activity.avatarUrl },
        description: `Reddit user u/${activity.authorName}'s avatar.`,
        spoiler: activity.sensitive,
      },
      components: [
        { type: 10, content: headerContent },
        ...(bio ? [{ type: 10, content: `-# ${bio}` }] : []),
        { type: 10, content: joinedContent },
      ],
    },
    ...(contextContent ? [{ type: 10, content: contextContent }] : []),
    ...(sensitiveContent ? [{ type: 10, content: sensitiveContent }] : []),
    ...bodyComponents,
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: timestampContent },
  ];

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(DISCORD_TIMEOUT_MS),
      body: JSON.stringify({
        username: 'Snoopy',
        allowed_mentions: { parse: [] },
        flags: IS_COMPONENTS_V2,
        components: [
          {
            type: 17,
            accent_color: 16_729_344,
            spoiler: activity.sensitive,
            components: containerComponents,
          },
          {
            type: 1,
            components: [
              {
                type: 2,
                style: 5,
                label: 'View on Reddit',
                emoji: null,
                disabled: false,
                url: activityUrl(activity.permalink),
              },
              {
                type: 2,
                style: 5,
                label: 'Powered by Snoopy',
                emoji: null,
                disabled: false,
                url: 'https://github.com/EthanC/Snoopy',
              },
            ],
          },
        ],
      }),
    });
  } catch {
    return {
      ok: false,
      kind: 'retry',
      message: 'Discord network request failed.',
    };
  }

  if (response.ok) return { ok: true };
  if (response.status === 429) {
    return {
      ok: false,
      kind: 'retry',
      message: 'Discord rate limited the webhook.',
      retryAfterSeconds: await retryAfterSeconds(response),
    };
  }
  if (response.status >= 500 || [408, 409, 425].includes(response.status)) {
    return {
      ok: false,
      kind: 'retry',
      message: `Discord returned HTTP ${response.status}.`,
    };
  }
  if ([401, 403, 404].includes(response.status)) {
    return {
      ok: false,
      kind: 'blocked',
      message: `Discord rejected the webhook with HTTP ${response.status}. Edit the webhook to retry.`,
    };
  }
  if (response.status === 400) {
    const code = await discordErrorCode(response);
    if (code === 220001) {
      return {
        ok: false,
        kind: 'blocked',
        message:
          'Discord requires a forum or media thread. Edit the webhook URL with a thread_id to retry.',
      };
    }
  }
  if (response.status >= 400 && response.status < 500) {
    return {
      ok: false,
      kind: 'discard',
      message: `Discord rejected one notification with HTTP ${response.status}.`,
    };
  }
  return {
    ok: false,
    kind: 'retry',
    message: `Discord returned unexpected HTTP ${response.status}.`,
  };
}
