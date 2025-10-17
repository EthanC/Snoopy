import logging
import tomllib
from datetime import UTC, datetime
from os import environ
from pathlib import Path
from sys import stdout
from typing import Any

from clyde import Timestamp, Webhook
from clyde.components import (
    ActionRow,
    Container,
    LinkButton,
    Section,
    Seperator,
    TextDisplay,
    Thumbnail,
    UnfurledMediaItem,
)
from clyde.markdown import Markdown
from environs import env
from loguru import logger
from loguru_discord import DiscordSink
from praw.reddit import (  # pyright: ignore[reportMissingTypeStubs]
    Comment,
    Reddit,
    Redditor,
    Submission,
)

from core.intercept import Intercept
from core.reddit import (
    authenticate,
    build_blockquote,
    build_url,
    get_pinned_comment,
    get_user,
    get_user_comments,
    get_user_posts,
    is_moderator,
)


def start() -> None:
    """Initialize Snoopy and begin primary functionality."""
    logger.info("Snoopy")
    logger.info("https://github.com/EthanC/Snoopy")

    # Reroute standard logging to Loguru
    logging.basicConfig(handlers=[Intercept()], level=0, force=True)

    if env.read_env(recurse=False):
        logger.info("Loaded environment variables")

    if environ.get("LOG_LEVEL"):
        level: str = env.str("LOG_LEVEL")

        logger.remove()
        logger.add(stdout, level=level)

        logger.info(f"Set console logging level to {level}")

    if environ.get("LOG_DISCORD_WEBHOOK_URL"):
        url: str = env.url("LOG_DISCORD_WEBHOOK_URL").geturl()

        logger.add(
            DiscordSink(url),
            level=env.str("LOG_DISCORD_WEBHOOK_LEVEL"),
            backtrace=False,
        )

        logger.info("Enabled logging to Discord webhook")
        logger.trace(f"{url=}")

    config: dict[str, Any] | None = None

    try:
        with open("config.toml", "r") as file:
            config = tomllib.loads(file.read())
    except Exception as e:
        logger.opt(exception=e).critical("Failed to load config.toml")

        return

    users: list[dict[str, Any]] = config.get("users", [])

    logger.info(f"Loaded {len(users)} users from config.toml")
    logger.trace(f"{users=}")

    client: Reddit = authenticate()
    checkpoint: int = load_checkpoint()

    for instance in users:
        user: Redditor | None = get_user(client, instance["username"])
        communities: list[str] | None = instance.get("communities")
        label: str | None = instance.get("label")
        exclude_posts: bool = instance.get("exclude_posts", False)
        exclude_comments: bool = instance.get("exclude_comments", False)
        webhook_url: str | None = instance.get("discord_webhook_url")

        if not user:
            logger.debug(f"Skipped {instance['username']}, user is null")
            logger.trace(f"{instance=}")

            continue

        if communities:
            # Normalize community name case for comparison
            communities = [community.lower() for community in communities]

        if not exclude_posts:
            check_posts(client, user, checkpoint, communities, label, webhook_url)

        if not exclude_comments:
            check_comments(client, user, checkpoint, communities, label, webhook_url)

        logger.info(f"Processed latest activity for u/{user.name}")

    save_checkpoint()


def load_checkpoint() -> int:
    """Return the latest checkpoint from the local disk."""
    humanized: str | None = None

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

    return checkpoint


def save_checkpoint(new: int | None = None) -> None:
    """Save the provided checkpoint to the local disk."""
    if environ.get("DEBUG"):
        logger.debug("DEBUG is enabled, checkpoint will not be saved to the local disk")

        return

    # Default to now if new checkpoint is not provided
    new = int(datetime.now(UTC).timestamp())

    humanized: str = datetime.fromtimestamp(new, UTC).strftime("%Y-%m-%d %H:%M:%S")

    with open("checkpoint.txt", "w+") as file:
        file.write(str(new))

    logger.info(f"Saved checkpoint at {humanized} ({new})")


def check_posts(
    client: Reddit,
    user: Redditor,
    checkpoint: int,
    communities: list[str] | None,
    label: str | None,
    webhook_url: str | None,
) -> None:
    """Process the latest post activity for the provided Reddit user."""
    posts: list[Submission] = get_user_posts(user)

    for post in posts:
        post_url: str = build_url(post)

        if int(post.created_utc) <= checkpoint:
            logger.debug(f"Skipped post {post.id}, created prior to checkpoint")
            logger.trace(f"{post_url=} {int(post.created_utc)=} {checkpoint=}")

            continue

        if communities:
            community: str | None = post.subreddit.display_name

            if community and community.lower() not in communities:
                logger.debug(
                    f"Skipped post {post.id}, not posted in a desired community"
                )
                logger.trace(f"{post_url=} {community=} {communities=}")

                continue

        logger.success(
            f"New post by u/{user.name} in r/{post.subreddit.display_name} [{post_url}]"
        )
        logger.debug(f"{post=}")

        if is_moderator(client, post.subreddit):
            post.mod.approve()

        if webhook_url:
            notify(post, label, webhook_url)


def check_comments(
    client: Reddit,
    user: Redditor,
    checkpoint: int,
    communities: list[str] | None,
    label: str | None,
    webhook_url: str | None,
) -> None:
    """Process the latest comment activity for the provided Reddit user."""
    comments: list[Comment] = get_user_comments(user)

    for comment in comments:
        comment_url: str = build_url(comment)

        if int(comment.created_utc) <= checkpoint:
            logger.debug(f"Skipped comment {comment.id}, created prior to checkpoint")
            logger.trace(f"{comment_url=} {int(comment.created_utc)=} {checkpoint=}")

            continue

        if communities:
            community: str | None = comment.subreddit.display_name

            if community and community.lower() not in communities:
                logger.debug(
                    f"Skipped comment {comment.id}, not posted in a desired community"
                )
                logger.trace(f"{comment_url=} {community=} {communities=}")

                continue

        logger.success(
            f"New comment by u/{user.name} in r/{comment.subreddit.display_name} [{comment_url}]"
        )
        logger.debug(f"{comment=}")

        if is_moderator(client, comment.subreddit):
            comment.mod.approve()

            parent: Submission = comment.submission

            if label and (flair_text := parent.link_flair_text):
                # Ensure we only edit the flair once
                if not flair_text.endswith(" Replied)"):
                    parent.mod.flair(
                        flair_template_id=parent.link_flair_template_id,
                        text=f"{flair_text} ({label} Replied)",
                    )

            pinned: Comment | None = get_pinned_comment(parent)

            if not pinned or pinned.author != client.user.me():
                # Because parent is always a Submission object, reply() will
                # always return a Comment, but this conditional check is
                # necessary to satisfy the type checker
                if isinstance(
                    (candidate := parent.reply(build_blockquote(comment, label))),
                    Comment,
                ):
                    reply: Comment = candidate

                    reply.mod.approve()
                    reply.mod.lock()
                    reply.mod.distinguish(sticky=True)
            else:
                pinned.body += "\n\n"
                pinned.body += build_blockquote(comment, label)

                try:
                    pinned.edit(pinned.body)
                except Exception as e:
                    logger.opt(exception=e).error(
                        "Failed to edit pinned comment on post"
                    )
                    logger.debug(f"{build_url(comment)} {build_url(parent)}")

        if webhook_url:
            notify(comment, label, webhook_url)


def notify(content: Submission | Comment, label: str | None, webhook_url: str) -> None:
    """Report Redditor activity to the configured Discord webhook."""
    relay: Webhook = Webhook(url=webhook_url)

    username: str = Markdown.masked_link(
        f"u/{content.author.name}", build_url(content.author)
    )

    if label:
        username += f" ({label})"

    head_primary: TextDisplay = TextDisplay(content=Markdown.header_1(username))

    community: str = Markdown.masked_link(
        f"r/{content.subreddit.display_name}", build_url(content.subreddit)
    )
    site: str = Markdown.masked_link("Reddit", build_url())

    head_secondary: TextDisplay = TextDisplay(
        content=Markdown.subtext(
            f"{'Commented' if isinstance(content, Comment) else 'Posted'} {Timestamp.relative_time(content.created_utc)} in {community} on {site}"
        )
    )

    head: Section = Section(
        components=[head_primary, head_secondary],
        accessory=Thumbnail(media=UnfurledMediaItem(url=content.author.icon_img)),
    )

    body: TextDisplay = TextDisplay(content=build_url(content, True))

    if isinstance(content, Submission):
        if hasattr(content, "selftext") and content.selftext:
            body.set_content(Markdown.block_quote(content.selftext[:3096]))
        elif hasattr(content, "url") and content.url:
            body.set_content(Markdown.block_quote(content.url[:3096]))
    else:
        body.set_content(Markdown.block_quote(content.body[:3096]))

    footer: TextDisplay = TextDisplay(
        content=Markdown.subtext(Timestamp.long_date_time(content.created_utc))
    )

    relay.add_component(
        Container(
            components=[head, body, Seperator(), footer],
            accent_color="FF4500",
        )
    )

    content_url: str = build_url(content)

    relay.add_component(
        ActionRow(
            components=[
                LinkButton(label="View on Reddit", url=content_url),
                LinkButton(
                    label="Powered by Snoopy", url="https://github.com/EthanC/Snoopy"
                ),
            ]
        )
    )

    try:
        relay.execute()
    except Exception as e:
        logger.opt(exception=e).error(f"Failed to send notification for Reddit {"comment" if isinstance(content, Comment) else "post"} {content_url}")


if __name__ == "__main__":
    try:
        start()
    except KeyboardInterrupt:
        pass
