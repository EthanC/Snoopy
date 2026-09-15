import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSubredditMatch,
  normalizeSubreddits,
  normalizeUsername,
  normalizeWebhookUrl,
  parseInterval,
  parseLogLevel,
  ValidationError,
} from './validation.ts';

const token = 'a'.repeat(64);

void test('normalizes Reddit prefixes and casing', () => {
  assert.equal(normalizeUsername('/u/Some_User'), 'some_user');
  assert.deepEqual(normalizeSubreddits('r/News, /r/ASKREDDIT\nnews'), [
    'askreddit',
    'news',
  ]);
});

void test('treats an empty subreddit filter as all subreddits', () => {
  assert.equal(isSubredditMatch([], 'AnyCommunity'), true);
  assert.equal(isSubredditMatch(['news'], 'NEWS'), true);
  assert.equal(isSubredditMatch(['news'], 'pics'), false);
});

void test('accepts the canonical Discord webhook host', () => {
  assert.equal(
    normalizeWebhookUrl(
      `https://discord.com/api/webhooks/12345678901234567/${token}`
    ),
    `https://discord.com/api/webhooks/12345678901234567/${token}?with_components=true`
  );
});

void test('accepts the Discord canary webhook host', () => {
  assert.equal(
    normalizeWebhookUrl(
      `https://canary.discord.com/api/webhooks/12345678901234567/${token}`
    ),
    `https://canary.discord.com/api/webhooks/12345678901234567/${token}?with_components=true`
  );
});

void test('preserves one enabled components URL parameter', () => {
  assert.equal(
    normalizeWebhookUrl(
      `https://discord.com/api/webhooks/12345678901234567/${token}?with_components=true`
    ),
    `https://discord.com/api/webhooks/12345678901234567/${token}?with_components=true`
  );
  assert.equal(
    normalizeWebhookUrl(
      `https://discord.com/api/webhooks/12345678901234567/${token}?with_components=false`
    ),
    `https://discord.com/api/webhooks/12345678901234567/${token}?with_components=true`
  );
});

void test('preserves a valid Discord forum thread ID', () => {
  assert.equal(
    normalizeWebhookUrl(
      `https://discord.com/api/webhooks/12345678901234567/${token}?thread_id=98765432109876543`
    ),
    `https://discord.com/api/webhooks/12345678901234567/${token}?thread_id=98765432109876543&with_components=true`
  );
  assert.throws(
    () =>
      normalizeWebhookUrl(
        `https://discord.com/api/webhooks/12345678901234567/${token}?thread_id=invalid`
      ),
    ValidationError
  );
});

void test('rejects noncanonical and lookalike hosts and intervals under one minute', () => {
  assert.throws(
    () =>
      normalizeWebhookUrl(
        `https://ptb.discord.com/api/webhooks/12345678901234567/${token}`
      ),
    ValidationError
  );
  assert.throws(
    () =>
      normalizeWebhookUrl(
        `https://discord.com.example/api/webhooks/12345678901234567/${token}`
      ),
    ValidationError
  );
  assert.throws(() => parseInterval(59), ValidationError);
  assert.throws(
    () =>
      normalizeWebhookUrl(
        `https://discord.com/api/webhooks/12345678901234567/${token}?wait=true`
      ),
    ValidationError
  );
  assert.throws(
    () =>
      normalizeWebhookUrl(
        `https://discord.com:444/api/webhooks/12345678901234567/${token}`
      ),
    ValidationError
  );
  assert.throws(
    () =>
      normalizeWebhookUrl(
        `https://discord.com/api/webhooks/12345678901234567/${'a'.repeat(2_100)}`
      ),
    ValidationError
  );
});

void test('bounds subreddit filter count and raw input length', () => {
  assert.throws(
    () =>
      normalizeSubreddits(
        Array.from({ length: 101 }, (_, index) => `sub${index}`).join(',')
      ),
    ValidationError
  );
  assert.throws(() => normalizeSubreddits('a'.repeat(5_001)), ValidationError);
});

void test('accepts only supported log levels', () => {
  assert.equal(parseLogLevel(['warn']), 'warn');
  assert.equal(parseLogLevel('error'), 'error');
  assert.throws(() => parseLogLevel(['debug']), ValidationError);
  assert.throws(() => parseLogLevel([]), ValidationError);
});
