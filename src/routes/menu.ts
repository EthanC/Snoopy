import { Hono } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type { UiResponse } from '@devvit/web/shared';
import { requireModerator } from '../core/authorization.ts';
import { deliverToDiscord } from '../core/discord.ts';
import {
  addWatchForm,
  removeWatchForm,
  selectEditForm,
  watchlistForm,
} from '../core/forms.ts';
import { errorName, log } from '../core/logger.ts';
import {
  activityFromComment,
  activityFromPost,
  resolveCommentParent,
} from '../core/reddit-history.ts';
import {
  acquirePollLock,
  getState,
  getWatch,
  listWatches,
  markActivitySeen,
  releasePollLock,
  saveState,
} from '../core/storage.ts';
import { normalizeUsername, redactWebhookUrl } from '../core/validation.ts';

export const menu = new Hono();

function toast(text: string): UiResponse {
  return { showToast: { text, appearance: 'neutral' } };
}

function success(text: string): UiResponse {
  return { showToast: { text, appearance: 'success' } };
}

menu.post('/add-watch', async (c) => {
  try {
    await requireModerator();
    return c.json<UiResponse>({
      showForm: { name: 'addWatch', form: addWatchForm() },
    });
  } catch (error) {
    return c.json<UiResponse>(
      toast(error instanceof Error ? error.message : 'Access denied.')
    );
  }
});

menu.post('/edit-watch', async (c) => {
  try {
    await requireModerator();
    const configs = await listWatches();
    if (configs.length === 0)
      return c.json<UiResponse>(toast('The watchlist is empty.'));
    return c.json<UiResponse>({
      showForm: { name: 'selectEditWatch', form: selectEditForm(configs) },
    });
  } catch (error) {
    return c.json<UiResponse>(
      toast(error instanceof Error ? error.message : 'Unable to edit.')
    );
  }
});

menu.post('/remove-watch', async (c) => {
  try {
    await requireModerator();
    const configs = await listWatches();
    if (configs.length === 0)
      return c.json<UiResponse>(toast('The watchlist is empty.'));
    return c.json<UiResponse>({
      showForm: { name: 'removeWatch', form: removeWatchForm(configs) },
    });
  } catch (error) {
    return c.json<UiResponse>(
      toast(error instanceof Error ? error.message : 'Unable to remove.')
    );
  }
});

menu.post('/list-watches', async (c) => {
  try {
    await requireModerator();
    const configs = await listWatches();
    if (configs.length === 0)
      return c.json<UiResponse>(toast('The watchlist is empty.'));
    const states = await Promise.all(
      configs.map((config) => getState(config.username))
    );
    const summary = configs
      .map((config, index) => {
        const state = states[index];
        const posts = config.postsEnabled
          ? `posts: ${config.postSubreddits.join(', ') || 'all'}`
          : 'posts: off';
        const comments = config.commentsEnabled
          ? `comments: ${config.commentSubreddits.join(', ') || 'all'}`
          : 'comments: off';
        const status = !config.notificationsEnabled
          ? 'disabled'
          : state?.webhookBlocked
            ? 'webhook blocked'
            : 'enabled';
        return [
          `u/${config.displayUsername} (${status}, ${config.intervalSeconds}s)`,
          `${posts}; ${comments}`,
          `webhook: ${redactWebhookUrl(config.webhookUrl)}`,
          state?.lastError ? `last error: ${state.lastError}` : undefined,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n')
      .slice(0, 10_000);

    return c.json<UiResponse>({
      showForm: { name: 'closeWatchlist', form: watchlistForm(summary) },
    });
  } catch (error) {
    return c.json<UiResponse>(
      toast(error instanceof Error ? error.message : 'Unable to list.')
    );
  }
});

menu.post('/send-notification', async (c) => {
  let username: string | undefined;
  let lockToken: string | undefined;
  try {
    await requireModerator();
    const target = context.commentId
      ? ({
          type: 'comment',
          value: await reddit.getCommentById(context.commentId),
        } as const)
      : context.postId
        ? ({
            type: 'post',
            value: await reddit.getPostById(context.postId),
          } as const)
        : undefined;
    if (!target) throw new Error('Run this action on a post or comment.');
    if (target.value.authorName === '[deleted]') {
      throw new Error('Notifications cannot be sent for deleted users.');
    }

    username = normalizeUsername(target.value.authorName);
    lockToken = await acquirePollLock(username);
    if (!lockToken) {
      throw new Error(
        `u/${target.value.authorName} is being checked. Try again.`
      );
    }

    const config = await getWatch(username);
    if (!config) {
      throw new Error(`u/${target.value.authorName} is not watched.`);
    }
    const activity = await resolveCommentParent(
      target.type === 'comment'
        ? activityFromComment(target.value, config)
        : activityFromPost(target.value, config)
    );
    const result = await deliverToDiscord(
      config.webhookUrl,
      activity,
      context.subredditName
    );
    const state = await getState(username);
    state.webhookBlocked = !result.ok && result.kind === 'blocked';

    if (result.ok) {
      const nowMs = Date.now();
      await markActivitySeen(username, activity.id, nowMs);
      state.lastSuccessAtMs = nowMs;
      state.lastError = undefined;
      await saveState(username, state);
      log.info('manual_notification_sent', { activityType: activity.type });
      return c.json<UiResponse>(
        success(`Sent the notification for u/${config.displayUsername}.`)
      );
    }

    state.lastError = result.message;
    if (result.kind === 'discard') {
      await markActivitySeen(username, activity.id, Date.now());
    }
    await saveState(username, state);
    log.warn('manual_notification_failed', {
      activityType: activity.type,
      kind: result.kind,
    });
    return c.json<UiResponse>(toast(result.message));
  } catch (error) {
    log.warn('manual_notification_failed', { errorType: errorName(error) });
    return c.json<UiResponse>(
      toast(
        error instanceof Error
          ? error.message
          : 'Unable to send the notification.'
      )
    );
  } finally {
    if (username && lockToken) {
      await releasePollLock(username, lockToken);
    }
  }
});
