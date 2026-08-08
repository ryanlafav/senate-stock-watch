#!/usr/bin/env python3
"""Classify every ticker seen in trades.json by SIC industry code via SEC EDGAR.

Steady-state runs only look up genuinely new tickers (cached in
docs/data/sic_cache.json), so this stays cheap - most days it makes zero or a
handful of requests. Tickers not found in SEC's map (bonds, options, foreign
issuers without a listed CIK, mutual funds) are recorded as `found: false`
rather than dropped, and retried again after `retry_not_found_after_days` in
case SEC's map has since caught up.
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import sec_client  # noqa: E402
from lib.io_utils import atomic_write_json, read_json  # noqa: E402
from lib.pipeline_config import load_config  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "docs" / "data"


def _distinct_tickers(trades: list[dict]) -> set[str]:
    return {t["ticker"] for t in trades if t.get("ticker")}


def _needs_lookup(ticker: str, cache: dict, retry_after_days: int, today: date) -> bool:
    entry = cache.get(ticker)
    if entry is None:
        return True
    if entry.get("found"):
        return False
    last_checked = entry.get("last_checked")
    if not last_checked:
        return True
    checked_date = datetime.strptime(last_checked, "%Y-%m-%d").date()
    return (today - checked_date) >= timedelta(days=retry_after_days)


def run(config: dict) -> dict:
    sec_cfg = config["sec"]
    trades_doc = read_json(DATA_DIR / "trades.json", default={"trades": []})
    tickers = _distinct_tickers(trades_doc.get("trades", []))

    cache_doc = read_json(DATA_DIR / "sic_cache.json", default={"tickers": {}})
    cache = cache_doc.get("tickers", {})

    today = date.today()
    to_lookup = sorted(
        t for t in tickers if _needs_lookup(t, cache, sec_cfg["retry_not_found_after_days"], today)
    )

    generated_at = datetime.now(timezone.utc).isoformat()

    if not to_lookup:
        return {
            "tickers_total": len(tickers),
            "tickers_looked_up": 0,
            "tickers_found": sum(1 for v in cache.values() if v.get("found")),
            "tickers_unclassified": sum(1 for v in cache.values() if not v.get("found")),
            "generated_at": cache_doc.get("generated_at", generated_at),
        }

    client = sec_client.make_client(
        user_agent=sec_cfg["user_agent"],
        request_delay_seconds=sec_cfg["request_delay_seconds"],
    )
    ticker_to_cik = sec_client.fetch_ticker_to_cik(client, sec_cfg["ticker_map_url"])

    found_count = 0
    for ticker in to_lookup:
        cik10 = ticker_to_cik.get(ticker)
        if cik10 is None:
            cache[ticker] = {
                "found": False,
                "reason": "not_in_sec_ticker_map",
                "last_checked": today.isoformat(),
            }
            continue
        info = sec_client.fetch_sic_for_cik(client, sec_cfg["submissions_url_template"], cik10)
        if info.get("sic"):
            cache[ticker] = {
                "found": True,
                "cik": info["cik"],
                "company_name": info["company_name"],
                "sic": info["sic"],
                "sic_description": info["sic_description"],
                "last_checked": today.isoformat(),
            }
            found_count += 1
        else:
            cache[ticker] = {
                "found": False,
                "reason": "no_sic_on_file",
                "cik": info.get("cik"),
                "last_checked": today.isoformat(),
            }

    atomic_write_json(
        DATA_DIR / "sic_cache.json",
        {"generated_at": generated_at, "tickers": cache},
    )

    return {
        "tickers_total": len(tickers),
        "tickers_looked_up": len(to_lookup),
        "tickers_newly_found": found_count,
        "tickers_found": sum(1 for v in cache.values() if v.get("found")),
        "tickers_unclassified": sum(1 for v in cache.values() if not v.get("found")),
        "generated_at": generated_at,
    }


def main() -> int:
    config = load_config()
    stats = run(config)
    print(
        f"{stats['tickers_total']} distinct tickers seen, "
        f"{stats['tickers_looked_up']} looked up this run, "
        f"{stats['tickers_found']} classified total, "
        f"{stats['tickers_unclassified']} unclassified total."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
