# Snoopy

![Python](https://img.shields.io/badge/Python-3-blue?logo=python&logoColor=white)
![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/ethanc/snoopy/workflow.yaml)
![Docker Pulls](https://img.shields.io/docker/pulls/ethanchrisp/snoopy)
![Docker Image Size (tag)](https://img.shields.io/docker/image-size/ethanchrisp/snoopy)

Snoopy tracks users on Reddit, pins their comments, and sends activity notifications to Discord.

![Example](/.github/images/readme_example.png)

## Features

-   Monitor any public user on Reddit.
-   Get structured alerts with rich Discord Components.
-   Deploy effortlessly with Docker or run locally with Python.

## Getting Started

### Quick Start: Docker Compose

Rename `config.example.toml` to `config.toml` and set your instance configuration(s).

Next, edit and run this example `compose.yaml` with `docker compose up`.

```yaml
services:
  snoopy:
    container_name: snoopy
    image: ethanchrisp/snoopy:latest
    environment:
      LOG_LEVEL: INFO
      LOG_DISCORD_WEBHOOK_URL: https://discord.com/api/webhooks/YYYYYYYY/ZZZZZZZZ
      LOG_DISCORD_WEBHOOK_LEVEL: WARNING
      REDDIT_USERNAME: WWWWWWWW
      REDDIT_PASSWORD: XXXXXXXX
      REDDIT_CLIENT_ID: YYYYYYYYYYYYYYYY
      REDDIT_CLIENT_SECRET: ZZZZZZZZZZZZZZZZ
    volumes:
      - /local/path/to/config.toml:/snoopy/config.toml:ro
```

### Standalone: Python

> [!NOTE]
> Python 3.13 or later required.

1. Install dependencies.

    ```bash
    uv sync
    ```

2. Rename `.env.example` to `.env` and configure your environment.

3. Rename `config.example.toml` to `config.toml` and set your instance configuration(s).

4. Run Snoopy

    ```bash
    uv run snoopy.py
    ```

### Configuration

Each instance within `config.toml` can be configured to your liking.

| **Key**               | **Description**                                                    | **Type**         | **Required** | **Example**                                         |
| --------------------- | ------------------------------------------------------------------ | ---------------- | ------------ | --------------------------------------------------- |
| `username`            | Reddit username to track.                                          | String           | Yes          | `"LackingAGoodName"`                                |
| `label`               | Label to display alongside the username.                           | String           | No           | `"Friend"`                                          |
| `communities`         | Community names to require for activity notifications.             | Array of Strings | No           | `["CODZombies", "ModernWarfareIII", "modnews"]`     |
| `exclude_posts`       | Set to `true` to skip posts.                                       | Boolean          | No           | `true`                                              |
| `exclude_comments`    | Set to `true` to skip comments.                                    | Boolean          | No           | `true`                                              |
| `discord_webhook_url` | Discord Webhook URL to send activity notifications to.             | String           | No           | `https://discord.com/api/webhook/XXXXXXXX/YYYYYYYY` |
