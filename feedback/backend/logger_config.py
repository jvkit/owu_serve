import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

LOG_DIR = Path(os.environ.get("LOG_DIR", os.path.join(os.path.dirname(__file__), "..", "logs")))
LOG_DIR.mkdir(parents=True, exist_ok=True)

MAX_BYTES = int(os.environ.get("LOG_MAX_BYTES", "10485760"))  # 10MB
BACKUP_COUNT = int(os.environ.get("LOG_BACKUP_COUNT", "5"))

FORMAT = "%(asctime)s | %(levelname)-8s | %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


class FeatureFilter(logging.Filter):
    """Route log records to feature-specific files based on message prefix."""

    def __init__(self, name: str = "", prefixes: list[str] | None = None):
        super().__init__(name)
        self.prefixes = prefixes or []

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return any(
            message.startswith(prefix) or f" {prefix}" in message
            for prefix in self.prefixes
        )


def setup_logging() -> None:
    """Configure console + per-feature file logging."""

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    # Remove existing handlers to avoid duplicates on reload
    for handler in root.handlers[:]:
        root.removeHandler(handler)

    # Console handler
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(logging.Formatter(FORMAT, datefmt=DATE_FORMAT))
    root.addHandler(console)

    # Feature-specific file handlers
    feature_handlers = [
        ("feedback", ["[FEEDBACK]", "[SUBMIT]", "[PROFILE]", "[ADMIN]"]),
        ("request", ["[REQUEST]", "[RESPONSE]"]),
        ("auth", ["[AUTH]"]),
    ]

    for name, prefixes in feature_handlers:
        file_path = LOG_DIR / f"{name}.log"
        handler = RotatingFileHandler(
            file_path,
            maxBytes=MAX_BYTES,
            backupCount=BACKUP_COUNT,
            encoding="utf-8",
        )
        handler.setFormatter(logging.Formatter(FORMAT, datefmt=DATE_FORMAT))
        handler.addFilter(FeatureFilter(prefixes=prefixes))
        root.addHandler(handler)

    # Default feedback-service log catches everything else
    default_handler = RotatingFileHandler(
        LOG_DIR / "feedback-service.log",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
    )
    default_handler.setFormatter(logging.Formatter(FORMAT, datefmt=DATE_FORMAT))
    root.addHandler(default_handler)

    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
