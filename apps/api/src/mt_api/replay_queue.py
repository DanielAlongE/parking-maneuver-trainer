"""Replay jobs for apps/replay-worker. Redis is the fast path; the worker also
sweeps Postgres for submissions without a replay result, so a lost job only
delays scoring."""

import json
import logging
from typing import Protocol

log = logging.getLogger(__name__)

QUEUE_KEY = "mt:replay-jobs"


class ReplayQueue(Protocol):
    def enqueue(self, submission_id: str) -> None: ...


class RedisReplayQueue:
    def __init__(self, url: str) -> None:
        import redis

        self._redis = redis.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2)

    def enqueue(self, submission_id: str) -> None:
        try:
            self._redis.lpush(QUEUE_KEY, json.dumps({"submissionId": submission_id}))
        except Exception:  # noqa: BLE001 - the worker's sweep picks it up
            log.exception("Could not queue replay for %s; the worker sweep will pick it up", submission_id)


class MemoryReplayQueue:
    """For tests."""

    def __init__(self) -> None:
        self.jobs: list[str] = []

    def enqueue(self, submission_id: str) -> None:
        self.jobs.append(submission_id)
