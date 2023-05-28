from os import environ
from typing import List, Optional, Self, Union

import praw
from loguru import logger
from praw.reddit import Comment, Reddit, Redditor, Submission, Subreddit


class RedditAPI:
    """
    Class to integrate with the Reddit API and build objects specific
    to the Reddit platform.
    """

    def Authenticate(self: Self) -> Optional[Reddit]:
        """Authenticate with Reddit using the configured credentials."""

        self.client: Optional[Reddit] = praw.Reddit(
            username=environ.get("REDDIT_USERNAME"),
            password=environ.get("REDDIT_PASSWORD"),
            client_id=environ.get("REDDIT_CLIENT_ID"),
            client_secret=environ.get("REDDIT_CLIENT_SECRET"),
            user_agent="Snoopy by u/LackingAGoodName (https://github.com/EthanC/Snoopy)",
        )

        if self.client.read_only:
            logger.critical("Failed to authenticate with Reddit, client is read-only")

            return

        self.client.validate_on_submit = True

        logger.trace(self.client.auth.limits)
        logger.success(
            f"Authenticated with Reddit as u/{RedditAPI.ClientUsername(self)}"
        )

        return self.client

    def ClientUsername(self: Self) -> str:
        """Fetch the username of the authenticated Reddit user."""

        return self.client.user.me().name

    def GetUser(self: Self, username: str) -> Optional[Redditor]:
        """Fetch a Redditor object for the specified Reddit username."""

        try:
            return self.client.redditor(username)
        except Exception as e:
            logger.error(f"Failed to fetch Reddit user u/{username}, {e}")

        return

    def GetUserPosts(
        self: Self, user: Redditor, checkpoint: int, communities: List[str]
    ) -> List[Submission]:
        """Fetch the latest posts for the provided Reddit user."""

        posts: List[Submission] = []

        try:
            for post in user.submissions.new(limit=None):
                if int(post.created_utc) < checkpoint:
                    logger.debug(
                        f"Checkpoint reached while fetching posts for u/{user.name}"
                    )

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
            logger.error(f"Failed to fetch posts for Reddit user u/{user.name}, {e}")

        return posts

    def GetUserComments(
        self: Self, user: Redditor, checkpoint: int, communities: List[str]
    ) -> List[Comment]:
        """Fetch the latest comments for the provided Reddit user."""

        comments: List[Comment] = []

        try:
            for comment in user.comments.new(limit=None):
                if int(comment.created_utc) < checkpoint:
                    logger.debug(
                        f"Checkpoint reached while fetching comments for u/{user.name}"
                    )

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
            logger.error(f"Failed to fetch comments for Reddit user u/{user.name}, {e}")

        return comments

    def GetPostComments(self: Self, post: Submission) -> List[Comment]:
        """Fetch all comments on the provided Reddit post."""

        comments: List[Comment] = post.comments.list()

        logger.trace(comments)

        return comments

    def GetStickiedComment(self: Self, post: Submission) -> Optional[Comment]:
        """Return the stickied comment object on the provided post."""

        comments: List[Comment] = RedditAPI.GetPostComments(self, post)

        for comment in comments:
            if comment.stickied:
                logger.trace(comment)

                return comment

    def BuildURL(
        self: Self, content: Union[Submission, Comment, Redditor], context: bool = False
    ) -> str:
        """Return a complete URL to the provided Reddit content."""

        url: str = f"https://reddit.com"

        if type(content) is Submission:
            url += content.permalink
        elif type(content) is Comment:
            url += content.permalink

            if context:
                url += "?context=1000"
        elif type(content) is Redditor:
            url += f"/user/{content.name}"

        logger.trace(url)

        return url

    def BuildQuote(self: Self, content: Comment, label: Optional[str]) -> str:
        """Return a markdown-formatted quote of the provided comment."""

        link: str = f"[Comment]({RedditAPI.BuildURL(self, content, True)})"
        author: str = (
            f"[u\/{content.author.name}]({RedditAPI.BuildURL(self, content.author)})"
        )

        # Escape forward slash with backward slash to avoid sending
        # an unnecessary notification to the quoted user
        quote: str = f"{link} by {author}"

        if label:
            quote += f" ({label})"

        quote += "\n\n"

        for line in content.body.splitlines(True):
            quote += f"> {line}"

        logger.trace(quote)

        return quote

    def IsModerator(
        self: Self, user: Union[Redditor, Reddit], community: Subreddit
    ) -> bool:
        """
        Determine if the provided user is a Moderator of the
        specified community.
        """

        # If provided a Reddit instance, use authenticated user
        if type(user) is Reddit:
            user = user.user.me()

        if user in community.moderator():
            logger.trace(f"u/{user.name} is a Moderator of r/{community.display_name}")

            return True

        logger.trace(f"u/{user.name} is not a Moderator of r/{community.display_name}")

        return False
