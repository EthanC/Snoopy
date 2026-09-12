import { Hono } from 'hono';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import { errorName, log } from '../core/logger';
import { pollDueWatches } from '../core/poller';
import { cleanupAllSeen } from '../core/storage';

export const schedulerRoutes = new Hono();

schedulerRoutes.post('/poll-watchlist', async (c) => {
  const startedAt = Date.now();
  try {
    await c.req.json<TaskRequest>().catch(() => undefined);
    const summary = await pollDueWatches(startedAt);
    log.info('scheduler_poll_complete', {
      selected: summary.selected,
      completed: summary.completed,
      failed: summary.failed,
      skipped: summary.skipped,
      deferred: summary.deferred,
      budgetExhausted: summary.budgetExhausted,
      durationMs: Date.now() - startedAt,
    });
    return c.json<TaskResponse>({}, 200);
  } catch (error) {
    log.error('scheduler_poll_failed', {
      errorType: errorName(error),
      durationMs: Date.now() - startedAt,
    });
    return c.json<TaskResponse>({}, 500);
  }
});

schedulerRoutes.post('/cleanup-seen', async (c) => {
  const startedAt = Date.now();
  try {
    await c.req.json<TaskRequest>().catch(() => undefined);
    const watches = await cleanupAllSeen(startedAt);
    log.info('scheduler_cleanup_complete', {
      watches,
      durationMs: Date.now() - startedAt,
    });
    return c.json<TaskResponse>({}, 200);
  } catch (error) {
    log.error('scheduler_cleanup_failed', {
      errorType: errorName(error),
      durationMs: Date.now() - startedAt,
    });
    return c.json<TaskResponse>({}, 500);
  }
});
