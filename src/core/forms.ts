import type { Form, FormField } from '@devvit/shared-types/shared/form.js';
import { encodeWatchRevision } from './configuration.ts';
import {
  DEFAULT_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
} from './types.ts';
import type { WatchConfig } from './types.ts';

const commonFields = (config?: WatchConfig): FormField[] => [
  config
    ? {
        name: 'username',
        label: 'Reddit user',
        type: 'select',
        required: true,
        options: [],
      }
    : {
        name: 'username',
        label: 'Reddit user',
        type: 'string',
        required: true,
        helpText: 'The u/ prefix is optional.',
      },
  {
    name: 'webhookUrl',
    label: config ? 'New Discord webhook URL' : 'Discord webhook URL',
    type: 'string',
    isSecret: true,
    scope: 'app',
    required: !config,
    helpText: config ? 'Leave blank to keep the current webhook.' : undefined,
  },
  {
    name: 'notificationsEnabled',
    label: 'Notifications enabled',
    type: 'boolean',
    defaultValue: config?.notificationsEnabled ?? true,
  },
  {
    name: 'postsEnabled',
    label: 'Watch posts',
    type: 'boolean',
    defaultValue: config?.postsEnabled ?? true,
  },
  {
    name: 'postSubreddits',
    label: 'Post subreddits',
    type: 'paragraph',
    lineHeight: 3,
    defaultValue: config?.postSubreddits.join(', '),
    helpText: 'Comma or newline separated. Leave blank for all subreddits.',
  },
  {
    name: 'commentsEnabled',
    label: 'Watch comments',
    type: 'boolean',
    defaultValue: config?.commentsEnabled ?? true,
  },
  {
    name: 'commentSubreddits',
    label: 'Comment subreddits',
    type: 'paragraph',
    lineHeight: 3,
    defaultValue: config?.commentSubreddits.join(', '),
    helpText: 'Comma or newline separated. Leave blank for all subreddits.',
  },
  {
    name: 'intervalSeconds',
    label: 'Update interval in seconds',
    type: 'number',
    required: true,
    defaultValue: config?.intervalSeconds ?? DEFAULT_INTERVAL_SECONDS,
    helpText: `Only whole numbers from ${MIN_INTERVAL_SECONDS} to ${MAX_INTERVAL_SECONDS} can be saved. Checks run on minute boundaries.`,
  },
];

export function addWatchForm(): Form {
  return {
    title: 'Add watched user',
    description:
      'Existing activity becomes the baseline and is not sent to Discord.',
    fields: commonFields(),
    acceptLabel: 'Add user',
    cancelLabel: 'Cancel',
  };
}

export function editWatchForm(config: WatchConfig): Form {
  const fields = commonFields(config);
  const revision = encodeWatchRevision(config);
  fields[0] = {
    name: 'username',
    label: 'Reddit user',
    type: 'select',
    required: true,
    options: [{ label: `u/${config.displayUsername}`, value: revision }],
    defaultValue: [revision],
  };
  return {
    title: `Edit u/${config.displayUsername}`,
    fields,
    acceptLabel: 'Save changes',
    cancelLabel: 'Cancel',
  };
}

function userOptions(configs: WatchConfig[], revisions = false) {
  return configs.map((config) => ({
    label: `u/${config.displayUsername}`,
    value: revisions ? encodeWatchRevision(config) : config.username,
  }));
}

export function selectEditForm(configs: WatchConfig[]): Form {
  return {
    title: 'Edit watched user',
    fields: [
      {
        name: 'username',
        label: 'Reddit user',
        type: 'select',
        required: true,
        options: userOptions(configs),
      },
    ],
    acceptLabel: 'Continue',
    cancelLabel: 'Cancel',
  };
}

export function removeWatchForm(configs: WatchConfig[]): Form {
  return {
    title: 'Remove watched user',
    description: 'This also deletes polling state and processed activity IDs.',
    fields: [
      {
        name: 'username',
        label: 'Reddit user',
        type: 'select',
        required: true,
        options: userOptions(configs, true),
      },
      {
        name: 'confirm',
        label: 'Permanently remove this watched user',
        type: 'boolean',
        defaultValue: false,
      },
    ],
    acceptLabel: 'Remove user',
    cancelLabel: 'Cancel',
  };
}

export function watchlistForm(summary: string): Form {
  return {
    title: 'Snoopy watchlist',
    fields: [
      {
        name: 'summary',
        label: 'Configured users',
        type: 'paragraph',
        disabled: true,
        lineHeight: 12,
        defaultValue: summary,
      },
    ],
    acceptLabel: 'Close',
    cancelLabel: 'Close',
  };
}
