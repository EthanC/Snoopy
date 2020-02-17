import json
import logging
from datetime import datetime
from typing import Any, Optional, Union

log: logging.Logger = logging.getLogger(__name__)


class Utility:
    """Utilitarian functions intended to reduce duplicate code."""

    def ReadFile(
        self: Any, filename: str, extension: str
    ) -> Optional[Union[str, dict]]:
        """Read and return the contents of the specified file."""

        try:
            with open(f"{filename}.{extension}", "r", encoding="utf-8") as file:
                if extension == "json":
                    return json.loads(file.read())
                else:
                    return file.read()
        except Exception as e:
            log.error(f"Failed to read file {filename}.{extension}, {e}")

    def WriteFile(
        self: Any, filename: str, extension: str, contents: Union[str, dict]
    ) -> Optional[bool]:
        """Write the contents of the specified file."""

        try:
            with open(f"{filename}.{extension}", "w+", encoding="utf-8") as file:
                if extension == "json":
                    file.write(json.dumps(contents, indent=4))
                else:
                    file.write(contents)

            return True
        except Exception as e:
            log.error(f"Failed to write file {filename}.{extension}, {e}")

    def Quote(self: Any, text: str) -> str:
        """Prefix each line of a string with the quoteblock formatting."""

        quoted: str = "> ".join(text.splitlines(True))

        return "> " + quoted

    def Truncate(self: Any, text: str, maxLength: int) -> str:
        """
        Trim a string to the specified length and truncate it with an
        elipses if it exceeds the maximum length.
        """

        if len(text) >= maxLength:
            return text[:maxLength] + "..."

        return text

    def NowISO(self: Any) -> str:
        """Return the current UTC time in ISO format."""

        return datetime.utcnow().isoformat()
