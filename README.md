# Snoopy

Snoopy is a Redditor watching service which tracks specific user replies in a thread and notifies via Discord.

<p align="center">
    <img src="https://i.imgur.com/duIOLWL.png" width="650px" draggable="false">
</p>

## Requirements

-   [Python 3.8](https://www.python.org/downloads/)
-   [praw](https://praw.readthedocs.io/en/latest/getting_started/installation.html)
-   [httpx](https://www.python-httpx.org/)
-   [coloredlogs](https://coloredlogs.readthedocs.io/en/latest/readme.html#installation)

A Reddit application ID and Secret are required, you must first [register an application](https://github.com/reddit-archive/reddit/wiki/OAuth2#getting-started).

## Usage

Open `configuration_example.json` in your text editor, fill the configurable values. Once finished, save and rename the file to `configuration.json`.

Snoopy is designed to be ran using a scheduler, such as [cron](https://en.wikipedia.org/wiki/Cron).

```
python snoo.py
```

## Credits

-   Layer7 Solutions: [Idea, BungieReplied Bot](https://bitbucket.org/layer7solutions/bungie-replied/)
