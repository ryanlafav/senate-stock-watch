"""Shared HTTP session helper: retry/backoff + rate limiting + identifying UA.

Used by both efd_client.py and sec_client.py so every outbound request to a
third-party government site carries a descriptive User-Agent and never hammers
the remote server.
"""
from __future__ import annotations

import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


def make_session(user_agent: str) -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": user_agent})
    retry = Retry(
        total=4,
        backoff_factor=1.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=frozenset(["GET", "POST"]),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class RateLimiter:
    """Sleeps as needed so calls are spaced at least `delay_seconds` apart."""

    def __init__(self, delay_seconds: float):
        self.delay_seconds = delay_seconds
        self._last_call: float | None = None

    def wait(self) -> None:
        if self._last_call is not None:
            elapsed = time.monotonic() - self._last_call
            remaining = self.delay_seconds - elapsed
            if remaining > 0:
                time.sleep(remaining)
        self._last_call = time.monotonic()


class RequestBudgetExceeded(RuntimeError):
    """Raised when a script would exceed its configured per-run request cap."""


class RequestBudget:
    """Hard cap on requests per pipeline run, so a pagination bug can't loop forever."""

    def __init__(self, max_requests: int):
        self.max_requests = max_requests
        self.used = 0

    def consume(self) -> None:
        self.used += 1
        if self.used > self.max_requests:
            raise RequestBudgetExceeded(
                f"Exceeded max_requests_per_run={self.max_requests}"
            )
