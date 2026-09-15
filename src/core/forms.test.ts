import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addWatchForm,
  editWatchForm,
  loggingConfigForm,
  watchlistForm,
} from './forms.ts';
import type { WatchConfig } from './types.ts';

const config: WatchConfig = {
  username: 'example_user',
  displayUsername: 'Example_User',
  profileDisplayName: 'Example User',
  profileAvatarUrl: 'https://www.redditstatic.com/example.png',
  profileJoinedAtMs: 1_600_000_000_000,
  profileNsfw: false,
  webhookUrl: `https://discord.com/api/webhooks/12345678901234567/${'a'.repeat(64)}`,
  notificationsEnabled: false,
  postsEnabled: true,
  commentsEnabled: false,
  postSubreddits: ['news', 'worldnews'],
  commentSubreddits: ['askreddit'],
  intervalSeconds: 300,
  createdAtMs: 100,
  updatedAtMs: 200,
};

void test('webhook fields use the secret scope required by Devvit', () => {
  const webhook = addWatchForm().fields.find(
    (field) => 'name' in field && field.name === 'webhookUrl'
  );
  assert.ok(webhook && webhook.type === 'string');
  assert.equal(webhook.isSecret, true);
  assert.equal(webhook.scope, 'app');
});

void test('edit form embeds the current watch settings', () => {
  const fields = editWatchForm(config).fields;
  const defaultValue = (name: string) => {
    const field = fields.find(
      (candidate) => 'name' in candidate && candidate.name === name
    );
    assert.ok(field && 'defaultValue' in field);
    return field.defaultValue;
  };

  assert.equal(defaultValue('notificationsEnabled'), false);
  assert.equal(defaultValue('postsEnabled'), true);
  assert.equal(defaultValue('commentsEnabled'), false);
  assert.equal(defaultValue('postSubreddits'), 'news, worldnews');
  assert.equal(defaultValue('commentSubreddits'), 'askreddit');
  assert.equal(defaultValue('intervalSeconds'), 300);
});

void test('watchlist form has one close action', () => {
  const form = watchlistForm('No watched users.');

  assert.equal(form.acceptLabel, 'Close');
  assert.equal(form.cancelLabel, undefined);
});

void test('logging form has a level dropdown and optional secret webhook', () => {
  const form = loggingConfigForm({
    level: 'warn',
    webhookUrl: config.webhookUrl,
  });

  assert.equal(form.fields.length, 2);
  const [level, webhook] = form.fields;
  assert.ok(level && level.type === 'select');
  assert.deepEqual(level.options, [
    { label: 'INFO', value: 'info' },
    { label: 'WARN', value: 'warn' },
    { label: 'ERROR', value: 'error' },
  ]);
  assert.deepEqual(level.defaultValue, ['warn']);
  assert.ok(webhook && webhook.type === 'string');
  assert.equal(webhook.required, undefined);
  assert.equal(webhook.isSecret, true);
  assert.equal(webhook.scope, 'installation');
  assert.equal(webhook.defaultValue, undefined);
});
