# Snoopy

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/EthanC/Snoopy/main.yml?branch=main) ![Docker Pulls](https://img.shields.io/docker/pulls/ethanchrisp/snoopy?label=Docker%20Pulls) ![Docker Image Size (tag)](https://img.shields.io/docker/image-size/ethanchrisp/snoopy/latest?label=Docker%20Image%20Size)

Snoopy is a Reddit user watcher that stickies comments and reports activity via Discord.

<p align="center">
    <img src="https://i.imgur.com/x3eLTpA.png" draggable="false">
</p>

## Setup

[Reddit API](https://github.com/reddit-archive/reddit/wiki/OAuth2#getting-started) credentials are required for functionality, and a [Discord Webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) is recommended for notifications.

Regardless of your chosen setup method, Snoopy is intended for use with a task scheduler, such as [cron](https://crontab.guru/).

**Environment Variables:**

-   `REDDIT_USERNAME` (Required): Reddit account username.
-   `REDDIT_PASSWORD` (Required): Reddit account password.
-   `REDDIT_CLIENT_ID` (Required): [Reddit API](https://github.com/reddit-archive/reddit/wiki/OAuth2#getting-started) application client ID.
-   `REDDIT_CLIENT_SECRET` (Required): [Reddit API](https://github.com/reddit-archive/reddit/wiki/OAuth2#getting-started) application client secret.
-   `DISCORD_NOTIFY_WEBHOOK`: [Discord Webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) URL to receive available username notifications.
-   `DISCORD_LOG_WEBHOOK`: [Discord Webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) URL to receive log events.
-   `DISCORD_LOG_LEVEL`: Minimum [Loguru](https://loguru.readthedocs.io/en/stable/api/logger.html) severity level to forward to Discord.

**Configurable Variables** (`config.json`)**:**

-   `users` (Required): Array of dicts containing options for watching Reddit users.
    -   `username` (Required): Username of the desired Reddit user
    -   `label`: Label to be displayed alongside the username and post flair
    -   `communities`: Array of strings containing Reddit subreddit names

### Docker (Recommended)

Rename `config_example.json` to `config.json`, then provide the configurable variables.

Modify the following `docker-compose.yml` example file, then run `docker compose up`.

```yml
version: "3"
services:
  snoopy:
    container_name: snoopy
    image: ethanchrisp/snoopy:latest
    environment:
      REDDIT_USERNAME: XXXXXXXX
      REDDIT_PASSWORD: XXXXXXXX
      REDDIT_CLIENT_ID: XXXXXXXX
      REDDIT_CLIENT_SECRET: XXXXXXXX
      DISCORD_NOTIFY_WEBHOOK: https://discord.com/api/webhooks/XXXXXXXX/XXXXXXXX
      DISCORD_LOG_WEBHOOK: https://discord.com/api/webhooks/XXXXXXXX/XXXXXXXX
      DISCORD_LOG_LEVEL: WARNING
    volumes:
      - /path/to/config.json:/snoopy/config.json:ro
```

### Standalone

Snoopy is built for [Python 3.11](https://www.python.org/) or greater.

1. Install required dependencies using [Poetry](https://python-poetry.org/): `poetry install`
2. Rename `.env_example` to `.env`, then provide the environment variables.
3. Rename `config_example.json` to `config.json`, then provide the configurable variables.
4. Start Snoopy: `python snoo.py`
