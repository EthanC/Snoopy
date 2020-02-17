import logging
from os import path
from sys import exit
from typing import Any, Dict, List, Optional, Tuple, Union

import coloredlogs
import httpx
import praw

from util import Utility

log: logging.Logger = logging.getLogger(__name__)
coloredlogs.install(level="INFO", fmt="[%(asctime)s] %(message)s", datefmt="%I:%M:%S")


class Snoopy:
    """Redditor watching service which tracks specific user replies in a thread and notifies via Discord."""

    def init(self: Any) -> None:
        print("Snoopy - Redditor watching service")
        print("https://github.com/EthanC/Snoopy\n")

        self.configuration: dict = Utility.ReadFile(self, "configuration", "json")
        configured: Optional[bool] = Snoopy.LoadConfiguration(self)

        if path.isfile("database.json") is False:
            log.warning("Could not find database, creating it")

            Utility.WriteFile(self, "database", "json", {})

        self.database: dict = Utility.ReadFile(self, "database", "json")

        if (configured is True) and (self.database is not None):
            log.info("Loaded configuration and database")

            try:
                self.reddit: praw.reddit.Reddit = praw.Reddit(
                    username=self.username,
                    password=self.password,
                    client_id=self.clientId,
                    client_secret=self.clientSecret,
                    user_agent="Snoopy by /u/LackingAGoodName (https://github.com/EthanC/Snoopy)",
                )

                if self.reddit.read_only is True:
                    raise Exception("read-only mode is active")
            except Exception as e:
                log.critical(f"Failed to authenticate with Reddit, {e}")

                return

            log.info(f"Authenticated with Reddit as /u/{self.reddit.user.me().name}")

            for configuration in self.configurations:
                Snoopy.CheckComments(self, configuration)

    def LoadConfiguration(self: Any) -> Optional[bool]:
        """
        Set the configuration values specified in configuration.json
        
        Return True if configuration sucessfully loaded.
        """

        try:
            self.username: str = self.configuration["reddit"]["username"]
            self.password: str = self.configuration["reddit"]["password"]
            self.clientId: str = self.configuration["reddit"]["clientId"]
            self.clientSecret: str = self.configuration["reddit"]["clientSecret"]
            self.configurations: List[
                Dict[str, Union[bool, str, dict]]
            ] = self.configuration["configurations"]
            self.watermark: str = "[](#SnoopyReply)"
            self.template: str = "[Comment](https://reddit.com{}?context=1000) by [\\/u\\/{}](https://reddit.com/user/{}) ({}):\n\n{}\n\n"

            return True
        except Exception as e:
            log.fatal(f"Failed to load configuration, {e}")

    def CheckComments(self: Any, configuration: dict) -> None:
        """
        Check the latest comments in a Subreddit. Act upon comments which
        fit the configured requirements.
        """

        if configuration.get("enabled") is not True:
            return

        if (s := configuration.get("subreddit")) is None:
            return

        subreddit: praw.reddit.Subreddit = self.reddit.subreddit(s)
        flairs: List[Dict[str, str]] = configuration.get("userFlairs", [])
        record: Optional[int] = self.database.get(subreddit.display_name.lower())

        if record is not None:
            count: int = 0
            latest: Tuple[bool, int] = (False, 0)

            try:
                comment: praw.reddit.Comment
                for comment in subreddit.comments(limit=None):
                    created: int = int(comment.created_utc)
                    flairId: Optional[str] = comment.author_flair_template_id

                    # Comments are returned newest to oldest, so we want
                    # to record the first comment which is checked.
                    if latest[0] is False:
                        latest: Tuple[bool, int] = (True, created)

                    if comment.removed is True:
                        continue

                    if created <= record:
                        break

                    count += 1

                    if flairId is not None:
                        for flair in flairs:
                            if flair["id"] == flairId:
                                Snoopy.ProcessComment(
                                    self, comment, flair["name"], configuration
                                )
            except Exception as e:
                log.error(
                    f"Failed to get comments from /r/{subreddit.display_name}, {e}"
                )

                return

            if count == 0:
                log.info(f"No new comments found in /r/{subreddit.display_name}")

                return

            log.info(f"Checked {count} new comments in /r/{subreddit.display_name}")

            Snoopy.UpdateDatabase(self, subreddit.display_name, latest[1])
        else:
            try:
                comment: praw.reddit.Comment
                for comment in subreddit.comments(limit=1):
                    Snoopy.UpdateDatabase(
                        self, subreddit.display_name, int(comment.created_utc)
                    )

                    break

                log.info(f"No record found for /r/{subreddit.display_name}, created it")
            except Exception as e:
                log.error(
                    f"Failed to get the latest comment in /r/{subreddit.display_name}, {e}"
                )

    def ProcessComment(
        self: Any, comment: praw.reddit.Comment, flair: str, configuration: dict
    ) -> None:
        """
        Add the specified comment to the thread's comment compilation,
        perform miscellaneous tasks based on configuration.
        """

        submission: praw.reddit.Submission = comment.submission
        subreddit: str = comment.subreddit.display_name
        existing: Tuple[bool, Optional[praw.reddit.Comment]] = (False, None)

        log.info(
            f"Found comment by /u/{comment.author.name} ({flair}) in /r/{subreddit}"
        )

        try:
            topLevel: praw.reddit.Comment
            for topLevel in submission.comments:
                try:
                    if topLevel.removed is True:
                        continue
                except Exception as e:
                    log.error(
                        f"Unable to determine if comment is removed in /r/{subreddit}"
                    )

                if topLevel.author == self.reddit.user.me():
                    if topLevel.body.endswith(self.watermark):
                        existing = (True, topLevel)

                        break

                if topLevel.stickied is True:
                    topLevel.report(
                        "Stickied comment replaced, please ensure this was intended"
                    )
        except Exception as e:
            log.error(f"Failed to check comments of post in /r/{subreddit}, {e}")

        reply: Optional[praw.reddit.Comment] = None
        if existing[0] is True:
            reply: Optional[praw.reddit.Comment] = Snoopy.UpdateReply(
                self, existing[1], comment, flair
            )
        elif existing[0] is False:
            reply: Optional[praw.reddit.Comment] = Snoopy.CreateReply(
                self, comment, submission, flair
            )

        webhook: Dict[str, Union[bool, str]] = configuration.get("webhook", {})
        if webhook.get("enabled") is True:
            Snoopy.Webhook(self, comment, flair, webhook)

        if reply is None:
            return

        try:
            reply.disable_inbox_replies()
        except Exception as e:
            log.error(
                f"Failed to disable inbox replies for comment in /r/{subreddit}, {e}"
            )

        try:
            reply.mod.distinguish(how="yes", sticky=True)
        except Exception as e:
            log.error(f"Failed to distinguish comment in /r/{subreddit}, {e}")

        if configuration.get("lockComment") is True:
            try:
                reply.mod.lock()
            except Exception as e:
                log.error(f"Failed to lock comment in /r/{subreddit}, {e}")

        if configuration.get("changeFlair") is True:
            linkFlairText: Optional[str] = submission.link_flair_text

            # This will prevent literal "None" from being added to the
            # link flair text when no flair was previously present.
            if linkFlairText is None:
                linkFlairText: Optional[str] = ""

            if linkFlairText.endswith(" Replied)"):
                pass
            else:
                try:
                    submission.mod.flair(text=f"{linkFlairText} ({flair} Replied)")
                except Exception as e:
                    log.error(f"Failed to modify post flair in /r/{subreddit}, {e}")

    def CreateReply(
        self: Any,
        reply: Optional[praw.reddit.Comment],
        parent: praw.reddit.Submission,
        flair: str,
    ) -> Optional[praw.reddit.Comment]:
        """Create a new comment in the specified thread."""

        try:
            compilation: Optional[praw.reddit.Comment] = parent.reply(
                self.template.format(
                    reply.permalink,
                    reply.author.name,
                    reply.author.name,
                    flair,
                    Utility.Quote(self, reply.body),
                )
                + self.watermark
            )

            return compilation
        except Exception as e:
            log.error(
                f"Failed to reply to post in /r/{parent.subreddit.display_name}, {e}"
            )

    def UpdateReply(
        self: Any,
        compilation: Optional[praw.reddit.Comment],
        reply: Optional[praw.reddit.Comment],
        flair: str,
    ) -> Optional[praw.reddit.Comment]:
        """Update the existing comment in the specified thread."""

        try:
            compilation.edit(
                compilation.body.split(self.watermark)[0]
                + self.template.format(
                    reply.permalink,
                    reply.author.name,
                    reply.author.name,
                    flair,
                    Utility.Quote(self, reply.body),
                )
                + self.watermark
            )

            return compilation
        except Exception as e:
            log.error(
                f"Failed to edit comment in /r/{compilation.subreddit.display_name}, {e}"
            )

    def UpdateDatabase(self: Any, subreddit: str, commentTime: int) -> None:
        """Add the latest seen comment's timestamp to database.json"""

        self.database.update({subreddit.lower(): commentTime})

        Utility.WriteFile(self, "database", "json", self.database)

    def Webhook(
        self: Any, comment: praw.reddit.Comment, flair: str, configuration: dict
    ) -> None:
        """Send the specified comment to Discord via Webhook."""

        embed: dict = {
            "username": configuration["name"],
            "avatar_url": configuration["avatarUrl"],
            "embeds": [
                {
                    "color": int("FF5700", base=16),
                    "author": {
                        "name": f"/u/{comment.author.name} ({flair})",
                        "url": f"https://reddit.com/user/{comment.author.name}",
                        "icon_url": comment.author.icon_img,
                    },
                    "title": f"Comment in /r/{comment.subreddit.display_name}",
                    "url": f"https://reddit.com{comment.permalink}?context=1000",
                    "description": Utility.Truncate(
                        self, Utility.Quote(self, comment.body), 2045
                    ),
                    "footer": {
                        "icon_url": "https://i.imgur.com/zbrkjFR.png",
                        "text": "Snoopy",
                    },
                    "timestamp": Utility.NowISO(self),
                }
            ],
        }

        res: httpx.Response = httpx.post(configuration["url"], json=embed)

        # HTTP 204 (Success: No Content)
        if (code := res.status_code) != 204:
            log.error(f"Failed to POST to Discord Webhook (HTTP {code}), {res.text}")


if __name__ == "__main__":
    try:
        Snoopy.init(Snoopy)
    except KeyboardInterrupt:
        exit()
