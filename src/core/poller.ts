import { deliverToDiscord, DISCORD_TIMEOUT_MS } from './discord';
import { isAfterCursor, updateCursor } from './cursor';
import { errorName, log } from './logger';
import { fetchRedditHistory, resolveCommentParent } from './reddit-history';
import {
  acquirePollLock,
  cleanupSeen,
  getDueUsernames,
  getState,
  getWatch,
  isActivitySeen,
  markActivitySeen,
  releasePollLock,
  saveState,
  scheduleWatch,
  unscheduleWatch,
} from './storage';
import {
  MIN_INTERVAL_SECONDS,
  POLL_ACTIVITY_BATCH_SIZE,
  type RedditActivity,
  type WatchConfig,
  type WatchState,
} from './types';
import { isSubredditMatch } from './validation';

const SCHEDULER_BUDGET_MS = 20_000;
const PERSISTENCE_RESERVE_MS = 500;

export type PollUserOutcome = 'completed' | 'deferred' | 'failed' | 'skipped';
export type PollSummary = {
  selected: number;
  completed: number;
  failed: number;
  skipped: number;
  deferred: number;
  budgetExhausted: boolean;
};

export function activityMatches(
  config: WatchConfig,
  activity: RedditActivity
): boolean {
  const filters =
    activity.type === 'post' ? config.postSubreddits : config.commentSubreddits;
  return isSubredditMatch(filters, activity.subredditName);
}

async function persistPollResult(
  username: string,
  config: WatchConfig,
  state: WatchState,
  options: {
    backlog: boolean;
    retryAfterSeconds?: number | undefined;
  }
): Promise<void> {
  await saveState(username, state);
  const currentTime = Date.now();
  const delaySeconds =
    options.retryAfterSeconds !== undefined
      ? Math.max(MIN_INTERVAL_SECONDS, options.retryAfterSeconds)
      : options.backlog
        ? MIN_INTERVAL_SECONDS
        : config.intervalSeconds;
  await scheduleWatch(username, currentTime + delaySeconds * 1_000);
  await cleanupSeen(username, currentTime);
}

async function pollLocked(
  username: string,
  deadlineMs: number,
  sourceSubredditName: string
): Promise<PollUserOutcome> {
  const config = await getWatch(username);
  if (!config) {
    await cleanupSeen(username, Date.now());
    await unscheduleWatch(username);
    return 'skipped';
  }

  if (!config.notificationsEnabled) {
    await cleanupSeen(username, Date.now());
    await unscheduleWatch(username);
    return 'skipped';
  }

  const state = await getState(username);
  const fallbackCursorMs = Math.floor(Date.now() / 1_000) * 1_000;
  if (state.postCursorMs === 0) {
    state.postCursorMs = fallbackCursorMs;
    state.postCursorIds = [];
  }
  if (state.commentCursorMs === 0) {
    state.commentCursorMs = fallbackCursorMs;
    state.commentCursorIds = [];
  }
  state.lastPollAtMs = Date.now();

  if (state.webhookBlocked) {
    await persistPollResult(username, config, state, { backlog: false });
    return 'skipped';
  }

  let retryAfterSeconds: number | undefined;
  let deliveryFailed = false;
  let activityRejected = false;
  let backlog: boolean;
  let delivered = 0;
  let ignored = 0;

  try {
    const deliveryDeadlineMs =
      deadlineMs - DISCORD_TIMEOUT_MS - PERSISTENCE_RESERVE_MS;
    if (Date.now() >= deliveryDeadlineMs) {
      return 'deferred';
    }
    const history = await fetchRedditHistory(config, state, deliveryDeadlineMs);
    const candidates = history.activities.filter((activity) =>
      isAfterCursor(state, activity)
    );
    backlog =
      history.failedTypes.length > 0 || history.saturatedTypes.length > 0;
    let handled = 0;

    for (const activity of candidates) {
      if (Date.now() >= deadlineMs - PERSISTENCE_RESERVE_MS) {
        backlog = true;
        break;
      }
      if (await isActivitySeen(username, activity.id)) {
        updateCursor(state, activity);
        continue;
      }
      if (handled >= POLL_ACTIVITY_BATCH_SIZE) {
        backlog = true;
        break;
      }
      handled += 1;

      if (
        activity.removed ||
        activity.spam ||
        !activityMatches(config, activity)
      ) {
        await markActivitySeen(username, activity.id, Date.now());
        updateCursor(state, activity);
        ignored += 1;
        continue;
      }

      if (Date.now() >= deliveryDeadlineMs) {
        backlog = true;
        break;
      }
      const notification = await resolveCommentParent(
        activity,
        deliveryDeadlineMs
      );
      if (
        Date.now() + DISCORD_TIMEOUT_MS + PERSISTENCE_RESERVE_MS >
        deadlineMs
      ) {
        backlog = true;
        break;
      }
      const result = await deliverToDiscord(
        config.webhookUrl,
        notification,
        sourceSubredditName
      );
      if (!result.ok) {
        if (result.kind === 'discard') {
          activityRejected = true;
          state.lastError = result.message;
          await markActivitySeen(username, activity.id, Date.now());
          updateCursor(state, activity);
          ignored += 1;
          log.warn('discord_activity_rejected', { kind: result.kind });
          continue;
        }
        deliveryFailed = true;
        backlog = true;
        state.lastError = result.message;
        state.webhookBlocked = result.kind === 'blocked';
        retryAfterSeconds =
          result.kind === 'retry' ? result.retryAfterSeconds : undefined;
        log.warn('discord_delivery_failed', {
          kind: result.kind,
          status: state.webhookBlocked ? 'blocked' : 'retry',
        });
        break;
      }

      await markActivitySeen(username, activity.id, Date.now());
      updateCursor(state, activity);
      delivered += 1;
    }

    if (history.saturatedTypes.length > 0) {
      state.lastError = `Reddit ${history.saturatedTypes.join(' and ')} history exceeded the safe backlog. Disable notifications, save, then re-enable them to establish fresh baselines.`;
    } else if (history.failedTypes.length > 0) {
      state.lastError = `Reddit ${history.failedTypes.join(' and ')} history is temporarily unavailable.`;
    } else if (!deliveryFailed && !activityRejected) {
      state.lastSuccessAtMs = Date.now();
      state.lastError = undefined;
    }

    await persistPollResult(username, config, state, {
      backlog,
      retryAfterSeconds,
    });
    log.info('user_poll_complete', {
      delivered,
      ignored,
      candidates: candidates.length,
      partial: history.failedTypes.length > 0,
      saturated: history.saturatedTypes.length > 0,
      backlog,
      webhookBlocked: state.webhookBlocked,
    });
    return deliveryFailed ||
      activityRejected ||
      history.failedTypes.length > 0 ||
      history.saturatedTypes.length > 0
      ? 'failed'
      : 'completed';
  } catch (error) {
    state.lastError = 'Polling failed. Snoopy will retry automatically.';
    log.error('user_poll_failed', { errorType: errorName(error) });
    await persistPollResult(username, config, state, { backlog: true });
    return 'failed';
  }
}

export async function pollUser(
  username: string,
  deadlineMs: number,
  sourceSubredditName: string
): Promise<PollUserOutcome> {
  const lockToken = await acquirePollLock(username);
  if (!lockToken) {
    log.warn('user_poll_skipped_locked');
    return 'skipped';
  }

  try {
    return await pollLocked(username, deadlineMs, sourceSubredditName);
  } finally {
    await releasePollLock(username, lockToken);
  }
}

export async function pollDueWatches(
  sourceSubredditName: string,
  startedAtMs = Date.now(),
  budgetMs = SCHEDULER_BUDGET_MS
): Promise<PollSummary> {
  const usernames = await getDueUsernames(startedAtMs);
  const summary: PollSummary = {
    selected: usernames.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    deferred: 0,
    budgetExhausted: false,
  };
  const deadlineMs = startedAtMs + budgetMs;
  const workDeadlineMs =
    deadlineMs - DISCORD_TIMEOUT_MS - PERSISTENCE_RESERVE_MS;

  for (const username of usernames) {
    if (Date.now() >= workDeadlineMs) {
      summary.budgetExhausted = true;
      break;
    }
    try {
      const outcome = await pollUser(username, deadlineMs, sourceSubredditName);
      if (outcome === 'deferred') {
        summary.budgetExhausted = true;
        break;
      }
      summary[outcome] += 1;
    } catch (error) {
      summary.failed += 1;
      log.error('user_poll_infrastructure_failed', {
        errorType: errorName(error),
      });
    }
  }
  summary.deferred =
    summary.selected - summary.completed - summary.failed - summary.skipped;
  return summary;
}
