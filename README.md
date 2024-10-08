# Snoopy

![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/EthanC/Snoopy/ci.yaml?branch=main) ![Docker Pulls](https://img.shields.io/docker/pulls/ethanchrisp/snoopy?label=Docker%20Pulls) ![Docker Image Size (tag)](https://img.shields.io/docker/image-size/ethanchrisp/snoopy/latest?label=Docker%20Image%20Size)

Snoopy monitors users on Reddit and notifies about post activity via Discord.

<p align="center">
    <img src="https://i.imgur.com/x3eLTpA.png" draggable="false">
</p>

## Setup

[Reddit API](https://github.com/reddit-archive/reddit/wiki/OAuth2#getting-started) credentials are required for functionality, and a [Discord Webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) is recommended for notifications.

Regardless of your chosen setup method, Snoopy is intended for use with a task scheduler, such as [cron](https://crontab.guru/).

**Environment Variables:**

-   `LOG_LEVEL`: [Loguru](https://loguru.readthedocs.io/en/stable/api/logger.html) severity level to write to the console.
-   `LOG_DISCORD_WEBHOOK_URL`: [Discord Webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) URL to receive log events.
-   `LOG_DISCORD_WEBHOOK_LEVEL`: Minimum [Loguru](https://loguru.readthedocs.io/en/stable/api/logger.html) severity level to forward to Discord.
-   `REDDIT_USERNAME` (Required): Reddit account username.
-   `REDDIT_PASSWORD` (Required): Reddit account password.
-   `REDDIT_CLIENT_ID` (Required): [Reddit API](https://github.com/reddit-archive/reddit/wiki/OAuth2#getting-started) application client ID.
-   `REDDIT_CLIENT_SECRET` (Required): [Reddit API](https://github.com/reddit-archive/reddit/wiki/OAuth2#getting-started) application client secret.
-   `DISCORD_WEBHOOK_URL`: [Discord Webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) URL to receive Reddit activity notifications.

**Configurable Variables** (`config.json`)**:**

-   `users` (Required): Array of dicts containing options for watching Reddit users.
    -   `username` (Required): Username of the desired Reddit user
    -   `label`: Label to be displayed alongside the username and post flair
    -   `communities`: Array of strings containing Reddit subreddit names

### Docker (Recommended)

Rename `config_example.json` to `config.json`, then provide the configurable variables.

Modify the following `compose.yaml` example file, then run `docker compose up`.

```yml
services:
  snoopy:
    container_name: snoopy
    image: ethanchrisp/snoopy:latest
    environment:
      LOG_LEVEL: INFO
      LOG_DISCORD_WEBHOOK_URL: https://discord.com/api/webhooks/YYYYYYYY/YYYYYYYY
      LOG_DISCORD_WEBHOOK_LEVEL: WARNING
      REDDIT_USERNAME: XXXXXXXX
      REDDIT_PASSWORD: XXXXXXXX
      REDDIT_CLIENT_ID: XXXXXXXX
      REDDIT_CLIENT_SECRET: XXXXXXXX
      DISCORD_WEBHOOK_URL: https://discord.com/api/webhooks/XXXXXXXX/XXXXXXXX
    volumes:
      - /path/to/config.json:/snoopy/config.json:ro
```

### Standalone

Snoopy is built for [Python 3.12](https://www.python.org/) or greater.

1. Install required dependencies using [uv](https://github.com/astral-sh/uv): `uv sync`
2. Rename `.env_example` to `.env`, then provide the environment variables.
3. Rename `config_example.json` to `config.json`, then provide the configurable variables.
4. Start Snoopy: `python snoo.py`
