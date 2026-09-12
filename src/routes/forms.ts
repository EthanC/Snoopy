import { Hono } from 'hono';
import { reddit } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { requireModerator } from '../core/authorization';
import {
  createWatchConfig,
  decodeWatchRevision,
  isCurrentRevision,
  updateStateForEdit,
  updateWatchConfig,
  watchNeedsBaseline,
} from '../core/configuration';
import { verifyDiscordWebhook } from '../core/discord';
import { editWatchForm } from '../core/forms';
import { errorName, log } from '../core/logger';
import {
  DEFAULT_AVATAR_URL,
  establishBaseline,
  redditUserProfile,
} from '../core/reddit-history';
import {
  acquireConfigLock,
  acquirePollLock,
  getState,
  getWatch,
  releaseConfigLock,
  releasePollLock,
  removeWatch,
  saveWatchWithState,
} from '../core/storage';
import {
  normalizeUsername,
  parseBoolean,
  parseWatchInput,
  ValidationError,
} from '../core/validation';

type FormValues = Record<string, unknown>;
type MutationLocks = {
  config: string;
  user?: string | undefined;
  username?: string | undefined;
};

export const forms = new Hono();
const FORM_REQUEST_BUDGET_MS = 25_000;

function success(text: string): UiResponse {
  return { showToast: { text, appearance: 'success' } };
}

function failure(error: unknown): UiResponse {
  const text =
    error instanceof Error
      ? error.message
      : 'Snoopy could not save the configuration.';
  return { showToast: { text, appearance: 'neutral' } };
}

function selectedUsername(value: unknown): string {
  const selected = Array.isArray(value) ? value[0] : value;
  if (typeof selected !== 'string') {
    throw new ValidationError('Select a watched user.');
  }
  return normalizeUsername(selected);
}

function selectedRevision(value: unknown) {
  const selected = Array.isArray(value) ? value[0] : value;
  if (typeof selected !== 'string') {
    throw new ValidationError('Select a watched user.');
  }
  const revision = decodeWatchRevision(selected);
  if (!revision)
    throw new ValidationError('The watch form is invalid. Open it again.');
  return { ...revision, username: normalizeUsername(revision.username) };
}

async function acquireMutationLocks(username?: string): Promise<MutationLocks> {
  const config = await acquireConfigLock();
  if (!config) {
    throw new ValidationError(
      'Another moderator is changing Snoopy. Try again.'
    );
  }
  if (!username) return { config };

  const user = await acquirePollLock(username);
  if (!user) {
    await releaseConfigLock(config);
    throw new ValidationError(
      `u/${username} is being checked. Try again in a minute.`
    );
  }
  return { config, user, username };
}

async function releaseMutationLocks(
  locks: MutationLocks | undefined
): Promise<void> {
  if (!locks) return;
  try {
    if (locks.user && locks.username) {
      await releasePollLock(locks.username, locks.user);
    }
  } finally {
    await releaseConfigLock(locks.config);
  }
}

forms.post('/add-watch', async (c) => {
  const deadlineMs = Date.now() + FORM_REQUEST_BUDGET_MS;
  let locks: MutationLocks | undefined;
  try {
    await requireModerator();
    const values = await c.req.json<FormValues>();
    const input = parseWatchInput(values, true);
    if (await getWatch(input.username)) {
      throw new ValidationError(`u/${input.username} is already watched.`);
    }
    if (!input.webhookUrl) {
      throw new ValidationError('Discord webhook URL is required.');
    }

    const [user, avatarUrl] = await Promise.all([
      reddit.getUserByUsername(input.username),
      redditUserProfile.getAvatarUrl(input.username).catch(() => undefined),
      verifyDiscordWebhook(input.webhookUrl),
    ]);
    if (!user) {
      throw new ValidationError(
        `Reddit user u/${input.username} was not found.`
      );
    }

    const snapshotAtMs = Date.now();
    const config = createWatchConfig(
      input,
      user.username,
      {
        displayName: user.displayName || user.username,
        avatarUrl: avatarUrl || DEFAULT_AVATAR_URL,
        bio: user.about.trim() || undefined,
        joinedAtMs: user.createdAt.getTime(),
        nsfw: user.nsfw,
      },
      snapshotAtMs
    );
    const state = await establishBaseline(config, snapshotAtMs, deadlineMs);
    const nowMs = Date.now();
    locks = await acquireMutationLocks(input.username);
    if (await getWatch(input.username)) {
      throw new ValidationError(`u/${input.username} is already watched.`);
    }
    const dueAtMs = config.notificationsEnabled
      ? nowMs + config.intervalSeconds * 1_000
      : undefined;
    await saveWatchWithState(config, state, dueAtMs);
    log.info('watch_added', {
      intervalSeconds: config.intervalSeconds,
    });
    return c.json<UiResponse>(
      success(`Now watching u/${config.displayUsername}.`)
    );
  } catch (error) {
    log.warn('watch_add_failed', { errorType: errorName(error) });
    return c.json<UiResponse>(failure(error));
  } finally {
    await releaseMutationLocks(locks);
  }
});

forms.post('/select-edit-watch', async (c) => {
  try {
    await requireModerator();
    const values = await c.req.json<FormValues>();
    const username = selectedUsername(values.username);
    const config = await getWatch(username);
    if (!config) {
      throw new ValidationError(`u/${username} is no longer configured.`);
    }
    return c.json<UiResponse>({
      showForm: {
        name: 'editWatch',
        form: editWatchForm(config),
      },
    });
  } catch (error) {
    return c.json<UiResponse>(failure(error));
  }
});

forms.post('/edit-watch', async (c) => {
  const deadlineMs = Date.now() + FORM_REQUEST_BUDGET_MS;
  let locks: MutationLocks | undefined;
  try {
    await requireModerator();
    const values = await c.req.json<FormValues>();
    const revision = selectedRevision(values.username);
    const input = parseWatchInput(
      { ...values, username: revision.username },
      false
    );
    locks = await acquireMutationLocks(revision.username);
    const previous = await getWatch(revision.username);
    if (!previous) {
      throw new ValidationError(
        `u/${revision.username} is no longer configured.`
      );
    }
    if (!isCurrentRevision(previous, revision)) {
      throw new ValidationError(
        'This watch changed after the form opened. Open it again.'
      );
    }

    if (input.webhookUrl) await verifyDiscordWebhook(input.webhookUrl);
    const nowMs = Date.now();
    const next = updateWatchConfig(previous, input, nowMs);
    const previousState = await getState(revision.username);
    const webhookValidated = Boolean(input.webhookUrl);
    const baseline = watchNeedsBaseline(previous, next)
      ? await establishBaseline(next, nowMs, deadlineMs)
      : undefined;
    const nextState = updateStateForEdit(
      previous,
      next,
      previousState,
      webhookValidated,
      nowMs,
      baseline
    );
    const dueAtMs = next.notificationsEnabled
      ? nowMs + next.intervalSeconds * 1_000
      : undefined;

    await saveWatchWithState(next, nextState, dueAtMs);
    log.info('watch_updated', {
      intervalSeconds: next.intervalSeconds,
    });
    return c.json<UiResponse>(success(`Updated u/${next.displayUsername}.`));
  } catch (error) {
    log.warn('watch_update_failed', { errorType: errorName(error) });
    return c.json<UiResponse>(failure(error));
  } finally {
    await releaseMutationLocks(locks);
  }
});

forms.post('/remove-watch', async (c) => {
  let locks: MutationLocks | undefined;
  try {
    await requireModerator();
    const values = await c.req.json<FormValues>();
    const revision = selectedRevision(values.username);
    if (!parseBoolean(values.confirm)) {
      throw new ValidationError('Confirm permanent removal first.');
    }
    locks = await acquireMutationLocks(revision.username);
    const config = await getWatch(revision.username);
    if (!config) {
      throw new ValidationError(
        `u/${revision.username} is no longer configured.`
      );
    }
    if (!isCurrentRevision(config, revision)) {
      throw new ValidationError(
        'This watch changed after the form opened. Open it again.'
      );
    }
    await removeWatch(revision.username);
    log.info('watch_removed');
    return c.json<UiResponse>(success(`Removed u/${config.displayUsername}.`));
  } catch (error) {
    log.warn('watch_remove_failed', { errorType: errorName(error) });
    return c.json<UiResponse>(failure(error));
  } finally {
    await releaseMutationLocks(locks);
  }
});

forms.post('/close-watchlist', async (c) => {
  try {
    await requireModerator();
    return c.json<UiResponse>({ showToast: 'Watchlist closed.' });
  } catch (error) {
    return c.json<UiResponse>(failure(error));
  }
});
