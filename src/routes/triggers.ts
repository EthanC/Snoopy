import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';
import { log, writeLogEntry } from '../core/logger.ts';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  await c.req.json().catch(() => undefined);
  log.info('app_installed');
  return c.json<TriggerResponse>({}, 200);
});

triggers.post('/on-app-upgrade', async (c) => {
  await c.req.json().catch(() => undefined);
  await writeLogEntry(
    'info',
    'app_upgraded',
    {},
    {
      upgradeEvent: true,
    }
  );
  return c.json<TriggerResponse>({}, 200);
});
