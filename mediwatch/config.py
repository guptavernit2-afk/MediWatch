"""Environment configuration, deliberately safe without an AI key."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def env_bool(key: str, default: bool) -> bool:
    value = os.getenv(key)
    if value is None:
        return default
    if value.strip().lower() not in {"true", "false", "1", "0", "yes", "no"}:
        raise ValueError(f"{key} must be true or false.")
    return value.strip().lower() in {"true", "1", "yes"}


@dataclass(frozen=True)
class Settings:
    db_path: str
    demo_mode: bool
    api_token: str
    groq_key: str
    groq_model: str
    refresh_interval: int = 10

    @classmethod
    def from_env(cls, db_path=None, demo_mode=None):
        return cls(
            db_path=str(db_path or os.getenv("MEDIWATCH_DB_PATH", str(ROOT / "data" / "mediwatch.db"))),
            demo_mode=env_bool("DEMO_MODE", True) if demo_mode is None else demo_mode,
            api_token=os.getenv("MEDIWATCH_API_TOKEN", "").strip(),
            groq_key=os.getenv("GROQ_API_KEY", "").strip(),
            groq_model=os.getenv("GROQ_MODEL", "llama-3.1-8b-instant"),
        )
