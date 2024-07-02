import json
import logging
from datetime import UTC, datetime
from os import environ
from pathlib import Path
from sys import exit, stdout
from typing import Any

import dotenv
from discord_webhook import DiscordEmbed, DiscordWebhook
from loguru import logger
from loguru_discord import DiscordSink
from praw.reddit import (  # pyright: ignore [reportMissingTypeStubs]
    Comment,
    Reddit,
    Redditor,
    Submission,
)

from handlers.intercept import Intercept
from services.reddit import (
    Authenticate,
    BuildQuote,
    BuildURL,
    ClientUsername,
    GetStickiedComment,
    GetUser,
    GetUserComments,
    GetUserPosts,
    IsModerator,
)


def Start() -> None:
    """Initialize Snoopy and begin primary functionality."""

    logger.info("Snoopy")
    logger.info("https://github.com/EthanC/Snoopy")

    # Reroute standard logging to Loguru
    logging.basicConfig(handlers=[Intercept()], level=0, force=True)

    if dotenv.load_dotenv():
        logger.success("Loaded environment variables")

    if level := environ.get("LOG_LEVEL"):
        logger.remove()
        logger.add(stdout, level=level)

        logger.success(f"Set console logging level to {level}")

    if url := environ.get("LOG_DISCORD_WEBHOOK_URL"):
        logger.add(
            DiscordSink(url),
            level=environ["LOG_DISCORD_WEBHOOK_LEVEL"],
            backtrace=False,
        )

        logger.success(f"Enabled logging to Discord webhook")
        logger.trace(url)

    if Path("config.json").is_file():
        config: dict[str, Any] = {}

        with open("config.json", "r") as file:
            config = json.loads(file.read())

        # Standardize case of community names for comparisons
        for user in config["users"]:
            if user.get("communities"):
                user["communities"] = [
                    community.lower() for community in user["communities"]
                ]
    else:
        logger.critical("Failed to load configuration, config.json does not exist")

        exit(1)

    client: Reddit = Authenticate()
    checkpoint: int = Checkpoint()

    for user in config["users"]:
        account: Redditor | None = GetUser(client, user["username"])
        communities: list[str] = user.get("communities", [])
        label: str | None = user.get("label")

        if not account:
            continue

        CheckPosts(client, account, communities, label, checkpoint)
        CheckComments(client, account, communities, label, checkpoint)

        logger.info(f"Processed latest activity for u/{account.name}")

    if not environ.get("DEBUG", False):
        Checkpoint(int(datetime.now(UTC).timestamp()))


def Checkpoint(new: int | None = None) -> int:
    """
    Return the latest checkpoint, or save the provided checkpoint
    to the local disk and return it.
    """

    humanized: str | None = None

    if new:
        with open("checkpoint.txt", "w+") as file:
            file.write(str(new))

        humanized = datetime.fromtimestamp(new, UTC).strftime("%Y-%m-%d %H:%M:%S")

        logger.info(f"Saved checkpoint at {humanized} ({new})")

        return new

    # Default to now if checkpoint is not found
    checkpoint: int = int(datetime.now(UTC).timestamp())

    if Path("checkpoint.txt").is_file():
        with open("checkpoint.txt", "r") as file:
            try:
                checkpoint = int(file.read())
            except Exception as e:
                logger.opt(exception=e).warning("Failed to read local checkpoint")

        humanized = datetime.fromtimestamp(checkpoint, UTC).strftime("%Y-%m-%d %H:%M:%S")

        logger.info(f"Loaded checkpoint at {humanized} ({checkpoint})")
    else:
        logger.info(f"Checkpoint not found, defaulted to now ({checkpoint})")

    return checkpoint


def CheckPosts(
    client: Reddit,
    user: Redditor,
    communities: list[str],
    label: str | None,
    checkpoint: int,
) -> None:
    """Process the latest post activity for the provided Reddit user."""

    posts: list[Submission] = GetUserPosts(user, checkpoint, communities)

    logger.info(f"Checking {len(posts):,} posts for Reddit user u/{user.name}")

    for post in posts:
        logger.success(f"New post by u/{user.name} in r/{post.subreddit.display_name}")
        logger.debug(BuildURL(post))

        Notify(post, label)

        if IsModerator(client, post.subreddit):
            post.mod.approve()


def CheckComments(
    client: Reddit,
    user: Redditor,
    communities: list[str],
    label: str | None,
    checkpoint: int,
) -> None:
    """Process the latest comment activity for the provided Reddit user."""

    comments: list[Comment] = GetUserComments(user, checkpoint, communities)

    logger.info(f"Checking {len(comments):,} comments for Reddit user u/{user.name}")

    for comment in comments:
        logger.success(
            f"New comment by u/{user.name} in r/{comment.subreddit.display_name}"
        )
        logger.debug(BuildURL(comment))

        Notify(comment, label)

        if not IsModerator(client, comment.subreddit):
            logger.debug(
                f"Client user {ClientUsername(client)} is not a Moderator of r/{comment.subreddit.display_name}, no further action for this comment"
            )

            continue

        comment.mod.approve()

        parent: Submission = comment.submission  # pyright: ignore [reportUnknownVariableType]

        if (label) and (flairText := parent.link_flair_text):  # pyright: ignore [reportUnknownVariableType]
            # Ensure we only edit the flair once
            if not flairText.endswith(" Replied)"):
                parent.mod.flair(
                    flair_template_id=parent.link_flair_template_id,
                    text=f"{flairText} ({label} Replied)",
                )

        stickied: Comment | None = GetStickiedComment(parent)  # pyright: ignore [reportUnknownArgumentType]

        if (not stickied) or (stickied.author != client.user.me()):
            # If no stickied comment, or current stickied comment is not
            # owned by the client authorized user, create our own
            reply: Comment = parent.reply(BuildQuote(comment, label))  # pyright: ignore [reportAssignmentType]

            reply.mod.approve()
            reply.mod.lock()
            reply.mod.distinguish(sticky=True)
        else:
            # Append latest comment to existing stickied comment
            stickied.body += "\n\n"
            stickied.body += BuildQuote(comment, label)

            if len(stickied.body) >= 10000:
                logger.warning("Cannot edit comment due to exceeding the length limit")

                continue

            try:
                stickied.edit(stickied.body)
            except Exception as e:
                logger.error(f"Failed to edit comment, {e}")


def Notify(content: Comment | Submission, label: str | None) -> None:
    """Report Redditor activity to the configured Discord webhook."""

    if not (url := environ.get("DISCORD_WEBHOOK_URL")):
        logger.info("Discord webhook for notifications is not set")

        return

    author: str = f"u/{content.author.name}"

    if label:
        author += f" ({label})"

    embed: DiscordEmbed = DiscordEmbed()

    embed.set_color("FF5700")
    embed.set_author(
        author, url=BuildURL(content.author), icon_url=content.author.icon_img
    )
    embed.set_footer(text="Reddit", icon_url="https://i.imgur.com/ucGCjfj.png")
    embed.set_timestamp(content.created_utc)

    if type(content) is Submission:
        embed.set_title(content.title)
        embed.set_url(BuildURL(content))

        # Handle various submission types
        if (hasattr(content, "selftext")) and (content.selftext):
            embed.set_description(f">>> {content.selftext[0:4000]}")
        elif (hasattr(content, "url")) and (content.url):
            embed.set_description(content.url[0:4000])
    elif type(content) is Comment:
        embed.set_title(f"Comment in r/{content.subreddit.display_name}")
        embed.set_url(BuildURL(content, True))
        embed.set_description(f">>> {content.body[0:4000]}")

    DiscordWebhook(url=url, embeds=[embed], rate_limit_retry=True).execute()


if __name__ == "__main__":
    try:
        Start()
    except KeyboardInterrupt:
        exit()
