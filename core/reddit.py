from sys import exit

import praw  # pyright: ignore[reportMissingTypeStubs]
from environs import env
from loguru import logger
from praw.reddit import (  # pyright: ignore[reportMissingTypeStubs]
    Comment,
    Reddit,
    Redditor,
    Submission,
    Subreddit,
)


def authenticate() -> Reddit:
    """Authenticate with Reddit using the configured credentials."""
    client: Reddit = praw.Reddit(
        username=env.str("REDDIT_USERNAME"),
        password=env.str("REDDIT_PASSWORD"),
        client_id=env.str("REDDIT_CLIENT_ID"),
        client_secret=env.str("REDDIT_CLIENT_SECRET"),
        user_agent="Snoopy (https://github.com/EthanC/Snoopy)",
    )

    if (not client) or (client.read_only):
        logger.critical("Failed to authenticate client with Reddit")
        logger.debug(f"{client=}")

        exit(1)

    logger.success(
        f"Authenticated client with Reddit as u/{get_client_username(client)}"
    )
    logger.trace(f"{client.auth.limits=}")

    return client


def get_client_username(client: Reddit) -> str:
    """Fetch the username of the authenticated Reddit user."""
    if me := client.user.me():
        if me and me.name:
            return me.name

    logger.warning("Client username is unknown")
    logger.debug(f"{client=}")

    return "Unknown"


def get_user(client: Reddit, username: str) -> Redditor | None:
    """Fetch a Redditor object for the specified Reddit username."""
    try:
        return client.redditor(username)
    except Exception as e:
        logger.opt(exception=e).error(f"Failed to fetch Reddit user u/{username}")


def get_user_posts(user: Redditor) -> list[Submission]:
    """Fetch the latest posts for the provided Reddit user."""
    posts: list[Submission] = []

    try:
        for post in user.submissions.new(limit=None):
            posts.append(post)
            logger.trace(f"{post=}")
    except Exception as e:
        logger.opt(exception=e).error(
            f"Failed to fetch posts for Reddit user u/{user.name}"
        )

    # Sort the list chronologically (old -> new)
    posts = list(reversed(posts))

    logger.info(f"Fetched {len(posts):,} posts for Reddit user u/{user.name}")
    logger.trace(f"{posts=}")

    return posts


def get_user_comments(user: Redditor) -> list[Comment]:
    """Fetch the latest comments for the provided Reddit user."""
    comments: list[Comment] = []

    try:
        for comment in user.comments.new(limit=None):
            comments.append(comment)
            logger.trace(f"{comment=}")
    except Exception as e:
        logger.opt(exception=e).error(
            f"Failed to fetch comments for Reddit user u/{user.name}"
        )

    # Sort the list chronologically (old -> new)
    comments = list(reversed(comments))

    logger.info(f"Fetched {len(comments):,} comments for Reddit user u/{user.name}")
    logger.trace(f"{comments=}")

    return comments


def get_post_comments(post: Submission) -> list[Comment]:
    """Fetch all comments on the provided Reddit post."""
    comments: list[Comment] = []

    try:
        post.comments.replace_more(limit=None)

        # List should only contain Comment instances, but this conditional
        # check is performed to satisfy the type checker
        for comment in post.comments.list():
            if isinstance(comment, Comment):
                comments.append(comment)
    except Exception as e:
        logger.opt(exception=e).error(
            f"Failed to fetch comments for Reddit post {post.id}"
        )

    logger.info(f"Fetched {len(comments):,} comments for Reddit post {post.id}")
    logger.trace(f"{comments=}")

    return comments


def get_pinned_comment(post: Submission) -> Comment | None:
    """Return the pinned comment object on the provided post."""
    comments: list[Comment] = get_post_comments(post)

    for comment in comments:
        logger.trace(f"{comment=}")

        if (hasattr(comment, "stickied")) and (comment.stickied):
            logger.info(
                f"Fetched pinned comment {comment.id} for Reddit post {post.id}"
            )
            logger.debug(f"{comment=}")

            return comment


def build_url(
    content: Submission | Comment | Subreddit | Redditor | None = None,
    context: bool = False,
) -> str:
    """Return a complete URL to the provided Reddit content."""
    url: str = f"https://reddit.com"

    if content:
        if isinstance(content, Submission):
            url += content.permalink
        elif isinstance(content, Comment):
            url += content.permalink

            if context:
                url += "?context=5"
        elif isinstance(content, Subreddit):
            url += f"/r/{content.display_name}"
        else:
            url += f"/user/{content.name}"

    logger.debug(f"Build Reddit URL {url=}")

    return url


def build_blockquote(content: Comment, label: str | None) -> str:
    """Return a markdown-formatted quote of the provided comment."""
    link: str = f"[Comment]({build_url(content, True)})"

    # Escape forward slash with backward slash to avoid sending
    # an unnecessary notification to the quoted user
    author: str = f"[u\\/{content.author.name}]({build_url(content.author)})"
    quote: str = f"{link} by {author}"

    if label:
        quote += f" ({label})"

    quote += "\n\n"

    for line in content.body.splitlines(True):
        quote += f"> {line}"

    logger.debug(f"Built blockquote for Reddit comment {content.id}")
    logger.trace(f"{quote=}")

    return quote


def is_moderator(candidate: Redditor | Reddit, community: Subreddit) -> bool:
    """Determine if the user is a Moderator of the specified community."""
    user: Redditor | None = None

    if isinstance(candidate, Redditor):
        user = candidate
    else:
        if candidate.user:
            user = candidate.user.me()

    if user:
        if user in community.moderator():
            logger.debug(f"u/{user.name} is a Moderator of r/{community.display_name}")
            logger.trace(f"{user=} {community.moderator()=}")

            return True

    logger.debug(f"u/{candidate=} is not a Moderator of r/{community.display_name}")
    logger.trace(f"{user=} {community.moderator()=}")

    return False
