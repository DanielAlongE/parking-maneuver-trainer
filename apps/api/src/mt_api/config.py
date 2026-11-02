import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    redis_url: str
    # Base URL of the web app, used to build invite links.
    public_url: str
    # Set true when served over HTTPS so the session cookie is never sent in clear.
    cookie_secure: bool
    session_days: int = 14
    invite_days: int = 7


def load_settings() -> Settings:
    return Settings(
        database_url=os.environ.get("DATABASE_URL", "postgresql://mt:mt@localhost:5432/mt"),
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        public_url=os.environ.get("PUBLIC_URL", "http://localhost:5173").rstrip("/"),
        cookie_secure=os.environ.get("COOKIE_SECURE", "false").lower() in ("1", "true", "yes"),
    )
