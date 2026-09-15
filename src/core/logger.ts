import { deliverLogToDiscord } from './discord.ts';
import { getLoggingConfig } from './storage.ts';
import type { LogLevel } from './types.ts';

type LogFields = Record<string, boolean | number | string | undefined>;
type LogOptions = {
  upgradeEvent?: boolean;
};
const MAX_DISCORD_CONTENT_LENGTH = 2_000;
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
};

export function formatLogMessage(entry: string): string {
  const prefix = '```json\n';
  const suffix = '\n```';
  const limit = MAX_DISCORD_CONTENT_LENGTH - prefix.length - suffix.length;
  const safe = entry.replace(/```/g, '``\u200b`');
  if (safe.length <= limit) return `${prefix}${safe}${suffix}`;

  let truncated = safe.slice(0, limit - 3);
  const finalCodeUnit = truncated.charCodeAt(truncated.length - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) {
    truncated = truncated.slice(0, -1);
  }
  return `${prefix}${truncated}...${suffix}`;
}

export async function forwardLogEntry(
  level: LogLevel,
  entry: string,
  options: LogOptions = {}
): Promise<void> {
  try {
    const config = await getLoggingConfig();
    if (
      !config ||
      (options.upgradeEvent
        ? !config.upgradeEventsEnabled
        : LEVEL_PRIORITY[level] < LEVEL_PRIORITY[config.level])
    ) {
      return;
    }
    await deliverLogToDiscord(config.webhookUrl, formatLogMessage(entry));
  } catch {
    // Logging must not interrupt moderation actions or scheduled polling.
  }
}

export async function writeLogEntry(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  options: LogOptions = {}
): Promise<void> {
  const entry = JSON.stringify({
    ...fields,
    timestamp: new Date().toISOString(),
    level,
    event,
  });

  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.info(entry);

  await forwardLogEntry(level, entry, options);
}

function write(level: LogLevel, event: string, fields: LogFields): void {
  void writeLogEntry(level, event, fields);
}

export const log = {
  info: (event: string, fields: LogFields = {}) => write('info', event, fields),
  warn: (event: string, fields: LogFields = {}) => write('warn', event, fields),
  error: (event: string, fields: LogFields = {}) =>
    write('error', event, fields),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
