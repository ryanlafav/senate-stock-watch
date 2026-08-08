"""SEC EDGAR client: ticker -> CIK -> SIC industry classification.

Both endpoints are free and require no API key, but SEC's fair-access policy
requires a descriptive User-Agent identifying the tool and a contact method -
requests without one, or with a generic one, can be blocked. Verified live on
2026-08-08:

  GET https://www.sec.gov/files/company_tickers.json
      -> {"0": {"cik_str": 1045810, "ticker": "NVDA", "title": "NVIDIA CORP"}, ...}

  GET https://data.sec.gov/submissions/CIK{10-digit zero-padded cik}.json
      -> {"cik": "...", "name": "...", "sic": "6021",
          "sicDescription": "National Commercial Banks", "tickers": [...]}
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .http_utils import RateLimiter, RequestBudget, make_session


@dataclass
class SecClient:
    session: Any
    rate_limiter: RateLimiter
    budget: RequestBudget | None

    def _get_json(self, url: str) -> Any:
        if self.budget is not None:
            self.budget.consume()
        self.rate_limiter.wait()
        resp = self.session.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()


def make_client(
    *, user_agent: str, request_delay_seconds: float, max_requests: int | None = None
) -> SecClient:
    session = make_session(user_agent)
    budget = RequestBudget(max_requests) if max_requests else None
    return SecClient(session=session, rate_limiter=RateLimiter(request_delay_seconds), budget=budget)


def fetch_ticker_to_cik(client: SecClient, ticker_map_url: str) -> dict[str, str]:
    """Returns an UPPERCASE ticker -> zero-padded 10-digit CIK string map."""
    raw = client._get_json(ticker_map_url)
    result: dict[str, str] = {}
    for entry in raw.values():
        ticker = str(entry["ticker"]).upper()
        cik10 = str(entry["cik_str"]).zfill(10)
        # First mapping wins if a ticker somehow repeats (SEC's file is
        # already deduplicated in practice).
        result.setdefault(ticker, cik10)
    return result


def fetch_sic_for_cik(client: SecClient, submissions_url_template: str, cik10: str) -> dict:
    data = client._get_json(submissions_url_template.format(cik10=cik10))
    return {
        "cik": data.get("cik"),
        "company_name": data.get("name"),
        "sic": data.get("sic") or None,
        "sic_description": data.get("sicDescription") or None,
    }
