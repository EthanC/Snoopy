# Snoopy

Snoopy tracks users on Reddit and sends post notifications to Discord.

[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-5FA04E?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Devvit 0.14.3](https://img.shields.io/badge/Devvit-0.14.3-FF4500?style=flat-square&logo=reddit&logoColor=white)](https://developers.reddit.com/)

## Features

- Watch posts, comments, or both for selected Reddit users.
- Apply separate subreddit filters to posts and comments.
- Send notifications to a different Discord webhook for each watched user.
- Render Reddit profiles, content, images, timestamps, and source links with Discord components.
- Pause a watch without removing its settings.
- Forward a watched user's post or comment manually from its Reddit moderator menu.
- Manage each subreddit's watchlist through native Reddit menus and forms.
- Run entirely on Devvit without a separate server or Discord bot.

## Setup

You must moderate the target subreddit and have permission to create a webhook in Discord.

1. Open [Snoopy's app page](https://developers.reddit.com/apps/snoopy-app), select the installation button, and choose your subreddit.
2. In Discord, open **Server Settings > Integrations > Webhooks**. Create a webhook, choose its text channel, and select **Copy Webhook URL**. See [Discord's webhook guide](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) for more information.
3. On the subreddit's home page, open the three-dot menu and select **Snoopy: Add watched user**. Complete the form and select **Add user**.

Snoopy records the current activity as its starting point, so only matching posts and comments created afterward are sent. Checks run on minute boundaries and may take one configured interval.

To target an existing forum or media channel thread, append `?thread_id=THREAD_ID` with the thread's numeric ID.

## Configuration

| Field                      | Description                                                     | Default |
| -------------------------- | --------------------------------------------------------------- | ------- |
| Reddit user                | Username with or without `u/` or `/u/`                          | None    |
| Discord webhook URL        | Discord destination for this watched user                       | None    |
| Notifications enabled      | Pause or resume notifications without removing the watch        | On      |
| Watch posts                | Send matching posts                                             | On      |
| Watch comments             | Send matching comments                                          | On      |
| Post subreddits            | Subreddits included for posts; blank includes all subreddits    | All     |
| Comment subreddits         | Subreddits included for comments; blank includes all subreddits | All     |
| Update interval in seconds | Whole number from `60` to `86400`                               | `60`    |

At least one activity type must remain enabled. Subreddit filters accept `name`, `r/name`, or `/r/name`, separated by commas, spaces, or newlines. Usernames and subreddit names are case-insensitive.

## Managing Watches

Use the subreddit's three-dot menu to manage its watchlist:

- **Snoopy: Edit watched user** changes filters, interval, activity types, status, or destination. Leave **New Discord webhook URL** blank to keep the current webhook.
- **Snoopy: List watched users** shows each watch's settings, status, and latest polling or delivery error.
- **Snoopy: Remove watched user** removes the watch and its polling state. It does not delete the Discord webhook or previous messages.
- **Snoopy: Send notification** on a post or comment immediately forwards that activity when its author is watched.

Resuming notifications skips activity created during the pause. Enabling posts or comments establishes a new baseline for that activity type. Editing filters, intervals, or webhooks does not replay previously checked activity.

## Troubleshooting

**No messages?** Open **Snoopy: List watched users** and check the latest error. Confirm that notifications and the relevant activity type are enabled, then check each subreddit filter. Temporary Reddit failures and Discord rate limits retry automatically.

**Webhook blocked?** Edit the watch and enter a working URL in **New Discord webhook URL**. Re-entering the same URL clears the block after validation; leaving the field blank does not.

Retries can produce duplicate Discord messages because delivery and checkpointing are separate operations. If a busy account exceeds Reddit's safe history window, Snoopy stops advancing that activity cursor instead of skipping records. Disable notifications, save the watch, then enable them again to skip the backlog and establish new baselines.

## Development

Install Node.js from [`.nvmrc`](.nvmrc). A playtest also requires a Devvit developer account and a test subreddit that you moderate with fewer than 200 subscribers.

```console
npm ci
npm run check
npm run login
npm run dev -- r/YOUR_TEST_SUBREDDIT
```

Configure the playtest through the same Reddit menus. Stopping the command does not uninstall the app.

## Release

Sign in with an account authorized to publish the app named in `devvit.json`. Forks need a separately registered Devvit app and its name in `devvit.json`. Before submitting a release, complete the app details.

| Command                      | Result                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run deploy`             | Run checks, build the app, and upload a private version without submitting it for review |
| `npm run launch`             | Deploy and submit an unlisted release for Reddit review                                  |
| `npm run launch -- --public` | Deploy and request a public App Directory listing                                        |

After Reddit approves the release, install or update each eligible production subreddit:

```console
npx devvit install r/YOUR_SUBREDDIT @APPROVED_VERSION
```

Replace `APPROVED_VERSION` with the approved version number. Publishing does not update existing installations. Run `npx devvit logs r/YOUR_SUBREDDIT` to inspect an installation's logs. See [Reddit's launch guide](https://developers.reddit.com/docs/guides/launch/launch-guide) for distribution options.

### GitHub Actions

[The deployment workflow](.github/workflows/deploy.yml) runs on every push, including pushes to non-default branches. It installs dependencies and runs `npm run deploy`, which runs type checks, lint, unit tests, and the build before uploading a private app version. If any check fails, the upload and installation do not run.

Add these repository secrets under **Settings > Secrets and variables > Actions**:

| Secret              | Value                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `DEVVIT_AUTH_TOKEN` | The complete contents of `~/.devvit/token` (`%USERPROFILE%\.devvit\token` on Windows) after `npm run login` |
| `DEVVIT_SUBREDDIT`  | The target test subreddit name, without the `r/` prefix                                                     |

Log in locally as the app owner and complete developer account setup before creating the token secret. The secret must contain the entire credential file, not just the access token printed by `devvit whoami --token`. The same account must moderate the target subreddit, which must have fewer than 200 subscribers for private versions.

After upload succeeds, the workflow runs `npx devvit install "$DEVVIT_SUBREDDIT"` to install or upgrade the configured app to its latest non-prerelease version. Uploads and installations are serialized across branches because all pushes deploy to the same app and subreddit. This does not publish the app or submit it for Reddit review.
