from os import environ
from sys import exit

import praw  # pyright: ignore [reportMissingTypeStubs]
from loguru import logger
from praw.reddit import (  # pyright: ignore [reportMissingTypeStubs]
    Comment,
    Reddit,
    Redditor,
    Submission,
    Subreddit,
)


def Authenticate() -> Reddit:
    """Authenticate with Reddit using the configured credentials."""

    client: Reddit = praw.Reddit(
        username=environ["REDDIT_USERNAME"],
        password=environ["REDDIT_PASSWORD"],
        client_id=environ["REDDIT_CLIENT_ID"],
        client_secret=environ["REDDIT_CLIENT_SECRET"],
        user_agent="Snoopy by u/LackingAGoodName (https://github.com/EthanC/Snoopy)",
    )

    if (not client) or (client.read_only):
        logger.critical("Failed to authenticate client with Reddit")
        logger.debug(client)

        exit(1)

    client.validate_on_submit = True

    logger.trace(client.auth.limits)
    logger.success(f"Authenticated client with Reddit as u/{ClientUsername(client)}")

    return client


def ClientUsername(client: Reddit) -> str:
    """Fetch the username of the authenticated Reddit user."""

    me: Redditor = client.user.me()  # pyright: ignore [reportUnknownVariableType]

    if me and me.name:
        return me.name  # pyright: ignore [reportUnknownVariableType]

    logger.warning("Client username is unknown")
    logger.debug(client)

    return "Unknown"


def GetUser(client: Reddit, username: str) -> Redditor | None:
    """Fetch a Redditor object for the specified Reddit username."""

    try:
        return client.redditor(username)  # pyright: ignore [reportUnknownVariableType]
    except Exception as e:
        logger.opt(exception=e).error(f"Failed to fetch Reddit user u/{username}")


def GetUserPosts(
    user: Redditor, checkpoint: int, communities: list[str]
) -> list[Submission]:
    """Fetch the latest posts for the provided Reddit user."""

    posts: list[Submission] = []

    try:
        for post in user.submissions.new(limit=None):
            if int(post.created_utc) < checkpoint:
                logger.debug(
                    f"Checkpoint reached while fetching posts ({len(posts):,}) for u/{user.name}"
                )
                logger.trace(f"{int(post.created_utc)} < {checkpoint}")

                break

            if len(communities) > 0:
                communityName: str = post.subreddit.display_name

                if not communityName.lower() in communities:
                    logger.debug(
                        f"r/{communityName} is not a valid community for u/{user.name}"
                    )

                    continue

            posts.append(post)

        logger.trace(posts)
    except Exception as e:
        logger.opt(exception=e).error(
            f"Failed to fetch posts for Reddit user u/{user.name}"
        )

    logger.info(f"Fetched {len(posts):,} posts for Reddit user u/{user.name}")

    return posts


def GetUserComments(
    user: Redditor, checkpoint: int, communities: list[str]
) -> list[Comment]:
    """Fetch the latest comments for the provided Reddit user."""

    comments: list[Comment] = []

    try:
        for comment in user.comments.new(limit=None):
            if int(comment.created_utc) < checkpoint:
                logger.debug(
                    f"Checkpoint reached while fetching comments ({len(comments):,}) for u/{user.name}"
                )
                logger.trace(f"{int(comment.created_utc)} < {checkpoint}")

                break

            if len(communities) > 0:
                communityName: str = comment.subreddit.display_name

                if not communityName.lower() in communities:
                    logger.debug(
                        f"r/{communityName} is not a valid community for u/{user.name}"
                    )

                    continue

            comments.append(comment)

        logger.trace(comments)
    except Exception as e:
        logger.opt(exception=e).error(
            f"Failed to fetch comments for Reddit user u/{user.name}"
        )

    logger.info(f"Fetched {len(comments):,} comments for Reddit user u/{user.name}")

    return comments


def GetPostComments(post: Submission) -> list[Comment]:
    """Fetch all comments on the provided Reddit post."""

    comments: list[Comment] = []

    try:
        post.comments.replace_more(limit=None)

        comments = post.comments.list()
    except Exception as e:
        logger.error(f"Failed to fetch comments for post {post.id}, {e}")

    logger.trace(comments)

    return comments


def GetStickiedComment(post: Submission) -> Comment | None:
    """Return the stickied comment object on the provided post."""

    comments: list[Comment] = GetPostComments(post)

    for comment in comments:
        if (hasattr(comment, "stickied")) and (comment.stickied):
            logger.trace(comment)

            return comment


def BuildURL(content: Submission | Comment | Redditor, context: bool = False) -> str:
    """Return a complete URL to the provided Reddit content."""

    url: str = f"https://reddit.com"

    if type(content) is Submission:
        url += content.permalink
    elif type(content) is Comment:
        url += content.permalink

        if context:
            url += "?context=5"
    elif type(content) is Redditor:
        url += f"/user/{content.name}"

    logger.trace(url)

    return url


def BuildQuote(content: Comment, label: str | None) -> str:
    """Return a markdown-formatted quote of the provided comment."""

    link: str = f"[Comment]({BuildURL(content, True)})"

    # Escape forward slash with backward slash to avoid sending
    # an unnecessary notification to the quoted user
    author: str = f"[u\\/{content.author.name}]({BuildURL(content.author)})"
    quote: str = f"{link} by {author}"

    if label:
        quote += f" ({label})"

    quote += "\n\n"

    for line in content.body.splitlines(True):
        quote += f"> {line}"

    logger.trace(quote)

    return quote


def IsModerator(user: Redditor | Reddit, community: Subreddit) -> bool:
    """
    Determine if the provided user is a Moderator of the
    specified community.
    """

    # If provided a Reddit instance, use authenticated user
    if isinstance(user, Reddit):
        userObj: Redditor = user.user.me()  # pyright: ignore [reportUnknownVariableType]
    else:
        userObj: Redditor = user

    if userObj in community.moderator():
        logger.trace(f"u/{userObj.name} is a Moderator of r/{community.display_name}")

        return True

    logger.trace(f"u/{userObj.name} is not a Moderator of r/{community.display_name}")

    return False
