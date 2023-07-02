import json
import logging
from datetime import datetime, timedelta, timezone
from os import environ
from pathlib import Path
from sys import exit
from typing import Any, Dict, List, Optional, Self, Union

import dotenv
from discord_webhook import DiscordEmbed, DiscordWebhook
from loguru import logger
from notifiers.logging import NotificationHandler
from praw.reddit import Comment, Reddit, Redditor, Submission

from handlers import Intercept
from services import RedditAPI


class Snoopy:
    """
    Reddit user watcher that stickies comments and reports activity
    via Discord.

    https://github.com/EthanC/Snoopy
    """

    def Start(self: Self) -> None:
        """Initialize Snoopy and begin primary functionality."""

        logger.info("Snoopy")
        logger.info("https://github.com/EthanC/Snoopy")

        if dotenv.load_dotenv():
            logger.success("Loaded environment variables")
            logger.trace(environ)

        if Path("config.json").is_file():
            self.config: Dict[str, Any] = {}

            with open("config.json", "r") as file:
                self.config = json.loads(file.read())

            # Standardize case of community names for comparisons
            for user in self.config["users"]:
                if user.get("communities"):
                    user["communities"] = [
                        community.lower() for community in user["communities"]
                    ]

            logger.trace(json.dumps(self.config))
        else:
            logger.critical("Failed to load configuration, config.json does not exist")

            return

        # Reroute standard logging to Loguru
        logging.basicConfig(handlers=[Intercept()], level=0, force=True)

        if logUrl := environ.get("DISCORD_LOG_WEBHOOK"):
            if not (logLevel := environ.get("DISCORD_LOG_LEVEL")):
                logger.critical("Level for Discord webhook logging is not set")

                return

            logger.add(
                NotificationHandler(
                    "slack", defaults={"webhook_url": f"{logUrl}/slack"}
                ),
                level=logLevel,
                format="```\n{time:YYYY-MM-DD HH:mm:ss.SSS} | {level:<8} | {name}:{function}:{line} - {message}\n```",
            )

            logger.success(f"Enabled logging to Discord webhook")
            logger.trace(logUrl)

        self.client: Optional[Reddit] = RedditAPI.Authenticate(self)

        if not self.client:
            return

        self.checkpoint: int = Snoopy.Checkpoint(self)

        for user in self.config["users"]:
            account: Optional[Redditor] = RedditAPI.GetUser(self, user["username"])
            communities: List[str] = user.get("communities", [])
            label: Optional[str] = user.get("label")

            if not account:
                continue

            Snoopy.CheckPosts(self, account, communities, label)
            Snoopy.CheckComments(self, account, communities, label)

            logger.info(f"Processed latest activity for u/{account.name}")

        if not environ.get("DEBUG", False):
            Snoopy.Checkpoint(self, int(datetime.utcnow().timestamp()))

    def Checkpoint(self: Self, new: Optional[int] = None) -> Optional[int]:
        """
        Return the latest checkpoint, or save the provided checkpoint
        to the local disk.
        """

        humanized: Optional[str] = None

        if new:
            with open("checkpoint.txt", "w+") as file:
                file.write(str(new))

            humanized = datetime.utcfromtimestamp(new).strftime("%Y-%m-%d %H:%M:%S")

            logger.info(f"Saved checkpoint at {humanized} ({new})")

            return

        # Default to 24 hours ago if checkpoint is not found
        checkpoint: int = int(
            (datetime.now(timezone.utc) - timedelta(hours=24)).timestamp()
        )

        if Path("checkpoint.txt").is_file():
            with open("checkpoint.txt", "r") as file:
                checkpoint = int(file.read())

            humanized = datetime.utcfromtimestamp(checkpoint).strftime(
                "%Y-%m-%d %H:%M:%S"
            )

            logger.info(f"Loaded checkpoint at {humanized} ({checkpoint})")
        else:
            logger.info(
                f"Checkpoint not found, defaulted to 24 hours ago ({checkpoint})"
            )

        return checkpoint

    def CheckPosts(
        self: Self, user: Redditor, communities: List[str], label: Optional[str]
    ) -> None:
        """Process the latest post activity for the provided Reddit user."""

        posts: List[Submission] = RedditAPI.GetUserPosts(
            self, user, self.checkpoint, communities
        )

        for post in posts:
            logger.success(
                f"New post by u/{user.name} in r/{post.subreddit.display_name}"
            )
            logger.debug(RedditAPI.BuildURL(self, post))

            Snoopy.Notify(self, post, label)

            if RedditAPI.IsModerator(self, self.client, post.subreddit):
                post.mod.approve()

    def CheckComments(
        self: Self, user: Redditor, communities: List[str], label: Optional[str]
    ) -> None:
        """Process the latest comment activity for the provided Reddit user."""

        comments: List[Comment] = RedditAPI.GetUserComments(
            self, user, self.checkpoint, communities
        )

        for comment in comments:
            logger.success(
                f"New comment by u/{user.name} in r/{comment.subreddit.display_name}"
            )
            logger.debug(RedditAPI.BuildURL(self, comment))

            Snoopy.Notify(self, comment, label)

            if not RedditAPI.IsModerator(self, self.client, comment.subreddit):
                continue

            comment.mod.approve()

            parent: Submission = comment.submission

            if (label) and ((flairText := parent.link_flair_text)):
                # Ensure we only edit the flair once
                if not flairText.endswith(" Replied)"):
                    parent.mod.flair(
                        flair_template_id=parent.link_flair_template_id,
                        text=f"{flairText} ({label} Replied)",
                    )

            stickied: Optional[Comment] = RedditAPI.GetStickiedComment(self, parent)

            # If no stickied comment, or current stickied comment is not
            # owned by the client authorized user, create our own
            if (not stickied) or (stickied.author != self.client.user.me()):
                reply: Comment = parent.reply(
                    RedditAPI.BuildQuote(self, comment, label)
                )

                reply.mod.approve()
                reply.mod.lock()
                reply.mod.distinguish(sticky=True)

                return

            # Append latest comment to existing stickied comment
            stickied.body += "\n\n"
            stickied.body += RedditAPI.BuildQuote(self, comment, label)

            stickied.edit(stickied.body)

    def Notify(
        self: Self, content: Union[Comment, Submission], label: Optional[str]
    ) -> None:
        """Report Redditor activity to the configured Discord webhook."""

        if not (url := environ.get("DISCORD_NOTIFY_WEBHOOK")):
            logger.info("Discord webhook for notifications is not set")

            return

        author: str = f"u/{content.author.name}"

        if label:
            author += f" ({label})"

        embed: DiscordEmbed = DiscordEmbed()

        embed.set_color("FF5700")
        embed.set_author(
            author,
            url=RedditAPI.BuildURL(self, content.author),
            icon_url=content.author.icon_img,
        )
        embed.set_footer(text="Reddit", icon_url="https://i.imgur.com/ucGCjfj.png")
        embed.set_timestamp(content.created_utc)

        if type(content) is Submission:
            embed.set_title(content.title)
            embed.set_url(RedditAPI.BuildURL(self, content))

            # Handle various submission types
            if (hasattr(content, "selftext")) and (content.selftext):
                embed.set_description(f">>> {content.selftext[0:4000]}")
            elif (hasattr(content, "url")) and (content.url):
                embed.set_description(content.url[0:4000])
        elif type(content) is Comment:
            embed.set_title(f"Comment in r/{content.subreddit.display_name}")
            embed.set_url(RedditAPI.BuildURL(self, content, True))
            embed.set_description(f">>> {content.body[0:4000]}")

        DiscordWebhook(url=url, embeds=[embed], rate_limit_retry=True).execute()


if __name__ == "__main__":
    try:
        Snoopy.Start(Snoopy)
    except KeyboardInterrupt:
        exit()
